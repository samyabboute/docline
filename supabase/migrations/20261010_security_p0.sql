-- ============================================================
-- Sécurité P0 (2026-10-10) — voir docs/PRODUCT_AUDIT.md
--  1. subscriptions : n'importe quel médecin connecté pouvait modifier
--     tous les abonnements (policy ALL authenticated true/true), et
--     s'attribuer un plan payant illimité à l'inscription.
--  2. incidents / incident_updates : policy « service_role » à true pour
--     tout le monde, y compris les visiteurs anonymes.
--  3. profiles : tout utilisateur connecté lisait tous les profils
--     (emails, téléphones, références KYC), et les visiteurs anonymes
--     toutes les colonnes des médecins publics.
-- ============================================================

-- ── 1. Abonnements ──────────────────────────────────────────
drop policy if exists admin_payment_update on public.subscriptions;
drop policy if exists "admin read all subscriptions" on public.subscriptions;

create policy subs_staff_read on public.subscriptions
  for select to authenticated using (symphony_is_staff());
create policy subs_staff_write on public.subscriptions
  for all to authenticated
  using (symphony_can('payments.decide') or symphony_can('doctors.edit'))
  with check (symphony_can('payments.decide') or symphony_can('doctors.edit'));
-- Le médecin crée son propre abonnement à l'inscription (jamais de mise à jour).
drop policy if exists subs_own_insert on public.subscriptions;
create policy subs_own_insert on public.subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

-- Garde-fou côté serveur : un abonnement créé par le médecin lui-même est
-- un essai de 7 jours en attente de paiement. Seuls le service (paiements,
-- webhooks) et l'équipe autorisée peuvent l'activer ou le modifier.
create or replace function public.subscriptions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.role() = 'service_role'
     or symphony_can('payments.decide') or symphony_can('doctors.edit') then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'SUBSCRIPTION_READ_ONLY' using errcode = '42501';
  end if;
  new.status := 'active';
  new.paid_at := null;
  new.activated_by := null;
  new.invoice_notes := null;
  if coalesce(new.plan, 'free') = 'free' then
    new.plan := 'free';
    new.payment_status := null;
    new.expires_at := null;
    new.trial_end_date := null;
  else
    new.payment_status := 'pending';
    new.trial_end_date := now() + interval '7 days';
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end;
$$;
drop trigger if exists subscriptions_guard on public.subscriptions;
create trigger subscriptions_guard before insert or update on public.subscriptions
  for each row execute function public.subscriptions_guard();

-- ── 2. Incidents ────────────────────────────────────────────
drop policy if exists service_role_incidents on public.incidents;
drop policy if exists service_role_incident_updates on public.incident_updates;
create policy incidents_staff on public.incidents
  for all to authenticated using (symphony_can('incidents.view')) with check (symphony_can('incidents.view'));
create policy incident_updates_staff on public.incident_updates
  for all to authenticated using (symphony_can('incidents.view')) with check (symphony_can('incidents.view'));

-- ── 3. Profils ──────────────────────────────────────────────
-- Annuaire public : uniquement des colonnes publiques, uniquement les
-- médecins qui ont choisi d'être visibles.
create or replace view public.public_doctors as
  select id, full_name, first_name, last_name, is_clinic, clinic_name, specialty,
         wilaya, city, address, bio, consultation_price, accepts_rdv, phone_public,
         languages, avatar_url, featured, is_public, is_active, slug, updated_at
    from public.profiles
   where is_public = true and is_active = true;
grant select on public.public_doctors to anon, authenticated;

-- Carte publique d'un cabinet (écran de salle d'attente, borne d'accueil)
create or replace function public.public_profile_card(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'full_name', full_name, 'first_name', first_name,
    'last_name', last_name, 'clinic_name', clinic_name, 'is_clinic', is_clinic,
    'specialty', specialty, 'wilaya', wilaya, 'city', city, 'avatar_url', avatar_url)
    from profiles where id = p_id and coalesce(is_active, true)
$$;
revoke all on function public.public_profile_card(uuid) from public;
grant execute on function public.public_profile_card(uuid) to anon, authenticated;

-- Une clinique retrouve un médecin par email pour l'ajouter à son équipe
create or replace function public.clinic_find_doctor(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me profiles; r jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not coalesce(me.is_clinic, false) then return null; end if;
  select jsonb_build_object('id', id, 'full_name', full_name, 'specialty', specialty, 'email', email)
    into r from profiles
   where lower(email) = lower(trim(p_email)) and id <> me.id and not coalesce(is_clinic, false)
   limit 1;
  return r;
end;
$$;
revoke all on function public.clinic_find_doctor(text) from public, anon;
grant execute on function public.clinic_find_doctor(text) to authenticated;

drop policy if exists "Admin read all profiles" on public.profiles;
drop policy if exists "admin read all profiles" on public.profiles;
drop policy if exists anon_read_public_profiles on public.profiles;
drop policy if exists "public can read active profiles" on public.profiles;
create policy profiles_staff_read on public.profiles
  for select to authenticated using (symphony_is_staff());
create policy profiles_clinic_members_read on public.profiles
  for select to authenticated using (exists (
    select 1 from clinic_doctors cd where cd.clinic_id = auth.uid() and cd.doctor_id = profiles.id));

-- La vue et les fonctions publiques s'exécutent avec les droits de postgres,
-- qui ne voit que ce qu'elles exposent explicitement.
alter view public.public_doctors owner to postgres;
alter function public.public_profile_card(uuid) owner to postgres;
alter function public.clinic_find_doctor(text) owner to postgres;
alter function public.subscriptions_guard() owner to postgres;
