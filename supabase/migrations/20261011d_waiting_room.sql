-- ============================================================
-- Salle d'attente (2026-10-11)
--  P0 : la file d'attente de tous les cabinets, noms des patients
--  compris, était lisible par n'importe qui sur internet, et n'importe
--  qui pouvait y écrire. L'écran et la borne passent désormais par
--  deux fonctions : lecture d'un seul cabinet avec noms masqués,
--  inscription contrôlée avec numéro attribué par le serveur.
--  Publicité : chaque diffusion réelle est enregistrée (ad_plays).
-- ============================================================

-- Prénom + initiale du nom (« Amina K. »)
create or replace function public._mask_name(p text)
returns text language sql immutable as $$
  select case when coalesce(trim(p), '') = '' then null
    else initcap(split_part(trim(p), ' ', 1)) ||
         case when position(' ' in trim(p)) > 0
              then ' ' || upper(left(split_part(trim(p), ' ', array_length(regexp_split_to_array(trim(p), '\s+'), 1)), 1)) || '.'
              else '' end end
$$;

create or replace function public._queue_day_ok(p_date date)
returns boolean language sql stable as $$
  select p_date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
$$;

create or replace function public.queue_board(p_clinic uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_clinic and coalesce(is_active, true)) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'status', status, 'priority', priority,
            'room', room, 'name', _mask_name(patient_name), 'created_at', created_at) order by number)
          from queue_entries where clinic_id = p_clinic and queue_date = p_date), '[]'::jsonb);
end;
$$;

create or replace function public.queue_join(p_clinic uuid, p_date date, p_name text, p_priority text default 'normale', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; e queue_entries; recent int;
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 60 then raise exception 'NAME_INVALID'; end if;
  if p_priority not in ('normale', 'urgente', 'critique') then raise exception 'PRIORITY_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_clinic and coalesce(is_active, true)) then raise exception 'CLINIC_UNKNOWN'; end if;
  -- garde-fou contre le remplissage abusif : 30 inscriptions par minute et par cabinet au plus
  select count(*) into recent from queue_entries where clinic_id = p_clinic and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'RATE_LIMITED'; end if;
  -- numéro suivant attribué sans doublon, même si deux patients s'inscrivent en même temps
  perform pg_advisory_xact_lock(hashtext(p_clinic::text || p_date::text));
  select coalesce(max(number), 0) + 1 into n from queue_entries where clinic_id = p_clinic and queue_date = p_date;
  insert into queue_entries(clinic_id, number, patient_name, status, priority, queue_date, notes)
  values (p_clinic, n, left(trim(p_name), 60), 'waiting', p_priority, p_date, left(nullif(trim(p_note), ''), 120))
  returning * into e;
  return jsonb_build_object('id', e.id, 'number', e.number, 'created_at', e.created_at,
    'ahead', (select count(*) from queue_entries where clinic_id = p_clinic and queue_date = p_date
                and status in ('waiting', 'current') and number < n));
end;
$$;

drop policy if exists patient_read_queue on public.queue_entries;
drop policy if exists patient_insert_queue on public.queue_entries;

-- ── Diffusions publicitaires réelles ──
create table if not exists public.ad_plays (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  clinic_id   uuid references public.profiles(id) on delete set null,
  played_at   timestamptz not null default now()
);
create index if not exists ad_plays_campaign_idx on public.ad_plays(campaign_id, played_at desc);
alter table public.ad_plays enable row level security;
drop policy if exists ad_plays_staff_read on public.ad_plays;
create policy ad_plays_staff_read on public.ad_plays for select to authenticated using (symphony_can('marketing.view'));

create or replace function public.ad_record_play(p_campaign uuid, p_clinic uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from ad_campaigns where id = p_campaign and active) then return false; end if;
  if not exists (select 1 from profiles where id = p_clinic) then return false; end if;
  -- une diffusion compte une fois par écran et par campagne toutes les 20 secondes au plus
  if exists (select 1 from ad_plays where campaign_id = p_campaign and clinic_id = p_clinic and played_at > now() - interval '20 seconds') then
    return false;
  end if;
  insert into ad_plays(campaign_id, clinic_id) values (p_campaign, p_clinic);
  update ad_campaigns set views_count = coalesce(views_count, 0) + 1 where id = p_campaign;
  return true;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['_mask_name(text)', '_queue_day_ok(date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['queue_board(uuid,date)', 'queue_join(uuid,date,text,text,text)', 'ad_record_play(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
alter function public.queue_board(uuid,date) owner to postgres;
alter function public.queue_join(uuid,date,text,text,text) owner to postgres;
alter function public.ad_record_play(uuid,uuid) owner to postgres;
