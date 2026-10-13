-- Établissements : journal d'activité (qui a fait quoi) et pilotage par médecin (2026-10-20)
-- Le journal enregistre les écritures faites par une personne connectée sur les données d'un médecin.
-- Il ne contient aucun contenu médical : type d'action, patient (prénom + initiale), auteur, médecin.

create table if not exists public.org_audit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor     uuid not null,
  doctor_id uuid not null,
  entity    text not null,
  entity_id text,
  action    text not null,
  label     text
);
create index if not exists org_audit_doctor_idx on public.org_audit (doctor_id, at desc);
create index if not exists org_audit_actor_idx on public.org_audit (actor, at desc);
alter table public.org_audit enable row level security;
revoke all on public.org_audit from public, anon, authenticated;

create or replace function public._short_name(p text)
returns text language sql immutable as $$
  select case when p is null or trim(p) = '' then null
    else split_part(trim(p), ' ', 1) || coalesce(' ' || nullif(left(split_part(trim(p), ' ', 2), 1), '') || '.', '') end
$$;

-- Déclencheur générique : argument 0 = colonne du médecin, argument 1 = type d'entité
create or replace function public._org_audit_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_doc uuid; v_action text := lower(tg_op); v_label text; v_entity text := tg_argv[1];
begin
  if auth.uid() is null then return null; end if;
  if v_entity = 'ordonnance' and (r ->> 'project_type') is distinct from 'ordonnance' then return null; end if;
  v_doc := nullif(r ->> tg_argv[0], '')::uuid;
  if v_doc is null then return null; end if;
  if tg_op = 'UPDATE' then
    -- rien de significatif (horodatage seul) : pas de ligne
    if (r - 'updated_at') = (o - 'updated_at') then return null; end if;
    if r ? 'status' and (r ->> 'status') is distinct from (o ->> 'status') then v_action := 'status:' || (r ->> 'status');
    elsif v_entity = 'queue' then return null;          -- file : seuls les changements d'état comptent
    end if;
  end if;
  v_label := case v_entity
    when 'patient' then _short_name(concat_ws(' ', r ->> 'first_name', r ->> 'last_name'))
    when 'ordonnance' then _short_name(r ->> 'client_name')
    when 'context' then (select _short_name(concat_ws(' ', c.first_name, c.last_name)) from clients c where c.id = (r ->> 'client_id')::uuid)
    when 'member' then r ->> 'full_name'
    else _short_name(r ->> 'patient_name') end;
  insert into org_audit (actor, doctor_id, entity, entity_id, action, label)
  values (auth.uid(), v_doc, v_entity, coalesce(r ->> 'id', r ->> 'client_id'), v_action, v_label);
  return null;
exception when others then
  return null;  -- le journal ne doit jamais bloquer une action métier
end;
$$;

do $$
declare t record;
begin
  for t in select * from (values
      ('clients', 'user_id', 'patient'), ('consultations', 'user_id', 'consultation'), ('appointments', 'doctor_id', 'appointment'),
      ('queue_entries', 'clinic_id', 'queue'), ('lab_results', 'clinic_id', 'lab'), ('patient_clinical_context', 'doctor_id', 'context'),
      ('org_members', 'org_id', 'member')) as x(tbl, col, ent)
  loop
    execute format('drop trigger if exists org_audit_trg on public.%I', t.tbl);
    execute format('create trigger org_audit_trg after insert or update or delete on public.%I for each row execute function public._org_audit_trg(%L, %L)', t.tbl, t.col, t.ent);
  end loop;
  -- ordonnances seulement (la table proposals porte aussi d'autres documents)
  drop trigger if exists org_audit_trg on public.proposals;
  create trigger org_audit_trg after insert or update or delete on public.proposals
    for each row execute function public._org_audit_trg('user_id', 'ordonnance');
end $$;

-- Médecins d'un établissement (sans filtre de périmètre : réservé aux fonctions de gestion)
create or replace function public._org_doctor_ids(p_org uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select array(select p_org union select m.user_id from org_members m where m.org_id = p_org and m.role = 'doctor' and m.status = 'active' and m.user_id is not null)
$$;
revoke all on function public._org_doctor_ids(uuid) from public, anon, authenticated;

create or replace function public._person_name(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), nullif(trim(full_name), ''), email) from profiles where id = p
$$;
revoke all on function public._person_name(uuid) from public, anon, authenticated;

-- Journal d'activité de l'établissement
create or replace function public.org_activity(p_org uuid, p_actor uuid default null, p_before timestamptz default null, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare docs uuid[];
begin
  if not org_can(p_org, 'team.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  docs := _org_doctor_ids(p_org);
  return coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
    select jsonb_build_object('id', a.id, 'at', a.at, 'actor', a.actor, 'actor_name', coalesce(m.full_name, _person_name(a.actor)),
             'actor_role', case when a.actor = p_org then 'owner' when a.actor = a.doctor_id then 'doctor' else coalesce(m.role, 'other') end,
             'doctor_id', a.doctor_id, 'doctor_name', _person_name(a.doctor_id), 'entity', a.entity, 'action', a.action, 'label', a.label) x
      from org_audit a
      left join org_members m on m.org_id = p_org and m.user_id = a.actor
     where a.doctor_id = any(docs)
       and (p_actor is null or a.actor = p_actor)
       and (p_before is null or a.at < p_before)
     order by a.at desc
     limit least(greatest(coalesce(p_limit, 60), 1), 200)) s), '[]');
end;
$$;

-- Pilotage : la journée et le mois, médecin par médecin (chiffres réels uniquement)
create or replace function public.org_overview(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare docs uuid[]; d date := (now() at time zone 'Africa/Algiers')::date; m0 date := date_trunc('month', (now() at time zone 'Africa/Algiers'))::date;
begin
  if not org_can(p_org, 'stats.view') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  docs := _org_doctor_ids(p_org);
  return jsonb_build_object(
    'today', d,
    'org', (select coalesce(nullif(trim(p.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(p.last_name), ''), nullif(trim(p.full_name), '')), 'Établissement') from profiles p where p.id = p_org),
    'doctors', coalesce((select jsonb_agg(x order by (x ->> 'ord'), (x ->> 'name')) from (
      select jsonb_build_object(
        'id', p.id, 'name', _person_name(p.id), 'specialty', p.specialty, 'ord', case when p.id = p_org then 0 else 1 end,
        'last_seen', p.last_seen_at,
        'rdv_today', (select count(*) from appointments a where a.doctor_id = p.id and a.requested_date = d and a.status in ('pending', 'confirmed', 'completed')),
        'rdv_pending', (select count(*) from appointments a where a.doctor_id = p.id and a.requested_date >= d and a.status = 'pending'),
        'queue_waiting', (select count(*) from queue_entries q where q.clinic_id = p.id and q.queue_date = d and q.status = 'waiting'),
        'queue_done', (select count(*) from queue_entries q where q.clinic_id = p.id and q.queue_date = d and q.status = 'done'),
        'queue_current', (select q.number from queue_entries q where q.clinic_id = p.id and q.queue_date = d and q.status = 'current' order by q.called_at desc nulls last limit 1),
        'wait_median', (select round(extract(epoch from percentile_cont(0.5) within group (order by q.called_at - q.created_at)) / 60)
                          from queue_entries q where q.clinic_id = p.id and q.queue_date = d and q.called_at is not null and q.called_at > q.created_at),
        'consult_month', (select count(*) from consultations c where c.user_id = p.id and c.consult_date >= m0),
        'rdv_month', (select count(*) from appointments a where a.doctor_id = p.id and a.requested_date >= m0 and a.requested_date <= d and a.status in ('confirmed', 'completed')),
        'noshow_month', (select count(*) from appointments a where a.doctor_id = p.id and a.requested_date >= m0 and a.requested_date <= d and coalesce(a.no_show, false))) x
      from profiles p where p.id = any(docs) and not (p.id = p_org and coalesce(p.is_clinic, false))) s), '[]'),
    'series', (select jsonb_agg(jsonb_build_object('d', g::date,
        'rdv', (select count(*) from appointments a where a.doctor_id = any(docs) and a.requested_date = g::date and a.status in ('confirmed', 'completed')),
        'queue', (select count(*) from queue_entries q where q.clinic_id = any(docs) and q.queue_date = g::date)) order by g)
      from generate_series(d - 13, d, interval '1 day') g),
    'team', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'role', m.role, 'last_seen', p.last_seen_at) order by p.last_seen_at desc nulls last)
      from org_members m left join profiles p on p.id = m.user_id
     where m.org_id = p_org and m.status = 'active' and m.role <> 'doctor'), '[]'));
end;
$$;

do $$ declare f text; begin
  foreach f in array array['org_activity(uuid,uuid,timestamptz,int)', 'org_overview(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
