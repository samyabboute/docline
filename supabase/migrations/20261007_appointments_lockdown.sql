-- ============================================================
-- Appointments lockdown (2026-10-07)
-- The anon policies below did not compare any token: anyone could
-- read every appointment (names, phones, emails) and update them.
-- Replaced by token-checked SECURITY DEFINER RPCs that expose only
-- what each public page needs.
-- ============================================================

drop policy if exists anon_read_own_ticket      on public.appointments;
drop policy if exists anon_confirm_by_token     on public.appointments;
drop policy if exists anon_update_confirmation  on public.appointments;

-- Taken slots for the public booking calendars (no patient data)
create or replace function public.booked_slots(p_doctor uuid, p_date date)
returns setof text
language sql stable security definer set search_path = public as $$
  select a.requested_time::text
    from appointments a
   where a.doctor_id = p_doctor
     and a.requested_date = p_date
     and a.status in ('pending','confirmed');
$$;

-- Ticket page (?t=ticket_token)
create or replace function public.get_ticket(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'patient_name', a.patient_name, 'patient_phone', a.patient_phone,
    'requested_date', a.requested_date, 'requested_time', a.requested_time,
    'status', a.status, 'ticket_token', a.ticket_token, 'created_at', a.created_at,
    'profiles', jsonb_build_object(
      'first_name', p.first_name, 'last_name', p.last_name, 'clinic_name', p.clinic_name,
      'is_clinic', p.is_clinic, 'specialty', p.specialty, 'wilaya', p.wilaya, 'city', p.city,
      'avatar_url', p.avatar_url, 'address', p.address, 'phone_public', p.phone_public))
    from appointments a
    left join profiles p on p.id = a.doctor_id
   where p_token is not null and length(p_token) >= 16
     and a.ticket_token = p_token
   limit 1;
$$;

-- Confirmation page (?token=confirmation_token)
create or replace function public.get_confirmation(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'patient_name', a.patient_name, 'patient_phone', a.patient_phone,
    'requested_date', a.requested_date, 'requested_time', a.requested_time,
    'status', a.status, 'patient_confirmed', a.patient_confirmed, 'doctor_id', a.doctor_id,
    'doctor_label', coalesce(nullif(p.full_name,''), case when p.is_clinic then p.clinic_name end))
    from appointments a
    left join profiles p on p.id = a.doctor_id
   where p_token is not null and length(p_token) >= 16
     and a.confirmation_token = p_token
   limit 1;
$$;

create or replace function public.respond_confirmation(p_token text, p_action text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_token is null or length(p_token) < 16 then return false; end if;
  if p_action = 'confirm' then
    update appointments set patient_confirmed = true
     where confirmation_token = p_token and status in ('pending','confirmed');
  elsif p_action = 'cancel' then
    update appointments set status = 'cancelled'
     where confirmation_token = p_token and status in ('pending','confirmed');
  else
    return false;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Queue check-in: patient types their phone at the clinic kiosk
create or replace function public.queue_find_appointment(p_doctor uuid, p_phone text)
returns table(id uuid, patient_name text, requested_time text, status text)
language sql stable security definer set search_path = public as $$
  with ph as (
    select regexp_replace(coalesce(p_phone,''), '\D', '', 'g') as d
  ), core as (
    select case when d like '213%' then substr(d,4) else ltrim(d,'0') end as n from ph
  )
  select a.id, split_part(coalesce(a.patient_name,''),' ',1), a.requested_time::text, a.status
    from appointments a, core
   where length(core.n) >= 8
     and a.doctor_id = p_doctor
     and a.requested_date = (now() at time zone 'Africa/Algiers')::date
     and a.status in ('pending','confirmed')
     and coalesce(a.no_show,false) = false
     and right(regexp_replace(coalesce(a.patient_phone,''), '\D', '', 'g'), 9) = right(core.n, 9)
   order by a.requested_time;
$$;

create or replace function public.queue_mark_arrived(p_appt uuid, p_phone text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; d text;
begin
  d := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  if length(d) < 8 then return false; end if;
  update appointments set arrived_at = now(), patient_confirmed = true
   where id = p_appt
     and right(regexp_replace(coalesce(patient_phone,''), '\D', '', 'g'), 9) = right(d, 9);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.booked_slots(uuid,date)              from public;
revoke all on function public.get_ticket(text)                     from public;
revoke all on function public.get_confirmation(text)               from public;
revoke all on function public.respond_confirmation(text,text)      from public;
revoke all on function public.queue_find_appointment(uuid,text)    from public;
revoke all on function public.queue_mark_arrived(uuid,text)        from public;
grant execute on function public.booked_slots(uuid,date)           to anon, authenticated;
grant execute on function public.get_ticket(text)                  to anon, authenticated;
grant execute on function public.get_confirmation(text)            to anon, authenticated;
grant execute on function public.respond_confirmation(text,text)   to anon, authenticated;
grant execute on function public.queue_find_appointment(uuid,text) to anon, authenticated;
grant execute on function public.queue_mark_arrived(uuid,text)     to anon, authenticated;
