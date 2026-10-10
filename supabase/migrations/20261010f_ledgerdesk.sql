-- ============================================================
-- LedgerDesk : compte de facturation des médecins (2026-10-10)
-- Registre en écriture seule : une erreur se corrige par un avoir ou
-- un ajustement, jamais par une modification. Les numéros sont
-- attribués par le serveur. Montants en dinars, entiers.
-- Échéance : profiles.payment_deadline / extension_count (existants).
-- ============================================================

create table if not exists public.billing_counters (
  kind text not null, year int not null, last int not null default 0,
  primary key (kind, year)
);
alter table public.billing_counters enable row level security;

create table if not exists public.billing_entries (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  doctor_id       uuid not null references public.profiles(id) on delete restrict,
  kind            text not null check (kind in ('invoice','payment','credit','adjustment')),
  amount_da       integer not null check (amount_da > 0),
  direction       smallint not null check (direction in (1,-1)),   -- +1 dû par le médecin, -1 en sa faveur
  label           text not null check (length(trim(label)) between 3 and 200),
  period_start    date,
  period_end      date,
  due_date        date,
  method          text check (method in ('virement','ccp','baridimob','cib','edahabia','especes','cheque','chargily','autre')),
  external_ref    text,
  invoice_id      uuid references public.billing_entries(id),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  note            text,
  source          text not null default 'staff' check (source in ('staff','subscription')),
  created_by      uuid references public.symphony_staff(id),
  created_by_name text,
  created_at      timestamptz not null default now(),
  constraint billing_direction_by_kind check (
    (kind = 'invoice' and direction = 1) or (kind in ('payment','credit') and direction = -1) or kind = 'adjustment'),
  constraint billing_payment_ref check (kind <> 'payment' or method is not null)
);
create index if not exists billing_entries_doctor_idx on public.billing_entries(doctor_id, created_at desc);
alter table public.billing_entries enable row level security;
drop trigger if exists billing_entries_immutable on public.billing_entries;
create trigger billing_entries_immutable before update or delete on public.billing_entries
  for each row execute function public.forbid_history_change();

create table if not exists public.billing_extensions (
  id           uuid primary key default gen_random_uuid(),
  doctor_id    uuid not null references public.profiles(id) on delete restrict,
  old_due      date,
  new_due      date not null,
  reason       text not null check (length(trim(reason)) >= 5),
  status       text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid not null references public.symphony_staff(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by   uuid references public.symphony_staff(id),
  decided_by_name text,
  decided_at   timestamptz,
  decision_note text
);
create index if not exists billing_extensions_doctor_idx on public.billing_extensions(doctor_id, requested_at desc);
create unique index if not exists billing_extensions_one_pending on public.billing_extensions(doctor_id) where status = 'pending';
alter table public.billing_extensions enable row level security;

create table if not exists public.billing_document_events (
  id          bigint generated always as identity primary key,
  doctor_id   uuid not null references public.profiles(id) on delete restrict,
  doc_type    text not null check (doc_type in ('statement','payment_slip')),
  channel     text not null check (channel in ('print','email','whatsapp')),
  outcome     text not null check (outcome in ('printed','sent','failed','opened')),
  detail      text,
  actor_id    uuid references public.symphony_staff(id),
  actor_name  text,
  created_at  timestamptz not null default now()
);
alter table public.billing_document_events enable row level security;
drop trigger if exists billing_document_events_immutable on public.billing_document_events;
create trigger billing_document_events_immutable before update or delete on public.billing_document_events
  for each row execute function public.forbid_history_change();

drop policy if exists billing_entries_read on public.billing_entries;
create policy billing_entries_read on public.billing_entries for select to authenticated
  using (doctor_id = auth.uid() or symphony_can('billing.view'));
drop policy if exists billing_extensions_read on public.billing_extensions;
create policy billing_extensions_read on public.billing_extensions for select to authenticated
  using (symphony_can('billing.view'));
drop policy if exists billing_document_events_read on public.billing_document_events;
create policy billing_document_events_read on public.billing_document_events for select to authenticated
  using (symphony_can('billing.view'));

-- ── Numérotation ──
create or replace function public._billing_number(p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now() at time zone 'Africa/Algiers'); n int;
begin
  insert into billing_counters(kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = billing_counters.last + 1
  returning last into n;
  return case p_kind when 'invoice' then 'FAC' when 'payment' then 'PAI' when 'credit' then 'AVO' else 'AJU' end
         || '-' || y || '-' || lpad(n::text, 5, '0');
end;
$$;

-- ── Écritures par l'équipe ──
create or replace function public.billing_record(
  p_doctor uuid, p_kind text, p_amount_da integer, p_label text, p_direction smallint default null,
  p_due_date date default null, p_period_start date default null, p_period_end date default null,
  p_method text default null, p_external_ref text default null, p_invoice_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); dir smallint; new_id uuid; num text;
begin
  if me is null or not (symphony_can('billing.documents') or (p_kind = 'payment' and symphony_can('payments.decide'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_doctor) then raise exception 'DOCTOR_NOT_FOUND'; end if;
  if coalesce(p_amount_da, 0) <= 0 then raise exception 'AMOUNT_INVALID'; end if;
  dir := case p_kind when 'invoice' then 1 when 'payment' then -1 when 'credit' then -1 else p_direction end;
  if dir is null then raise exception 'DIRECTION_REQUIRED'; end if;
  if p_kind = 'payment' and p_method is null then raise exception 'METHOD_REQUIRED'; end if;
  if p_kind in ('credit','adjustment') and coalesce(length(trim(p_note)), 0) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if p_invoice_id is not null and not exists (select 1 from billing_entries where id = p_invoice_id and kind = 'invoice' and doctor_id = p_doctor) then
    raise exception 'INVOICE_UNKNOWN';
  end if;
  num := _billing_number(p_kind);
  insert into billing_entries(number, doctor_id, kind, amount_da, direction, label, period_start, period_end, due_date,
                              method, external_ref, invoice_id, note, created_by, created_by_name)
  values (num, p_doctor, p_kind, p_amount_da, dir, trim(p_label), p_period_start, p_period_end,
          case when p_kind = 'invoice' then p_due_date end, p_method, nullif(trim(p_external_ref), ''), p_invoice_id,
          nullif(trim(p_note), ''), me, _staff_name(me))
  returning billing_entries.id into new_id;
  -- une nouvelle facture fixe l'échéance si aucune n'est en cours
  if p_kind = 'invoice' and p_due_date is not null then
    update profiles set payment_deadline = p_due_date
     where id = p_doctor and (payment_deadline is null or payment_deadline < current_date);
  end if;
  return jsonb_build_object('id', new_id, 'number', num);
end;
$$;

-- ── Paiement d'abonnement validé : facture + paiement enregistrés automatiquement ──
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
    if amt is null or amt <= 0 then return new; end if;   -- montant inconnu : rien n'est inventé
    insert into billing_entries(number, doctor_id, kind, amount_da, direction, label, period_start, period_end, subscription_id, payment_request_id, source)
    values (_billing_number('invoice'), new.user_id, 'invoice', amt, 1, 'Abonnement Docline ' || initcap(new.plan),
            new.paid_at::date, new.expires_at::date, new.id, req.id, 'subscription')
    returning id into inv;
    insert into billing_entries(number, doctor_id, kind, amount_da, direction, label, method, external_ref, invoice_id, subscription_id, payment_request_id, source)
    values (_billing_number('payment'), new.user_id, 'payment', amt, -1, 'Paiement abonnement ' || initcap(new.plan),
            case when coalesce(new.payment_method, req.method) in ('virement','ccp','baridimob','cib','edahabia','especes','cheque','chargily')
                 then coalesce(new.payment_method, req.method) else 'autre' end,
            coalesce(req.reference, req.chargily_checkout_id), inv, new.id, req.id, 'subscription');
  end if;
  return new;
end;
$$;
drop trigger if exists subscriptions_ledger on public.subscriptions;
create trigger subscriptions_ledger after insert or update on public.subscriptions
  for each row execute function public.subscriptions_ledger();

-- ── Prolongation d'échéance : demandée par un agent, validée par une autre personne ──
create or replace function public.billing_extension_request(p_doctor uuid, p_new_due date, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); cur date; n int; new_id uuid;
begin
  if me is null or not symphony_can('billing.extend') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select payment_deadline::date, coalesce(extension_count, 0) into cur, n from profiles pr where pr.id = p_doctor;
  if not found then raise exception 'DOCTOR_NOT_FOUND'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_new_due <= greatest(coalesce(cur, current_date), current_date) then raise exception 'DATE_INVALID'; end if;
  if p_new_due > greatest(coalesce(cur, current_date), current_date) + 30 then raise exception 'EXTENSION_TOO_LONG'; end if;
  if n >= 3 then raise exception 'TOO_MANY_EXTENSIONS'; end if;
  insert into billing_extensions(doctor_id, old_due, new_due, reason, requested_by, requested_by_name)
  values (p_doctor, cur, p_new_due, trim(p_reason), me, _staff_name(me)) returning billing_extensions.id into new_id;
  return new_id;
exception when unique_violation then raise exception 'ALREADY_PENDING';
end;
$$;

create or replace function public.billing_extension_decide(p_id uuid, p_approve boolean, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); x billing_extensions;
begin
  if me is null or not symphony_can('billing.extend') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into x from billing_extensions where id = p_id for update;
  if x.id is null then raise exception 'NOT_FOUND'; end if;
  if x.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if x.requested_by = me then
    if p_approve then raise exception 'FOUR_EYES'; end if;   -- l'auteur peut seulement annuler
    update billing_extensions set status = 'cancelled', decided_by = me, decided_by_name = _staff_name(me), decided_at = now(),
           decision_note = nullif(trim(p_note), '') where id = p_id;
    return true;
  end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  update billing_extensions set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = me, decided_by_name = _staff_name(me), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_approve then
    update profiles set payment_deadline = x.new_due, extension_count = coalesce(extension_count, 0) + 1 where id = x.doctor_id;
  end if;
  return true;
end;
$$;

-- ── Lecture ──
create or replace function public.billing_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  if not symphony_can('billing.view') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(r order by r->>'name') from (
    select jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), p.full_name, p.email),
      'email', p.email, 'phone', p.phone, 'specialty', p.specialty, 'wilaya', p.wilaya, 'plan', p.plan,
      'balance', coalesce((select sum(amount_da * direction) from billing_entries e where e.doctor_id = p.id), 0),
      'payment_deadline', p.payment_deadline) r
      from profiles p
     where (length(trim(coalesce(p_q,''))) = 0 or lower(coalesce(p.full_name,'') || ' ' || coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'') || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.phone,'')) like q)
     limit 30) s), '[]');
end;
$$;

create or replace function public.billing_account(p_doctor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  if not symphony_can('billing.view') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into p from profiles where id = p_doctor;
  if p.id is null then raise exception 'DOCTOR_NOT_FOUND'; end if;
  return jsonb_build_object(
    'doctor', jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), p.full_name, p.email),
       'email', p.email, 'phone', coalesce(p.phone, p.phone_public), 'specialty', p.specialty, 'wilaya', p.wilaya, 'city', p.city,
       'address', p.address, 'clinic_name', p.clinic_name, 'is_active', p.is_active, 'kyc_status', p.kyc_status, 'plan', p.plan,
       'payment_deadline', p.payment_deadline, 'extension_count', coalesce(p.extension_count, 0)),
    'subscription', (select to_jsonb(s) - 'stripe_customer_id' - 'stripe_subscription_id' - 'stripe_price_id'
                       from subscriptions s where s.user_id = p_doctor order by created_at desc limit 1),
    'balance', coalesce((select sum(amount_da * direction) from billing_entries where doctor_id = p_doctor), 0),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from billing_entries e
                          where e.doctor_id = p_doctor and e.created_at > now() - interval '12 months'), '[]'),
    'opening_balance', coalesce((select sum(amount_da * direction) from billing_entries
                          where doctor_id = p_doctor and created_at <= now() - interval '12 months'), 0),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'plan', r.plan, 'billing', r.billing, 'amount', r.amount, 'method', r.method,
                          'status', r.status, 'reference', r.reference, 'has_proof', r.proof_url is not null, 'proof_path', r.proof_url, 'created_at', r.created_at)
                          order by r.created_at desc) from payment_requests r where r.user_id = p_doctor and r.created_at > now() - interval '12 months'), '[]'),
    'extensions', coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from billing_extensions x where x.doctor_id = p_doctor), '[]'),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (select * from billing_document_events
                          where doctor_id = p_doctor order by created_at desc limit 20) d), '[]'),
    'bank', (select value from app_settings where key = 'billing_bank'),
    'can', jsonb_build_object('record', symphony_can('billing.documents'), 'payment', symphony_can('billing.documents') or symphony_can('payments.decide'),
                              'extend', symphony_can('billing.extend'), 'me', symphony_current_staff()));
end;
$$;

create or replace function public.billing_pending_extensions()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when symphony_can('billing.extend') then coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('doctor_name',
           (select coalesce(full_name, email) from profiles where id = x.doctor_id)) order by x.requested_at)
           from billing_extensions x where x.status = 'pending'), '[]') else '[]'::jsonb end
$$;

create or replace function public.billing_log_document(p_doctor uuid, p_doc text, p_channel text, p_outcome text, p_detail text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff();
begin
  if me is null or not symphony_can('billing.view') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into billing_document_events(doctor_id, doc_type, channel, outcome, detail, actor_id, actor_name)
  values (p_doctor, p_doc, p_channel, p_outcome, left(p_detail, 500), me, _staff_name(me));
  return true;
end;
$$;

-- ── Droits ──
do $$ declare f text; begin
  foreach f in array array['_billing_number(text)','subscriptions_ledger()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['billing_record(uuid,text,integer,text,smallint,date,date,date,text,text,uuid,text)',
    'billing_extension_request(uuid,date,text)','billing_extension_decide(uuid,boolean,text)','billing_search(text)',
    'billing_account(uuid)','billing_pending_extensions()','billing_log_document(uuid,text,text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('_billing_number','billing_record','subscriptions_ledger','billing_extension_request',
              'billing_extension_decide','billing_search','billing_account','billing_pending_extensions','billing_log_document') loop
    execute format('alter function %s owner to postgres', f.sig);
  end loop;
end $$;
