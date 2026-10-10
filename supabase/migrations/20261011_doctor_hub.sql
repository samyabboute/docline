-- ============================================================
-- Fiche médecin centrale (2026-10-11)
--  - lecture consolidée : activité, tickets, facturation, KYC
--  - actions sensibles côté serveur : plan offert, suspension
--  - l'auteur d'une ligne du journal est fixé par le serveur
-- ============================================================

-- Journal : l'auteur ne peut plus être fourni par le navigateur
create or replace function public.audit_log_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('performed_by', auth.email())
      || coalesce((select jsonb_build_object('performed_by_name', full_name) from symphony_staff
                    where lower(email) = lower(auth.email()) limit 1), '{}'::jsonb);
  end if;
  return new;
end;
$$;
drop trigger if exists audit_log_actor on public.audit_log;
create trigger audit_log_actor before insert on public.audit_log
  for each row execute function public.audit_log_actor();

-- Moyen de paiement des abonnements (online/transfer/cash) vers le registre
create or replace function public._ledger_method(p text)
returns text language sql immutable as $$
  select case p when 'transfer' then 'virement' when 'cash' then 'especes' when 'online' then 'chargily'
                when 'virement' then 'virement' when 'ccp' then 'ccp' when 'baridimob' then 'baridimob' when 'cib' then 'cib'
                when 'edahabia' then 'edahabia' when 'especes' then 'especes' when 'cheque' then 'cheque' when 'chargily' then 'chargily'
                else 'autre' end
$$;
create or replace function public.subscriptions_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare amt integer; req payment_requests; inv uuid; price_key text;
begin
  if new.payment_status = 'paid' and new.paid_at is not null
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid' or old.paid_at is distinct from new.paid_at)
     and coalesce(new.invoice_notes, '') <> 'admin_grant' and coalesce(new.plan, 'free') <> 'free' then
    select * into req from payment_requests where user_id = new.user_id and status in ('pending','approved','paid')
      order by created_at desc limit 1;
    price_key := 'plan_price_' || new.plan || '_' || case when coalesce(new.interval, new.billing, 'month') in ('year','yearly','annual') then 'yearly' else 'monthly' end;
    amt := coalesce(nullif(req.amount, 0), (select (value #>> '{}')::int from app_settings where app_settings.key = price_key));
    if amt is null or amt <= 0 then return new; end if;
    insert into billing_entries(number, doctor_id, kind, amount_da, direction, label, period_start, period_end, subscription_id, payment_request_id, source)
    values (_billing_number('invoice'), new.user_id, 'invoice', amt, 1, 'Abonnement Docline ' || initcap(new.plan),
            new.paid_at::date, new.expires_at::date, new.id, req.id, 'subscription')
    returning id into inv;
    insert into billing_entries(number, doctor_id, kind, amount_da, direction, label, method, external_ref, invoice_id, subscription_id, payment_request_id, source)
    values (_billing_number('payment'), new.user_id, 'payment', amt, -1, 'Paiement abonnement ' || initcap(new.plan),
            _ledger_method(coalesce(new.payment_method, req.method)),
            coalesce(req.reference, req.chargily_checkout_id), inv, new.id, req.id, 'subscription');
  end if;
  return new;
end;
$$;

-- Plan gratuit ou plan offert (essai prolongé, geste commercial). Un plan payant
-- ne s'active pas ici : il passe par la validation d'un paiement.
create or replace function public.crm_set_plan(p_doctor uuid, p_plan text, p_months int, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare exp timestamptz; prev subscriptions;
begin
  if not symphony_can('doctors.edit') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_doctor) then raise exception 'DOCTOR_NOT_FOUND'; end if;
  if p_plan not in ('free','pro','clinic') then raise exception 'PLAN_INVALID'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into prev from subscriptions where user_id = p_doctor;
  if p_plan = 'free' then
    insert into subscriptions(user_id, plan, status, payment_status, expires_at, trial_end_date)
    values (p_doctor, 'free', 'active', null, null, null)
    on conflict (user_id) do update set plan = 'free', status = 'active', payment_status = null, expires_at = null,
       trial_end_date = null, invoice_notes = null, updated_at = now();
  else
    if coalesce(p_months, 0) not between 1 and 24 then raise exception 'DURATION_INVALID'; end if;
    exp := now() + make_interval(months => p_months);
    insert into subscriptions(user_id, plan, status, payment_status, invoice_notes, interval, started_at, expires_at,
                              current_period_start, current_period_end)
    values (p_doctor, p_plan, 'active', 'complimentary', 'admin_grant', case when p_months >= 12 then 'year' else 'month' end,
            now(), exp, now(), exp)
    on conflict (user_id) do update set plan = excluded.plan, status = 'active', payment_status = 'complimentary',
       invoice_notes = 'admin_grant', interval = excluded.interval, started_at = now(), expires_at = exp,
       current_period_start = now(), current_period_end = exp, updated_at = now();
    update profiles set trial_ends_at = exp, plan = p_plan where id = p_doctor;
  end if;
  insert into audit_log(user_id, event, metadata) values (p_doctor, case when p_plan = 'free' then 'plan_change' else 'geste_commercial' end,
    jsonb_build_object('plan', p_plan, 'duration', p_months, 'motif', trim(p_reason), 'note', nullif(trim(p_note), ''),
                       'expires_at', exp, 'previous_plan', prev.plan, 'previous_expires_at', prev.expires_at));
  return jsonb_build_object('plan', p_plan, 'expires_at', exp);
end;
$$;

-- Suspension / réactivation, motif obligatoire pour suspendre
create or replace function public.crm_set_active(p_doctor uuid, p_active boolean, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('doctors.edit') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not p_active and coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_active then
    update profiles set is_active = true where id = p_doctor;
    update subscriptions set status = 'active' where user_id = p_doctor and status = 'suspended';
  else
    update profiles set is_active = false, is_public = false where id = p_doctor;
    update subscriptions set status = 'suspended' where user_id = p_doctor;
  end if;
  if not found then null; end if;
  insert into kyc_audit_log(doctor_id, action, reviewer_id, note)
  values (p_doctor, case when p_active then 'activated' else 'deactivated' end, auth.uid(), nullif(trim(p_reason), ''));
  insert into audit_log(user_id, event, metadata) values (p_doctor, case when p_active then 'unblock' else 'block' end,
    jsonb_build_object('reason', nullif(trim(p_reason), '')));
  return true;
end;
$$;

-- Vue d'ensemble de la fiche
create or replace function public.doctor_hub(p_doctor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not symphony_can('doctors.view') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  res := jsonb_build_object(
    'activity', jsonb_build_object(
      'patients', (select count(*) from clients where user_id = p_doctor),
      'patients_30d', (select count(*) from clients where user_id = p_doctor and created_at > now() - interval '30 days'),
      'appointments', (select count(*) from appointments where doctor_id = p_doctor),
      'appointments_30d', (select count(*) from appointments where doctor_id = p_doctor and created_at > now() - interval '30 days'),
      'online_bookings_30d', (select count(*) from appointments a where a.doctor_id = p_doctor and a.created_at > now() - interval '30 days'
                                and exists (select 1 from clients c where c.id = a.client_id and c.source = 'online_booking'))),
    'tickets', jsonb_build_object(
      'open', (select count(*) from tickets where doctor_id = p_doctor and status not in ('resolved','closed')),
      'total', (select count(*) from tickets where doctor_id = p_doctor),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'title', t.title, 'status', t.status, 'priority', t.priority,
                 'service', (select name from ticket_services where key = t.service_key), 'assignee', _staff_name(t.assignee_id),
                 'created_at', t.created_at, 'resolved_at', t.resolved_at) order by t.status in ('resolved','closed'), t.created_at desc)
                 from (select * from tickets where doctor_id = p_doctor order by created_at desc limit 15) t), '[]')),
    'can', jsonb_build_object('edit', symphony_can('doctors.edit'), 'billing', symphony_can('billing.view'), 'kyc', symphony_can('kyc.view'),
                              'kyc_decide', symphony_can('kyc.decide'), 'extend', symphony_can('billing.extend'),
                              'delete', symphony_can('users.sensitive'), 'featured', symphony_can('featured.manage'),
                              'tickets', symphony_can('tickets.create')));
  if symphony_can('billing.view') then
    res := res || jsonb_build_object('billing', jsonb_build_object(
      'balance', coalesce((select sum(amount_da * direction) from billing_entries where doctor_id = p_doctor), 0),
      'paid_12m', coalesce((select sum(amount_da) from billing_entries where doctor_id = p_doctor and kind = 'payment' and created_at > now() - interval '12 months'), 0),
      'pending_extension', (select to_jsonb(x) from billing_extensions x where doctor_id = p_doctor and status = 'pending' limit 1),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('number', e.number, 'kind', e.kind, 'label', e.label, 'amount_da', e.amount_da,
                  'direction', e.direction, 'created_at', e.created_at) order by e.created_at desc)
                  from (select * from billing_entries where doctor_id = p_doctor order by created_at desc limit 6) e), '[]')));
  end if;
  if symphony_can('kyc.view') then
    res := res || jsonb_build_object('kyc_log', coalesce((select jsonb_agg(jsonb_build_object('action', k.action, 'note', k.note, 'created_at', k.created_at,
               'reviewer', (select coalesce(s.full_name, u.email) from auth.users u left join symphony_staff s on lower(s.email) = lower(u.email) where u.id = k.reviewer_id))
               order by k.created_at desc) from (select * from kyc_audit_log where doctor_id = p_doctor order by created_at desc limit 20) k), '[]'));
  end if;
  return res;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['audit_log_actor()','_ledger_method(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['crm_set_plan(uuid,text,int,text,text)','crm_set_active(uuid,boolean,text)','doctor_hub(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
alter function public.audit_log_actor() owner to postgres;
alter function public.subscriptions_ledger() owner to postgres;
alter function public.crm_set_plan(uuid,text,int,text,text) owner to postgres;
alter function public.crm_set_active(uuid,boolean,text) owner to postgres;
alter function public.doctor_hub(uuid) owner to postgres;
