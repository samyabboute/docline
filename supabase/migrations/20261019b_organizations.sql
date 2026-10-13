-- ============================================================
-- Établissements : services, équipe, rôles et accès réellement contrôlés (2026-10-19)
--
-- Un établissement (cabinet, clinique, centre) est identifié par le compte de son
-- titulaire (profiles.id), comme les données existantes (clinic_id, user_id).
-- Chaque médecin garde ses propres données ; l'établissement donne à ses membres
-- (secrétaires, infirmiers, laboratoire, comptabilité, administrateurs, autres
-- médecins) des permissions précises, limitées si besoin à certains médecins.
-- La base vérifie ces permissions (règles RLS) : masquer un menu ne suffit plus.
-- Secret médical : consultations, ordonnances et contexte clinique exigent une
-- permission « dossier médical » explicite, jamais accordée par défaut à
-- l'administration.
-- ============================================================

create table if not exists public.org_services (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 60),
  color      text not null default '#6D28D9',
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists org_services_org_idx on public.org_services (org_id);

create table if not exists public.org_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.profiles(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  email        text,
  full_name    text,
  phone        text,
  role         text not null check (role in ('admin', 'doctor', 'secretary', 'nurse', 'lab', 'accountant')),
  service_id   uuid references public.org_services(id) on delete set null,
  doctor_scope uuid[],                         -- null = tous les médecins de l'établissement
  permissions  text[] not null default '{}',
  status       text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  invited_at   timestamptz,
  joined_at    timestamptz,
  created_at   timestamptz not null default now(),
  legacy_staff_id uuid unique
);
create unique index if not exists org_members_org_email_uq on public.org_members (org_id, lower(email)) where email is not null;
create unique index if not exists org_members_org_user_uq on public.org_members (org_id, user_id) where user_id is not null;
create index if not exists org_members_user_idx on public.org_members (user_id);

-- Catalogue des permissions
create or replace function public._org_perm_ok(p text[])
returns boolean language sql immutable as $$
  select coalesce(p <@ array['agenda.view', 'agenda.manage', 'queue.manage', 'patients.view', 'patients.edit',
                             'medical.view', 'medical.write', 'lab.manage', 'billing.view', 'stats.view',
                             'team.manage', 'settings.manage'], true)
$$;

-- Droit d'agir pour un médecin donné
create or replace function public.member_can(p_doctor uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_doctor or exists (
    select 1 from org_members m
     where m.user_id = auth.uid() and m.status = 'active'
       and (p_perm = any(m.permissions) or (m.role = 'admin' and p_perm not like 'medical.%'))
       and (m.doctor_scope is null or p_doctor = any(m.doctor_scope))
       and (m.org_id = p_doctor or exists (select 1 from org_members d where d.org_id = m.org_id and d.user_id = p_doctor
                                            and d.role = 'doctor' and d.status = 'active')))
$$;

-- Droit de gérer l'établissement lui-même (équipe, services, réglages)
create or replace function public.org_can(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_org or exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid()
     and m.status = 'active' and (m.role = 'admin' or p_perm = any(m.permissions)))
$$;

alter table public.org_services enable row level security;
alter table public.org_members enable row level security;
drop policy if exists org_services_read on public.org_services;
create policy org_services_read on public.org_services for select to authenticated
  using (org_id = auth.uid() or exists (select 1 from org_members m where m.org_id = org_services.org_id and m.user_id = auth.uid() and m.status = 'active'));
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members for select to authenticated
  using (user_id = auth.uid() or org_can(org_id, 'team.manage'));
revoke insert, update, delete on public.org_services, public.org_members from anon, authenticated;

-- ── Accès des membres aux données des médecins (règles additionnelles) ──
do $$ begin
  -- Agenda et rendez-vous
  drop policy if exists org_appt_read on public.appointments;
  create policy org_appt_read on public.appointments for select to authenticated using (member_can(doctor_id, 'agenda.view'));
  drop policy if exists org_appt_insert on public.appointments;
  create policy org_appt_insert on public.appointments for insert to authenticated with check (member_can(doctor_id, 'agenda.manage'));
  drop policy if exists org_appt_write on public.appointments;
  create policy org_appt_write on public.appointments for update to authenticated using (member_can(doctor_id, 'agenda.manage')) with check (member_can(doctor_id, 'agenda.manage'));
  drop policy if exists org_tasks_read on public.calendar_tasks;
  create policy org_tasks_read on public.calendar_tasks for select to authenticated using (member_can(user_id, 'agenda.view'));
  drop policy if exists org_tasks_write on public.calendar_tasks;
  create policy org_tasks_write on public.calendar_tasks for all to authenticated using (member_can(user_id, 'agenda.manage')) with check (member_can(user_id, 'agenda.manage'));
  drop policy if exists org_avail_all on public.doctor_availability;
  create policy org_avail_all on public.doctor_availability for all to authenticated using (member_can(doctor_id, 'agenda.manage')) with check (member_can(doctor_id, 'agenda.manage'));
  drop policy if exists org_avail_ov_all on public.doctor_availability_overrides;
  create policy org_avail_ov_all on public.doctor_availability_overrides for all to authenticated using (member_can(doctor_id, 'agenda.manage')) with check (member_can(doctor_id, 'agenda.manage'));
  -- File d'attente
  drop policy if exists org_queue_all on public.queue_entries;
  create policy org_queue_all on public.queue_entries for all to authenticated using (member_can(clinic_id, 'queue.manage')) with check (member_can(clinic_id, 'queue.manage'));
  drop policy if exists org_queue_settings_all on public.queue_settings;
  create policy org_queue_settings_all on public.queue_settings for all to authenticated using (member_can(clinic_id, 'queue.manage')) with check (member_can(clinic_id, 'queue.manage'));
  drop policy if exists org_rooms_all on public.clinic_rooms;
  create policy org_rooms_all on public.clinic_rooms for all to authenticated using (member_can(clinic_id, 'queue.manage')) with check (member_can(clinic_id, 'queue.manage'));
  -- Patients (fiche administrative)
  drop policy if exists org_clients_read on public.clients;
  create policy org_clients_read on public.clients for select to authenticated using (member_can(user_id, 'patients.view'));
  drop policy if exists org_clients_insert on public.clients;
  create policy org_clients_insert on public.clients for insert to authenticated with check (member_can(user_id, 'patients.edit'));
  drop policy if exists org_clients_update on public.clients;
  create policy org_clients_update on public.clients for update to authenticated using (member_can(user_id, 'patients.edit')) with check (member_can(user_id, 'patients.edit'));
  -- Dossier médical (consultations, ordonnances, contexte clinique)
  drop policy if exists org_consult_read on public.consultations;
  create policy org_consult_read on public.consultations for select to authenticated using (member_can(user_id, 'medical.view'));
  drop policy if exists org_consult_write on public.consultations;
  create policy org_consult_write on public.consultations for insert to authenticated with check (member_can(user_id, 'medical.write'));
  drop policy if exists org_consult_update on public.consultations;
  create policy org_consult_update on public.consultations for update to authenticated using (member_can(user_id, 'medical.write')) with check (member_can(user_id, 'medical.write'));
  drop policy if exists org_ord_read on public.proposals;
  create policy org_ord_read on public.proposals for select to authenticated using (project_type = 'ordonnance' and member_can(user_id, 'medical.view'));
  drop policy if exists org_ord_insert on public.proposals;
  create policy org_ord_insert on public.proposals for insert to authenticated with check (project_type = 'ordonnance' and member_can(user_id, 'medical.write'));
  drop policy if exists org_ord_update on public.proposals;
  create policy org_ord_update on public.proposals for update to authenticated using (project_type = 'ordonnance' and member_can(user_id, 'medical.write')) with check (project_type = 'ordonnance' and member_can(user_id, 'medical.write'));
  drop policy if exists org_pcc_all on public.patient_clinical_context;
  create policy org_pcc_all on public.patient_clinical_context for all to authenticated using (member_can(doctor_id, 'medical.view')) with check (member_can(doctor_id, 'medical.write'));
  -- Laboratoire
  drop policy if exists org_lab_all on public.lab_results;
  create policy org_lab_all on public.lab_results for all to authenticated using (member_can(clinic_id, 'lab.manage')) with check (member_can(clinic_id, 'lab.manage'));
end $$;

-- ── Reprise de l'existant ──
-- Médecins rattachés à une clinique (ancien agenda partagé)
insert into org_members (org_id, user_id, email, full_name, role, permissions, status, joined_at)
select cd.clinic_id, cd.doctor_id, p.email, coalesce(p.full_name, trim(concat_ws(' ', p.first_name, p.last_name))), 'doctor',
       array['agenda.view'], 'active', cd.joined_at
  from clinic_doctors cd join profiles p on p.id = cd.doctor_id
on conflict do nothing;

-- Personnel existant : rôles et accès traduits en permissions
insert into org_members (org_id, user_id, email, full_name, phone, role, permissions, status, invited_at, joined_at, legacy_staff_id)
select s.clinic_id, s.user_id, nullif(lower(trim(s.email)), ''), trim(concat_ws(' ', s.first_name, s.last_name)), s.phone,
       case when s.role ilike 'infirm%' then 'nurse' when s.role ilike '%labo%' or s.role ilike 'tech%' then 'lab'
            when s.role ilike 'compta%' then 'accountant' else 'secretary' end,
       array(select distinct x from unnest(array_cat(
         case when 'queue' = any(coalesce(s.page_access, '{}')) then array['queue.manage'] else '{}'::text[] end
         || case when s.page_access && array['calendar', 'mes-rdv'] then array['agenda.view', 'agenda.manage'] else '{}'::text[] end
         || case when s.page_access && array['disponibilites'] then array['agenda.manage'] else '{}'::text[] end
         || case when 'clients' = any(coalesce(s.page_access, '{}')) then array['patients.view', 'patients.edit'] else '{}'::text[] end
         || case when s.page_access && array['consultations', 'ordonnances'] then array['medical.view'] else '{}'::text[] end,
         case when 'labo' = any(coalesce(s.page_access, '{}')) then array['lab.manage'] else '{}'::text[] end
         || case when 'staff' = any(coalesce(s.page_access, '{}')) then array['team.manage'] else '{}'::text[] end)) x),
       case when not coalesce(s.active, true) then 'disabled' when s.user_id is not null then 'active' else 'invited' end,
       s.invited_at, case when s.user_id is not null then s.created_at end, s.id
  from staff s
on conflict do nothing;

-- ── Espace de travail de l'utilisateur connecté ──
-- Active les invitations reçues à son adresse, puis décrit ses établissements et médecins accessibles.
create or replace function public.workspace_init()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles; out jsonb;
begin
  if auth.uid() is null then return null; end if;
  update org_members set user_id = auth.uid(), status = 'active', joined_at = coalesce(joined_at, now())
   where user_id is null and status = 'invited' and email is not null and lower(email) = lower(auth.email());
  select * into me from profiles where id = auth.uid();
  select jsonb_build_object(
    'self', jsonb_build_object('id', auth.uid(), 'name', coalesce(nullif(trim(concat_ws(' ', me.first_name, me.last_name)), ''), me.full_name, auth.email()),
                               'is_clinic', coalesce(me.is_clinic, false),
                               -- espace personnel : médecin indépendant ou médecin membre ; un collaborateur invité n'en a pas
                               'own_space', me.id is not null and (me.specialty is not null or coalesce(me.kyc_status, '') in ('pending_review', 'approved')
                                            or not exists (select 1 from org_members x where x.user_id = auth.uid() and x.status = 'active' and x.role <> 'doctor'))),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'org_id', m.org_id, 'role', m.role, 'permissions', m.permissions, 'service_id', m.service_id,
        'org_name', coalesce(nullif(trim(o.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(o.last_name), ''), nullif(trim(o.full_name), '')), 'Cabinet médical'),
        'doctors', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'specialty', d.specialty) order by d.name), '[]') from (
            select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email) as name, p.specialty
              from profiles p where p.id = m.org_id and not coalesce(p.is_clinic, false)
            union
            select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email), p.specialty
              from org_members dm join profiles p on p.id = dm.user_id
             where dm.org_id = m.org_id and dm.role = 'doctor' and dm.status = 'active') d
          where m.doctor_scope is null or d.id = any(m.doctor_scope))))
      from org_members m join profiles o on o.id = m.org_id
     where m.user_id = auth.uid() and m.status = 'active'), '[]'))
  into out;
  return out;
end;
$$;

-- ── Gestion de l'équipe (titulaire, administrateur ou permission team.manage) ──
create or replace function public.org_team(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not org_can(p_org, 'team.manage') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'org', (select jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(p.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(p.last_name), ''), nullif(trim(p.full_name), '')), 'Cabinet médical'), 'is_clinic', coalesce(p.is_clinic, false)) from profiles p where p.id = p_org),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.name) from org_services s where s.org_id = p_org), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'email', m.email, 'full_name', m.full_name, 'phone', m.phone,
        'role', m.role, 'service_id', m.service_id, 'doctor_scope', m.doctor_scope, 'permissions', m.permissions, 'status', m.status,
        'invited_at', m.invited_at, 'joined_at', m.joined_at,
        'last_seen', (select p.last_seen_at from profiles p where p.id = m.user_id)) order by m.status, m.role, m.full_name)
      from org_members m where m.org_id = p_org), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'specialty', d.specialty)) from (
        select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email) as name, p.specialty from profiles p
         where p.id = p_org and not coalesce(p.is_clinic, false)
        union
        select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email), p.specialty
          from org_members m join profiles p on p.id = m.user_id where m.org_id = p_org and m.role = 'doctor' and m.status = 'active') d), '[]'));
end;
$$;

create or replace function public.org_member_save(p_org uuid, p_id uuid, p_full_name text, p_email text, p_phone text, p_role text,
                                                  p_permissions text[], p_doctor_scope uuid[], p_service uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text := nullif(lower(trim(p_email)), '');
begin
  if not org_can(p_org, 'team.manage') then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('admin', 'doctor', 'secretary', 'nurse', 'lab', 'accountant') then raise exception 'ROLE_INVALID'; end if;
  if not _org_perm_ok(p_permissions) then raise exception 'PERMISSIONS_INVALID'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'EMAIL_INVALID'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  -- seul le titulaire nomme ou modifie un administrateur
  if (p_role = 'admin' or exists (select 1 from org_members where id = p_id and role = 'admin')) and auth.uid() <> p_org then raise exception 'OWNER_ONLY'; end if;
  if p_service is not null and not exists (select 1 from org_services where id = p_service and org_id = p_org) then raise exception 'SERVICE_INVALID'; end if;
  if p_id is null then
    insert into org_members (org_id, email, full_name, phone, role, permissions, doctor_scope, service_id, status)
    values (p_org, v_email, trim(p_full_name), nullif(trim(p_phone), ''), p_role, coalesce(p_permissions, '{}'), p_doctor_scope, p_service, 'invited')
    returning id into v_id;
  else
    update org_members set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''), role = p_role,
           permissions = coalesce(p_permissions, '{}'), doctor_scope = p_doctor_scope, service_id = p_service,
           email = case when user_id is null then v_email else email end
     where id = p_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.org_member_status(p_org uuid, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not org_can(p_org, 'team.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'STATUS_INVALID'; end if;
  if exists (select 1 from org_members where id = p_id and role = 'admin') and auth.uid() <> p_org then raise exception 'OWNER_ONLY'; end if;
  update org_members set status = case when p_status = 'active' and user_id is null then 'invited' else p_status end
   where id = p_id and org_id = p_org;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

create or replace function public.org_member_remove(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not org_can(p_org, 'team.manage') then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from org_members where id = p_id and role = 'admin') and auth.uid() <> p_org then raise exception 'OWNER_ONLY'; end if;
  delete from org_members where id = p_id and org_id = p_org;
end;
$$;

create or replace function public.org_service_save(p_org uuid, p_id uuid, p_name text, p_color text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not org_can(p_org, 'settings.manage') then raise exception 'FORBIDDEN'; end if;
  if p_id is null then
    insert into org_services (org_id, name, color, sort_order) values (p_org, trim(p_name), coalesce(p_color, '#6D28D9'),
      coalesce((select max(sort_order) + 1 from org_services where org_id = p_org), 0)) returning id into v_id;
  else
    update org_services set name = trim(p_name), color = coalesce(p_color, color), active = coalesce(p_active, active)
     where id = p_id and org_id = p_org returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.org_service_remove(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not org_can(p_org, 'settings.manage') then raise exception 'FORBIDDEN'; end if;
  delete from org_services where id = p_id and org_id = p_org;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['_org_perm_ok(text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['member_can(uuid,text)', 'org_can(uuid,text)', 'workspace_init()', 'org_team(uuid)',
                           'org_member_save(uuid,uuid,text,text,text,text,text[],uuid[],uuid)', 'org_member_status(uuid,uuid,text)',
                           'org_member_remove(uuid,uuid)', 'org_service_save(uuid,uuid,text,text,boolean)', 'org_service_remove(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
