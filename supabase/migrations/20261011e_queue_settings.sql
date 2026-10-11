-- ============================================================
-- Réglages de la file d'attente (2026-10-11)
-- Le cabinet ouvre, met en pause ou ferme sa file, fixe ses horaires,
-- l'heure limite d'arrivée avant la fermeture et un plafond par jour.
-- Les règles sont appliquées par le serveur à chaque inscription.
-- Heures exprimées à l'heure d'Alger.
-- ============================================================
create table if not exists public.queue_settings (
  clinic_id       uuid primary key references public.profiles(id) on delete cascade,
  status          text not null default 'open' check (status in ('open','paused','closed')),
  open_from       time,
  open_until      time,
  last_entry_min  smallint not null default 15 check (last_entry_min between 0 and 240),
  max_per_day     smallint check (max_per_day is null or max_per_day between 1 and 999),
  show_name       boolean not null default true,
  message         text check (message is null or length(message) <= 200),
  updated_at      timestamptz not null default now()
);
alter table public.queue_settings enable row level security;
drop policy if exists queue_settings_owner on public.queue_settings;
create policy queue_settings_owner on public.queue_settings for all to authenticated
  using (clinic_id = auth.uid()) with check (clinic_id = auth.uid());

-- État de la file tel qu'un patient ou l'écran le voient
create or replace function public.queue_status(p_clinic uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s queue_settings; now_t time := (now() at time zone 'Africa/Algiers')::time;
        d date := coalesce(p_date, (now() at time zone 'utc')::date); n int; reason text := null; cutoff time;
begin
  select * into s from queue_settings where clinic_id = p_clinic;
  if s.clinic_id is null then s.status := 'open'; s.last_entry_min := 15; s.show_name := true; end if;
  select count(*) into n from queue_entries where clinic_id = p_clinic and queue_date = d;
  cutoff := case when s.open_until is not null then s.open_until - make_interval(mins => s.last_entry_min) end;
  if s.status = 'closed' then reason := 'closed';
  elsif s.status = 'paused' then reason := 'paused';
  elsif s.open_from is not null and now_t < s.open_from then reason := 'not_open_yet';
  elsif s.open_until is not null and now_t >= s.open_until then reason := 'after_hours';
  elsif cutoff is not null and now_t >= cutoff then reason := 'last_entry_passed';
  elsif s.max_per_day is not null and n >= s.max_per_day then reason := 'full';
  end if;
  return jsonb_build_object('status', s.status, 'accepting', reason is null, 'reason', reason,
    'open_from', to_char(s.open_from, 'HH24:MI'), 'open_until', to_char(s.open_until, 'HH24:MI'),
    'last_entry', to_char(cutoff, 'HH24:MI'), 'last_entry_min', s.last_entry_min,
    'max_per_day', s.max_per_day, 'count', n,
    'remaining', case when s.max_per_day is null then null else greatest(s.max_per_day - n, 0) end,
    'show_name', s.show_name, 'message', s.message);
end;
$$;

-- Le cabinet enregistre ses réglages
create or replace function public.queue_settings_save(p_status text, p_open_from time, p_open_until time,
  p_last_entry_min int, p_max_per_day int, p_show_name boolean, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('open','paused','closed') then raise exception 'STATUS_INVALID'; end if;
  if p_open_from is not null and p_open_until is not null and p_open_until <= p_open_from then raise exception 'HOURS_INVALID'; end if;
  insert into queue_settings(clinic_id, status, open_from, open_until, last_entry_min, max_per_day, show_name, message, updated_at)
  values (auth.uid(), p_status, p_open_from, p_open_until, coalesce(p_last_entry_min, 15), nullif(p_max_per_day, 0),
          coalesce(p_show_name, true), nullif(trim(p_message), ''), now())
  on conflict (clinic_id) do update set status = excluded.status, open_from = excluded.open_from, open_until = excluded.open_until,
     last_entry_min = excluded.last_entry_min, max_per_day = excluded.max_per_day, show_name = excluded.show_name,
     message = excluded.message, updated_at = now();
  return queue_status(auth.uid());
end;
$$;

-- Tableau public : nom masqué seulement si le cabinet l'autorise
create or replace function public.queue_board(p_clinic uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare show boolean;
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_clinic and coalesce(is_active, true)) then return '[]'::jsonb; end if;
  select coalesce((select show_name from queue_settings where clinic_id = p_clinic), true) into show;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'status', status, 'priority', priority,
            'room', room, 'name', case when show then _mask_name(patient_name) end, 'created_at', created_at) order by number)
          from queue_entries where clinic_id = p_clinic and queue_date = p_date), '[]'::jsonb);
end;
$$;

-- Inscription : refusée quand la file est en pause, fermée, hors horaires, trop tard ou complète
create or replace function public.queue_join(p_clinic uuid, p_date date, p_name text, p_priority text default 'normale', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; e queue_entries; recent int; st jsonb;
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 60 then raise exception 'NAME_INVALID'; end if;
  if p_priority not in ('normale', 'urgente', 'critique') then raise exception 'PRIORITY_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_clinic and coalesce(is_active, true)) then raise exception 'CLINIC_UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtext(p_clinic::text || p_date::text));
  st := queue_status(p_clinic, p_date);
  if not (st->>'accepting')::boolean then raise exception 'QUEUE_%', upper(st->>'reason'); end if;
  select count(*) into recent from queue_entries where clinic_id = p_clinic and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'RATE_LIMITED'; end if;
  select coalesce(max(number), 0) + 1 into n from queue_entries where clinic_id = p_clinic and queue_date = p_date;
  insert into queue_entries(clinic_id, number, patient_name, status, priority, queue_date, notes)
  values (p_clinic, n, left(trim(p_name), 60), 'waiting', p_priority, p_date, left(nullif(trim(p_note), ''), 120))
  returning * into e;
  return jsonb_build_object('id', e.id, 'number', e.number, 'created_at', e.created_at,
    'ahead', (select count(*) from queue_entries where clinic_id = p_clinic and queue_date = p_date
                and status in ('waiting', 'current') and number < n));
end;
$$;

do $$ declare f text; begin
  foreach f in array array['queue_status(uuid,date)', 'queue_board(uuid,date)', 'queue_join(uuid,date,text,text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  revoke all on function public.queue_settings_save(text,time,time,int,int,boolean,text) from public, anon;
  grant execute on function public.queue_settings_save(text,time,time,int,int,boolean,text) to authenticated;
end $$;
alter function public.queue_status(uuid,date) owner to postgres;
alter function public.queue_settings_save(text,time,time,int,int,boolean,text) owner to postgres;
alter function public.queue_board(uuid,date) owner to postgres;
alter function public.queue_join(uuid,date,text,text,text) owner to postgres;
