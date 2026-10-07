-- ============================================================
-- Patient space (2026-10-07)
-- 1. Lab results lockdown: the public policies let anyone list and
--    update every unexpired result. Replaced by a code-checked RPC.
-- 2. Passwordless patient accounts: phone + SMS code. Sessions are
--    opaque tokens (only their SHA-256 is stored). All patient data
--    goes through SECURITY DEFINER RPCs taking the session token.
-- Booking itself still never requires an account.
-- ============================================================

-- ── 1. Lab results ───────────────────────────────────────────
drop policy if exists public_view_lab_by_code   on public.lab_results;
drop policy if exists public_update_view_count  on public.lab_results;

create or replace function public.get_lab_result(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r lab_results;
begin
  if p_code is null or length(trim(p_code)) < 6 then return null; end if;
  select * into r from lab_results
   where access_code = upper(trim(p_code)) and expires_at > now()
   limit 1;
  if r.id is null then return null; end if;
  update lab_results set view_count = coalesce(view_count,0) + 1,
                         viewed_at  = coalesce(viewed_at, now())
   where id = r.id;
  return jsonb_build_object(
    'id', r.id, 'patient_name', r.patient_name, 'title', r.title,
    'description', r.description, 'file_url', r.file_url,
    'access_code', r.access_code, 'expires_at', r.expires_at,
    'created_at', r.created_at, 'view_count', coalesce(r.view_count,0) + 1);
end;
$$;

-- ── 2. Patient accounts ──────────────────────────────────────
alter table public.patients
  add column if not exists email              text,
  add column if not exists birth_date         date,
  add column if not exists wilaya             text,
  add column if not exists account_created_at timestamptz,
  add column if not exists last_login_at      timestamptz,
  add column if not exists sms_reminders      boolean not null default true,
  add column if not exists email_reminders    boolean not null default true;

create table if not exists public.patient_sessions (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '2 hours',
  last_seen_at timestamptz,
  user_agent   text
);
create index if not exists patient_sessions_patient_idx on public.patient_sessions(patient_id);
alter table public.patient_sessions enable row level security;

create table if not exists public.patient_relatives (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  full_name  text not null,
  relation   text not null default 'autre',
  birth_date date,
  created_at timestamptz not null default now()
);
create index if not exists patient_relatives_patient_idx on public.patient_relatives(patient_id);
alter table public.patient_relatives enable row level security;

-- Session → patient id (null when invalid / expired). Internal only.
create or replace function public._patient_from_session(p_session text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if p_session is null or length(p_session) < 24 then return null; end if;
  update patient_sessions
     set last_seen_at = now()
   where token_hash = encode(extensions.digest(p_session, 'sha256'), 'hex')
     and expires_at > now()
  returning patient_id into pid;
  return pid;
end;
$$;
revoke all on function public._patient_from_session(text) from public, anon, authenticated;

-- Turns a short booking session into a 90-day account session
create or replace function public.patient_activate(p_session text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session);
begin
  if pid is null then return false; end if;
  update patients set account_created_at = coalesce(account_created_at, now()),
                      last_login_at = now()
   where id = pid;
  update patient_sessions set expires_at = now() + interval '90 days'
   where token_hash = encode(extensions.digest(p_session, 'sha256'), 'hex');
  return true;
end;
$$;

create or replace function public.patient_me(p_session text)
returns jsonb
language sql security definer set search_path = public as $$
  with me as (select _patient_from_session(p_session) as pid)
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone_e164,
    'email', p.email, 'birth_date', p.birth_date, 'wilaya', p.wilaya,
    'account_created_at', p.account_created_at,
    'sms_reminders', p.sms_reminders, 'email_reminders', p.email_reminders,
    'relatives', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'full_name', r.full_name, 'relation', r.relation, 'birth_date', r.birth_date)
        order by r.created_at)
      from patient_relatives r where r.patient_id = p.id), '[]'::jsonb))
    from me join patients p on p.id = me.pid;
$$;

create or replace function public.patient_appointments(p_session text)
returns jsonb
language sql security definer set search_path = public as $$
  with me as (
    select p.id, right(regexp_replace(coalesce(p.phone_e164,''), '\D', '', 'g'), 9) as ph
      from patients p where p.id = _patient_from_session(p_session)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'requested_date', a.requested_date, 'requested_time', a.requested_time,
      'status', a.status, 'patient_name', a.patient_name, 'notes', a.notes,
      'ticket_token', a.ticket_token, 'created_at', a.created_at,
      'doctor', jsonb_build_object(
        'id', d.id, 'first_name', d.first_name, 'last_name', d.last_name,
        'full_name', d.full_name, 'clinic_name', d.clinic_name, 'is_clinic', d.is_clinic,
        'specialty', d.specialty, 'city', d.city, 'wilaya', d.wilaya,
        'address', d.address, 'avatar_url', d.avatar_url, 'phone_public', d.phone_public))
      order by a.requested_date desc, a.requested_time desc), '[]'::jsonb)
    from me
    join appointments a
      on a.patient_id = me.id
      or (length(me.ph) = 9 and right(regexp_replace(coalesce(a.patient_phone,''), '\D', '', 'g'), 9) = me.ph)
    left join profiles d on d.id = a.doctor_id;
$$;

create or replace function public.patient_cancel(p_session text, p_appt uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session); ph text; n int;
begin
  if pid is null then return false; end if;
  select right(regexp_replace(coalesce(phone_e164,''), '\D', '', 'g'), 9) into ph from patients where id = pid;
  update appointments a set status = 'cancelled', updated_at = now()
   where a.id = p_appt
     and a.status in ('pending','confirmed')
     and a.requested_date >= (now() at time zone 'Africa/Algiers')::date
     and (a.patient_id = pid
          or (length(ph) = 9 and right(regexp_replace(coalesce(a.patient_phone,''), '\D', '', 'g'), 9) = ph));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.patient_update_profile(
  p_session text, p_full_name text, p_email text, p_birth_date date,
  p_wilaya text, p_sms boolean, p_email_rem boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session);
begin
  if pid is null then return false; end if;
  if p_email is not null and p_email <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALID';
  end if;
  update patients set
    full_name       = coalesce(nullif(trim(p_full_name),''), full_name),
    email           = nullif(trim(p_email),''),
    birth_date      = p_birth_date,
    wilaya          = nullif(trim(p_wilaya),''),
    sms_reminders   = coalesce(p_sms, sms_reminders),
    email_reminders = coalesce(p_email_rem, email_reminders),
    account_created_at = coalesce(account_created_at, now())
  where id = pid;
  return true;
end;
$$;

create or replace function public.patient_add_relative(
  p_session text, p_full_name text, p_relation text, p_birth_date date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session); rid uuid;
begin
  if pid is null or coalesce(trim(p_full_name),'') = '' then return null; end if;
  if (select count(*) from patient_relatives where patient_id = pid) >= 10 then
    raise exception 'TOO_MANY_RELATIVES';
  end if;
  insert into patient_relatives(patient_id, full_name, relation, birth_date)
  values (pid, trim(p_full_name), coalesce(nullif(p_relation,''),'autre'), p_birth_date)
  returning id into rid;
  return rid;
end;
$$;

create or replace function public.patient_remove_relative(p_session text, p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session); n int;
begin
  if pid is null then return false; end if;
  delete from patient_relatives where id = p_id and patient_id = pid;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.patient_lab_results(p_session text)
returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'title', l.title, 'access_code', l.access_code,
      'created_at', l.created_at, 'expires_at', l.expires_at,
      'clinic', coalesce(nullif(d.full_name,''), d.clinic_name))
      order by l.created_at desc), '[]'::jsonb)
    from lab_results l
    left join profiles d on d.id = l.clinic_id
   where l.patient_id = _patient_from_session(p_session)
     and l.expires_at > now();
$$;

create or replace function public.patient_logout(p_session text)
returns boolean
language sql security definer set search_path = public as $$
  delete from patient_sessions
   where token_hash = encode(extensions.digest(coalesce(p_session,''), 'sha256'), 'hex')
  returning true;
$$;

-- Right to erasure: removes the account layer. Appointments stay with
-- the doctor (medical record), only the account data is deleted.
create or replace function public.patient_delete_account(p_session text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session);
begin
  if pid is null then return false; end if;
  delete from patient_relatives where patient_id = pid;
  update patients set email = null, birth_date = null, wilaya = null,
                      account_created_at = null, last_login_at = null
   where id = pid;
  delete from patient_sessions where patient_id = pid;
  return true;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'get_lab_result(text)',
    'patient_activate(text)', 'patient_me(text)', 'patient_appointments(text)',
    'patient_cancel(text,uuid)',
    'patient_update_profile(text,text,text,date,text,boolean,boolean)',
    'patient_add_relative(text,text,text,date)', 'patient_remove_relative(text,uuid)',
    'patient_lab_results(text)', 'patient_logout(text)', 'patient_delete_account(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
