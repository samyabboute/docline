-- ════════════════════════════════════════════════════════════════════
-- Réparation du schéma : aligne la base de production sur le code.
-- Issu de l'audit QA du 06/10/2026 (comparaison code ↔ schéma réel).
-- Idempotent : peut être exécuté plusieurs fois.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Paiements ─────────────────────────────────────────────────────
-- Colonnes utilisées par la page Tarifs (référence de virement) et par Chargily (paiement en ligne)
alter table public.payment_requests
  add column if not exists reference            text,
  add column if not exists chargily_checkout_id text;
create index if not exists idx_payment_requests_checkout on public.payment_requests (chargily_checkout_id);

-- Valeurs écrites par le code mais refusées jusqu'ici
alter table public.payment_requests drop constraint if exists payment_requests_method_check;
alter table public.payment_requests add constraint payment_requests_method_check
  check (method in ('cib','edahabia','baridimob','virement','cash','penalty','complimentary'));
alter table public.payment_requests drop constraint if exists payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check
  check (status in ('pending','approved','confirmed','rejected','failed','refunded'));
alter table public.payment_requests drop constraint if exists payment_requests_plan_check;
alter table public.payment_requests add constraint payment_requests_plan_check
  check (plan in ('pro','enterprise','clinic'));

alter table public.subscriptions drop constraint if exists subscriptions_payment_status_check;
alter table public.subscriptions add constraint subscriptions_payment_status_check
  check (payment_status in ('pending','paid','failed','refunded','complimentary'));

-- ── 2. Médecins : délai de paiement (CRM Symphony) ───────────────────
alter table public.profiles
  add column if not exists payment_deadline timestamptz,
  add column if not exists extension_count  integer not null default 0;

-- ── 3. Laboratoire ───────────────────────────────────────────────────
alter table public.lab_results
  add column if not exists patient_id uuid references public.clients(id) on delete set null,
  add column if not exists viewed_at  timestamptz;

-- ── 4. Factures automatiques (devis → facture) ───────────────────────
alter table public.invoices
  add column if not exists proposal_id uuid,
  add column if not exists currency    text not null default 'DZD';

-- ── 5. Agenda partagé des cliniques (migration 20260515 jamais appliquée) ──
create table if not exists public.clinic_doctors (
  id          uuid default gen_random_uuid() primary key,
  clinic_id   uuid references public.profiles(id) on delete cascade not null,
  doctor_id   uuid references public.profiles(id) on delete cascade not null,
  color       text default '#3B1772',
  joined_at   timestamptz default now() not null,
  unique (clinic_id, doctor_id)
);
alter table public.clinic_doctors enable row level security;
drop policy if exists "clinic_owner_manage_doctors" on public.clinic_doctors;
create policy "clinic_owner_manage_doctors" on public.clinic_doctors
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
drop policy if exists "doctor_view_own_membership" on public.clinic_doctors;
create policy "doctor_view_own_membership" on public.clinic_doctors
  for select using (auth.uid() = doctor_id);
create index if not exists idx_clinic_doctors_clinic on public.clinic_doctors (clinic_id);
create index if not exists idx_clinic_doctors_doctor on public.clinic_doctors (doctor_id);

drop policy if exists "clinic_owner_view_member_appointments" on public.appointments;
create policy "clinic_owner_view_member_appointments" on public.appointments
  for select using (
    auth.uid() = doctor_id
    or exists (select 1 from public.clinic_doctors cd
               where cd.clinic_id = auth.uid() and cd.doctor_id = appointments.doctor_id));

-- ── 6. Journal d'audit : la table n'avait aucune règle d'accès ───────
-- L'équipe Symphony lit tout ; chacun peut tracer ses propres événements ;
-- l'équipe peut tracer des événements sur un médecin (notes CRM, emails…).
alter table public.audit_log enable row level security;
drop policy if exists "audit_log_staff_read" on public.audit_log;
create policy "audit_log_staff_read" on public.audit_log
  for select to authenticated using (symphony_is_staff());
drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert" on public.audit_log
  for insert to authenticated with check (user_id = auth.uid() or symphony_is_staff());

-- ── 7. Cockpit : les paiements validés manuellement sont en « approved » ──
create or replace function public.symphony_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '{}'::jsonb;
  v   jsonb;
begin
  if not symphony_is_staff() then raise exception 'Accès refusé'; end if;

  begin
    select jsonb_build_object(
      'doctors_total',   count(*),
      'doctors_public',  count(*) filter (where is_public),
      'doctors_new_30d', count(*) filter (where created_at > now() - interval '30 days'),
      'doctors_new_prev_30d', count(*) filter (where created_at <= now() - interval '30 days'
                                                 and created_at > now() - interval '60 days'),
      'kyc_pending',     count(*) filter (where kyc_status = 'pending_review'))
    into v from profiles;
    out := out || v;
  exception when others then null; end;

  begin
    select jsonb_build_object('signups_weekly', coalesce(jsonb_agg(n order by w), '[]'::jsonb))
    into v from (
      select gs.w, (select count(*) from profiles p
                     where p.created_at >= gs.w and p.created_at < gs.w + interval '7 days') as n
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as gs(w)
    ) s;
    out := out || v;
  exception when others then null; end;

  if symphony_can('payments.view') or symphony_can('revenue.view') then
    begin
      select jsonb_build_object(
        'payments_pending',        count(*) filter (where status = 'pending'),
        'payments_pending_amount', coalesce(sum(amount) filter (where status = 'pending'), 0),
        'cash_30d',                coalesce(sum(amount) filter (where status in ('approved','confirmed') and created_at > now() - interval '30 days'), 0),
        'cash_prev_30d',           coalesce(sum(amount) filter (where status in ('approved','confirmed') and created_at <= now() - interval '30 days'
                                                                  and created_at > now() - interval '60 days'), 0))
      into v from payment_requests;
      out := out || v;
    exception when others then null; end;
  end if;

  begin
    select jsonb_build_object(
      'paid_subscriptions', count(*) filter (where plan in ('pro','clinic','enterprise') and status in ('active','trialing')))
    into v from subscriptions;
    out := out || v;
  exception when others then null; end;

  begin
    select jsonb_build_object('appointments_30d', count(*)) into v
    from appointments where created_at > now() - interval '30 days';
    out := out || v;
  exception when others then null; end;

  begin
    select jsonb_build_object(
      'tasks_open',    count(*) filter (where status <> 'done'),
      'tasks_overdue', count(*) filter (where status <> 'done' and due_date < current_date),
      'tasks_mine',    count(*) filter (where status <> 'done' and assignee_email = lower(auth.email())),
      'tasks_done_7d', count(*) filter (where status = 'done' and completed_at > now() - interval '7 days'))
    into v from symphony_tasks t
    where symphony_can('tasks.view_all') or t.assignee_email = lower(auth.email())
       or t.created_by_email = lower(auth.email()) or t.department = symphony_my_department();
    out := out || v;
  exception when others then null; end;

  begin
    select jsonb_build_object('team_active', count(*) filter (where is_active),
                              'team_online_24h', count(*) filter (where is_active and last_seen_at > now() - interval '24 hours'))
    into v from symphony_staff;
    out := out || v;
  exception when others then null; end;

  if symphony_can('demand.view') then
    begin
      select jsonb_build_object('demand_gaps', coalesce(jsonb_agg(g), '[]'::jsonb)) into v from (
        select e.specialty, e.wilaya, count(*) as searches,
               (select count(*) from profiles p where p.is_public and p.specialty = e.specialty
                  and lower(p.wilaya) = lower(e.wilaya)) as doctors
        from search_events e
        where e.wilaya is not null and e.created_at > now() - interval '30 days'
        group by e.specialty, e.wilaya
        order by count(*) desc
        limit 40
      ) g where g.doctors = 0;
      out := out || v;
    exception when others then null; end;
  end if;

  return out;
end;
$$;
revoke all on function public.symphony_overview() from public, anon;
grant execute on function public.symphony_overview() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. SÉCURITÉ (audit Supabase du 06/10/2026)
-- ════════════════════════════════════════════════════════════════════

-- 8.1 Vue des RDV du jour : elle ignorait les règles d'accès et était lisible sans compte
--     (noms et téléphones des patients de tous les médecins). Elle respecte désormais
--     les règles de la table appointments, et n'est plus accessible aux visiteurs.
alter view public.v_today_appointments set (security_invoker = true);
revoke all on public.v_today_appointments from anon;
revoke insert, update, delete, truncate, trigger, references on public.v_today_appointments from authenticated;

-- 8.2 submit_kyc : n'importe qui pouvait modifier le dossier KYC de n'importe quel médecin
create or replace function public.submit_kyc(p_doctor_id uuid, p_document_url text,
  p_document_type text default 'ordre', p_order_number text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old_status text;
begin
  if auth.uid() is null or (auth.uid() <> p_doctor_id and not symphony_is_staff()) then
    raise exception 'Accès refusé';
  end if;
  select kyc_status into v_old_status from public.profiles where id = p_doctor_id;
  update public.profiles set
    kyc_status        = 'pending_review',
    kyc_document_url  = p_document_url,
    kyc_document_type = p_document_type,
    kyc_order_number  = coalesce(p_order_number, kyc_order_number),
    kyc_submitted_at  = now(),
    kyc_reviewed_at   = null,
    kyc_reviewer_id   = null,
    kyc_reject_reason = null,
    updated_at        = now()
  where id = p_doctor_id;
  insert into public.kyc_audit_log (doctor_id, action, document_url)
  values (p_doctor_id, case when v_old_status = 'rejected' then 'resubmitted' else 'submitted' end, p_document_url);
end;
$$;

-- 8.3 check_lead_limit : renvoyait le plan de n'importe quel compte
create or replace function public.check_lead_limit(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_plan text; v_count int; v_limit int;
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not symphony_is_staff()) then
    raise exception 'Accès refusé';
  end if;
  select plan into v_plan from public.subscriptions where user_id = p_user_id;
  select count(*) into v_count from public.leads where user_id = p_user_id;
  v_limit := case v_plan when 'pro' then 999999 when 'team' then 999999 else 10 end;
  return jsonb_build_object('allowed', v_count < v_limit, 'count', v_count, 'limit', v_limit, 'plan', coalesce(v_plan, 'free'));
end;
$$;

-- 8.4 Fonctions sensibles : plus exécutables sans compte
revoke all on function public.submit_kyc(uuid, text, text, text)        from public, anon;
revoke all on function public.check_lead_limit(uuid)                    from public, anon;
revoke all on function public.admin_insert_simulated_feedback(jsonb)    from public, anon;
grant execute on function public.submit_kyc(uuid, text, text, text)     to authenticated;
grant execute on function public.check_lead_limit(uuid)                 to authenticated;
grant execute on function public.admin_insert_simulated_feedback(jsonb) to authenticated;
-- Fonctions de déclencheur : jamais appelées directement
revoke all on function public.symphony_sync_admin_roles() from public, anon, authenticated;
revoke all on function public.handle_new_user()           from public, anon, authenticated;

-- 8.5 search_path figé sur toutes les fonctions qui ne l'avaient pas (recommandation Supabase)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;
