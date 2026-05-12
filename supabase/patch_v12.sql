-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v12 : Pipeline SMS booking (zéro compte patient)
-- OTP par SMS · Auto-confirm · Ticket QR · Rappel T-1h
-- ════════════════════════════════════════════════════════════════════

-- ── 1. TABLE PATIENTS (identité par téléphone, sans auth.users) ──────
create table if not exists public.patients (
  id          uuid default uuid_generate_v4() primary key,
  phone_hash  text unique not null,          -- SHA-256 du numéro E.164
  phone_e164  text not null,                 -- +213XXXXXXXXX
  full_name   text,
  created_at  timestamptz default now() not null
);

alter table public.patients enable row level security;

-- Lecture par service_role uniquement (Edge Functions)
drop policy if exists "service_role_patients" on public.patients;
create policy "service_role_patients" on public.patients
  for all using (auth.role() = 'service_role');

create index if not exists idx_patients_phone_hash
  on public.patients(phone_hash);

-- ── 2. TABLE OTP_VERIFICATIONS (anti-spam + rate-limit) ──────────────
create table if not exists public.otp_verifications (
  id          uuid default uuid_generate_v4() primary key,
  phone_hash  text not null,
  otp_hash    text not null,                 -- SHA-256(OTP + secret)
  attempts    smallint default 0 not null,
  expires_at  timestamptz not null,
  created_at  timestamptz default now() not null
);

alter table public.otp_verifications enable row level security;

drop policy if exists "service_role_otp" on public.otp_verifications;
create policy "service_role_otp" on public.otp_verifications
  for all using (auth.role() = 'service_role');

create index if not exists idx_otp_phone_hash
  on public.otp_verifications(phone_hash, expires_at desc);

-- ── 3. MISE À JOUR TABLE APPOINTMENTS ────────────────────────────────
-- Lien patient structuré + tokens + rappel

alter table public.appointments
  add column if not exists patient_id      uuid references public.patients(id) on delete set null,
  add column if not exists ticket_token    text unique,
  add column if not exists cancel_token    text unique,
  add column if not exists reminder_sent   boolean default false not null,
  add column if not exists scheduled_at_ts timestamptz;

-- Index pour le cron T-1h (requête ultra-rapide)
create index if not exists idx_appointments_reminder
  on public.appointments(scheduled_at_ts, reminder_sent, status)
  where status = 'confirmed' and reminder_sent = false;

-- Remplir scheduled_at_ts depuis requested_date + requested_time pour l'existant
-- substring(...) extrait uniquement HH:MM (gère "08:00", "08:00 - 09:00", etc.)
update public.appointments
set scheduled_at_ts = (
  requested_date::text || ' ' ||
  coalesce(
    substring(requested_time from '^([0-9]{2}:[0-9]{2})'),
    '08:00'
  ) || ':00+01:00'
)::timestamptz
where scheduled_at_ts is null
  and requested_date is not null;

-- ── 4. AUTO-CONFIRM PAR DÉFAUT ────────────────────────────────────────
-- Les nouveaux RDV sont confirmés immédiatement (médecin a droit d'annulation)
alter table public.appointments
  alter column status set default 'confirmed';

-- ── 5. POLICY : lecture du ticket public (via ticket_token) ──────────
drop policy if exists "anon_read_own_ticket" on public.appointments;
create policy "anon_read_own_ticket" on public.appointments
  for select
  using (ticket_token is not null);

-- ── 6. CLEANUP AUTOMATIQUE DES OTP EXPIRÉS (toutes les heures) ───────
create or replace function public.cleanup_expired_otps()
returns void language plpgsql as $$
begin
  delete from public.otp_verifications where expires_at < now();
end;
$$;

-- Si pg_cron est disponible (Supabase Pro), planifier le cleanup
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-otps', '0 * * * *',
      'select public.cleanup_expired_otps()');
  end if;
end $$;

-- ── 7. CRON RAPPELS T-1h ─────────────────────────────────────────────
-- Le cron pour les rappels SMS utilise net.http_post.
-- À configurer manuellement dans Supabase Dashboard > Cron Jobs, ou
-- exécuter SÉPARÉMENT (hors du bloc do$$) après avoir remplacé les valeurs :
--
--   select cron.schedule(
--     'appointment-reminders',
--     '*/5 * * * *',
--     $cron$
--     select net.http_post(
--       url     := 'https://VOTRE_PROJECT.supabase.co/functions/v1/send-reminder',
--       headers := '{"Content-Type":"application/json","Authorization":"Bearer VOTRE_SERVICE_ROLE_KEY"}'::jsonb,
--       body    := '{"trigger":"cron"}'::jsonb
--     )
--     $cron$
--   );

-- ════════════════════════════════════════════════════════════════════
-- DONE.
-- Étapes suivantes :
-- 1. Exécuter ce fichier dans Supabase SQL Editor ✓
-- 2. Déployer les 4 Edge Functions :
--    supabase functions deploy send-otp
--    supabase functions deploy verify-otp-book
--    supabase functions deploy send-reminder
--    supabase functions deploy cancel-appointment
-- 3. Ajouter les secrets dans Supabase Dashboard > Edge Functions > Secrets :
--    INFOBIP_API_KEY, INFOBIP_BASE_URL, OTP_SECRET, APP_URL
-- 4. Configurer le cron rappels (voir commentaire ci-dessus)
-- ════════════════════════════════════════════════════════════════════
