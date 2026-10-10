-- ============================================================
-- Organisation et billetterie (2026-10-10)
-- Voir docs/DOMAIN_MODEL.md, docs/PRODUCT_DECISIONS.md, docs/PERMISSIONS_MATRIX.md
--
-- Source unique de vérité pour l'équipe : symphony_staff.
-- Départements, équipes, compétences sont relationnels ; un agent n'est
-- jamais dupliqué. Une file (équipe) et une affectation (agent) sont
-- distinctes. Toute écriture passe par des fonctions qui contrôlent les
-- permissions et produisent l'historique côté serveur.
-- ============================================================

-- ── Permissions : ajout des clés billetterie, organisation, facturation, publicité ──
create or replace function public.symphony_default_perms(p_dept text, p_level text)
returns text[] language plpgsql immutable as $$
declare
  base text[] := array['overview','tickets.create','tickets.work'];
  l2   text[] := array['tickets.assign']::text[];
  l3   text[] := array['tasks.view_all','tickets.view_all'];
begin
  if p_level = 'super_admin' then return array['*']; end if;
  case p_dept
    when 'direction' then
      base := base || array['analytics.view','doctors.view','kyc.view','payments.view','revenue.view','marketing.view','demand.view','incidents.view','team.view','tasks.view_all','tickets.view_all','billing.view'];
      l2   := l2 || array['doctors.edit','kyc.decide','payments.decide','featured.manage','security.view','billing.extend','ads.manage'];
      l3   := l3 || array['team.manage','simulate.use','users.sensitive','tickets.configure'];
    when 'sales' then
      base := base || array['doctors.view','demand.view','analytics.view'];
      l2   := l2 || array['doctors.edit','featured.manage'];
      l3   := l3 || array['revenue.view','team.view'];
    when 'customer_success' then
      base := base || array['doctors.view','kyc.view','incidents.view'];
      l2   := l2 || array['kyc.decide','doctors.edit'];
      l3   := l3 || array['payments.view','team.view'];
    when 'billing' then
      base := base || array['payments.view','revenue.view','doctors.view','billing.view'];
      l2   := l2 || array['payments.decide','billing.extend','billing.documents'];
      l3   := l3 || array['team.view'];
    when 'marketing' then
      base := base || array['marketing.view','analytics.view','demand.view','doctors.view'];
      l2   := l2 || array['featured.manage','ads.manage'];
      l3   := l3 || array['team.view'];
    when 'rd' then
      base := base || array['incidents.view','analytics.view'];
      l2   := l2 || array['security.view'];
      l3   := l3 || array['simulate.use','team.view'];
    when 'devops' then
      base := base || array['incidents.view','security.view'];
      l2   := l2 || array['simulate.use'];
      l3   := l3 || array['team.view'];
    when 'ops' then
      base := base || array['kyc.view','doctors.view','payments.view','incidents.view'];
      l2   := l2 || array['kyc.decide','payments.decide'];
      l3   := l3 || array['doctors.edit','team.view'];
    else null;
  end case;
  if p_level = 'l2' then return base || l2; end if;
  if p_level = 'l3' then return base || l2 || l3; end if;
  return base;
end;
$$;

-- Membre de l'équipe connecté (identité serveur, jamais fournie par le client)
create or replace function public.symphony_current_staff()
returns uuid language sql stable security definer set search_path = public as $$
  select id from symphony_staff where lower(email) = lower(auth.email()) and is_active limit 1
$$;
revoke all on function public.symphony_current_staff() from public, anon;
grant execute on function public.symphony_current_staff() to authenticated;

-- ════════════════════════ ORGANISATION ════════════════════════
create table if not exists public.departments (
  key         text primary key,
  name        text not null,
  description text,
  owner_staff_id uuid references public.symphony_staff(id) on delete set null,
  active      boolean not null default true,
  sort        smallint not null default 0
);
insert into public.departments(key, name, description, sort) values
  ('direction','Direction','Pilotage, arbitrages et validation des décisions sensibles',1),
  ('ops','Opérations','Vérification des médecins, onboarding et support opérationnel',2),
  ('customer_success','Succès client','Accompagnement des médecins et fidélisation',3),
  ('billing','Facturation','Abonnements, paiements, relevés et échéances',4),
  ('sales','Commercial','Acquisition et accompagnement commercial',5),
  ('marketing','Marketing','Communication, publicité et mises en avant',6),
  ('devops','Technique','Incidents, intégrations et disponibilité de la plateforme',7),
  ('rd','Produit et données','Produit, statistiques et corrections de données',8)
on conflict (key) do nothing;

alter table public.symphony_staff
  add column if not exists availability text not null default 'offline',
  add column if not exists max_active_tickets smallint not null default 8,
  add column if not exists supervisor_id uuid references public.symphony_staff(id) on delete set null,
  add column if not exists last_assigned_at timestamptz;
do $$ begin
  alter table public.symphony_staff add constraint symphony_staff_availability_chk
    check (availability in ('available','busy','away','offline'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.symphony_staff add constraint symphony_staff_department_fk
    foreign key (department) references public.departments(key) on update cascade;
exception when duplicate_object then null; end $$;

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  department_key text not null references public.departments(key) on update cascade,
  name          text not null check (length(trim(name)) between 2 and 80),
  description   text,
  lead_staff_id uuid references public.symphony_staff(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (department_key, name)
);
create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  staff_id  uuid not null references public.symphony_staff(id) on delete cascade,
  is_lead   boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (team_id, staff_id)
);
create index if not exists team_members_staff_idx on public.team_members(staff_id);

create table if not exists public.skills (
  key         text primary key,
  name        text not null,
  description text,
  active      boolean not null default true
);
insert into public.skills(key, name, description) values
  ('kyc_review','Vérification KYC','Contrôle des pièces et de l''identité des médecins'),
  ('physician_onboarding','Onboarding médecins','Mise en route et paramétrage des cabinets'),
  ('customer_support','Support médecins','Questions d''usage et assistance quotidienne'),
  ('billing_ops','Opérations de facturation','Paiements, relevés, échéances'),
  ('ads_ops','Opérations publicitaires','Campagnes et contenus diffusés'),
  ('tech_support','Support technique','Incidents, bugs, intégrations'),
  ('data_reporting','Données et statistiques','Extractions, corrections et rapports'),
  ('arabic','Arabe','Échanges en arabe'),
  ('english','Anglais','Échanges en anglais')
on conflict (key) do nothing;

create table if not exists public.staff_skills (
  staff_id    uuid not null references public.symphony_staff(id) on delete cascade,
  skill_key   text not null references public.skills(key) on update cascade,
  level       smallint not null default 1 check (level between 1 and 3),
  verified_by uuid references public.symphony_staff(id) on delete set null,
  verified_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (staff_id, skill_key)
);

-- Historique des changements d'organisation (append-only)
create table if not exists public.org_events (
  id         bigint generated always as identity primary key,
  staff_id   uuid references public.symphony_staff(id) on delete set null,
  actor_id   uuid references public.symphony_staff(id) on delete set null,
  actor_name text,
  kind       text not null,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Une équipe par département, qui sert de file d'attente par défaut
insert into public.teams(department_key, name, description)
select d.key, 'Équipe ' || d.name, 'File d''attente principale du département ' || d.name
  from public.departments d
on conflict (department_key, name) do nothing;

-- Chaque membre actif rejoint l'équipe principale de son département
insert into public.team_members(team_id, staff_id)
select t.id, s.id from public.symphony_staff s
  join public.teams t on t.department_key = s.department and t.name = 'Équipe ' || (select name from departments where key = s.department)
on conflict do nothing;

-- ════════════════════════ BILLETTERIE ════════════════════════
create table if not exists public.ticket_services (
  key               text primary key,
  name              text not null,
  description       text not null,
  department_key    text not null references public.departments(key) on update cascade,
  default_team_id   uuid references public.teams(id) on delete set null,
  required_skill_key text references public.skills(key) on update cascade,
  routing_policy    text not null default 'workload' check (routing_policy in ('workload','round_robin','manual')),
  categories        text[] not null default '{}',
  escalation_rule   text,
  active            boolean not null default true,
  sort              smallint not null default 0
);
insert into public.ticket_services(key, name, description, department_key, required_skill_key, categories, escalation_rule, sort) values
  ('service_desk','Support général','Demandes générales et questions d''usage des médecins','ops','customer_support',
     array['Question d''usage','Demande d''information','Autre'],'Vers le responsable Opérations si non pris en charge dans le délai',1),
  ('identity','Vérification et KYC','Contrôle des pièces, vérification d''identité et onboarding','ops','kyc_review',
     array['Pièce manquante','Vérification à revoir','Onboarding'],'Vers la Direction pour toute décision contestée',2),
  ('billing','Facturation','Paiements, relevés de compte, échéances et remboursements','billing','billing_ops',
     array['Paiement non reçu','Relevé de compte','Délai de paiement','Remboursement'],'Vers la Direction au-delà des plafonds de délai',3),
  ('customer_success','Succès client','Accompagnement, fidélisation et risques de départ','customer_success','customer_support',
     array['Accompagnement','Risque de départ','Retour client'],'Vers le responsable Succès client',4),
  ('advertising','Publicité','Campagnes vidéo et mises en avant','marketing','ads_ops',
     array['Nouvelle campagne','Modification','Problème de diffusion'],'Vers le responsable Marketing',5),
  ('technical','Technique','Incidents, bugs et intégrations','devops','tech_support',
     array['Bug','Incident','Intégration','Performance'],'Urgences directement au responsable Technique',6),
  ('data','Données et statistiques','Rapports, extractions et corrections de données','rd','data_reporting',
     array['Rapport','Extraction','Correction de données'],'Vers le responsable Produit',7)
on conflict (key) do nothing;
update public.ticket_services s set default_team_id = t.id
  from public.teams t
 where s.default_team_id is null and t.department_key = s.department_key and t.name = 'Équipe ' || (select name from departments where key = s.department_key);

create sequence if not exists public.ticket_ref_seq;
create table if not exists public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default ('TK-' || lpad(nextval('public.ticket_ref_seq')::text, 6, '0')),
  title              text not null check (length(trim(title)) between 3 and 160),
  description        text,
  category           text,
  service_key        text not null references public.ticket_services(key) on update cascade,
  team_id            uuid not null references public.teams(id),
  assignee_id        uuid references public.symphony_staff(id) on delete set null,
  status             text not null default 'queued' check (status in
                       ('queued','assigned','in_progress','waiting_requester','waiting_team','escalated','resolved','closed')),
  priority           text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  impact             text not null default 'one' check (impact in ('one','several','all')),
  required_skill_key text references public.skills(key) on update cascade,
  doctor_id          uuid references public.profiles(id) on delete set null,
  related_type       text,
  related_id         text,
  created_by         uuid not null references public.symphony_staff(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  first_assigned_at  timestamptz,
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  response_due_at    timestamptz not null,
  resolution_due_at  timestamptz not null,
  sla_paused_at      timestamptz,
  sla_paused_seconds integer not null default 0,
  response_breached  boolean not null default false,
  resolution_breached boolean not null default false,
  escalation_level   smallint not null default 0,
  assignment_count   integer not null default 0,
  reopen_count       integer not null default 0,
  resolution_note    text,
  -- un ticket affecté a forcément un responsable, un ticket en file n'en a pas
  constraint tickets_queue_vs_assignment check (
    (status = 'queued' and assignee_id is null) or status <> 'queued')
);
create index if not exists tickets_team_status_idx on public.tickets(team_id, status);
create index if not exists tickets_assignee_idx on public.tickets(assignee_id) where assignee_id is not null;
create index if not exists tickets_doctor_idx on public.tickets(doctor_id) where doctor_id is not null;
create index if not exists tickets_created_idx on public.tickets(created_at desc);

create table if not exists public.ticket_assignments (
  id              bigint generated always as identity primary key,
  ticket_id       uuid not null references public.tickets(id) on delete cascade,
  staff_id        uuid not null references public.symphony_staff(id),
  assigned_by     uuid references public.symphony_staff(id),
  method          text not null check (method in ('claim','auto','manual')),
  reason          text,
  assigned_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  ended_at        timestamptz,
  end_reason      text
);
create index if not exists ticket_assignments_ticket_idx on public.ticket_assignments(ticket_id);
create index if not exists ticket_assignments_open_idx on public.ticket_assignments(staff_id) where ended_at is null;

create table if not exists public.ticket_events (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  actor_id   uuid references public.symphony_staff(id) on delete set null,
  actor_name text,
  kind       text not null,
  from_value text,
  to_value   text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ticket_events_ticket_idx on public.ticket_events(ticket_id, id);

create table if not exists public.ticket_comments (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  author_id  uuid not null references public.symphony_staff(id),
  body       text not null check (length(trim(body)) between 1 and 5000),
  internal   boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ticket_comments_ticket_idx on public.ticket_comments(ticket_id, id);

-- Historique immuable : aucune modification ni suppression, même par l'équipe
create or replace function public.forbid_history_change()
returns trigger language plpgsql as $$
begin raise exception 'HISTORY_IS_APPEND_ONLY' using errcode = '42501'; end; $$;
drop trigger if exists ticket_events_immutable on public.ticket_events;
create trigger ticket_events_immutable before update or delete on public.ticket_events
  for each row when (current_setting('docline.allow_history_purge', true) is distinct from 'on')
  execute function public.forbid_history_change();
drop trigger if exists org_events_immutable on public.org_events;
create trigger org_events_immutable before update or delete on public.org_events
  for each row execute function public.forbid_history_change();

-- ── Aides internes ──
create or replace function public._staff_name(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(full_name, email) from symphony_staff where id = p_id
$$;

create or replace function public._ticket_event(p_ticket uuid, p_actor uuid, p_kind text, p_from text, p_to text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into ticket_events(ticket_id, actor_id, actor_name, kind, from_value, to_value, meta)
  values (p_ticket, p_actor, _staff_name(p_actor), p_kind, p_from, p_to, coalesce(p_meta, '{}'));
$$;

-- Un agent peut-il prendre ce ticket ?
create or replace function public._staff_eligible(p_staff uuid, p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tickets t
      join symphony_staff s on s.id = p_staff and s.is_active
      join team_members m on m.team_id = t.team_id and m.staff_id = s.id
     where t.id = p_ticket
       and (t.required_skill_key is null or exists (
             select 1 from staff_skills k where k.staff_id = s.id and k.skill_key = t.required_skill_key
                and (k.expires_at is null or k.expires_at > now()))))
$$;

create or replace function public._active_load(p_staff uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from tickets where assignee_id = p_staff
     and status in ('assigned','in_progress','waiting_requester','waiting_team','escalated')
$$;

-- Délais de traitement par priorité : (première réponse, résolution)
create or replace function public._sla_targets(p_priority text, out response interval, out resolution interval)
language sql immutable as $$
  select case p_priority when 'urgent' then interval '1 hour' when 'high' then interval '4 hours'
                         when 'normal' then interval '1 day' else interval '3 days' end,
         case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '1 day'
                         when 'normal' then interval '3 days' else interval '7 days' end
$$;

-- Affectation interne, atomique : ne réussit que si le ticket est encore libre
-- (ou affecté à p_expect pour une réaffectation).
create or replace function public._ticket_assign(p_ticket uuid, p_staff uuid, p_by uuid, p_method text, p_reason text, p_expect uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare prev uuid; st text; n int;
begin
  select assignee_id, status into prev, st from tickets where id = p_ticket for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;
  if prev is distinct from p_expect then return false; end if;
  if st in ('resolved','closed') then raise exception 'TICKET_CLOSED'; end if;
  if not _staff_eligible(p_staff, p_ticket) then raise exception 'AGENT_NOT_ELIGIBLE'; end if;
  update ticket_assignments set ended_at = now(), end_reason = coalesce(p_reason, p_method)
   where ticket_id = p_ticket and ended_at is null;
  update tickets set assignee_id = p_staff,
         status = case when status in ('queued','escalated') then 'assigned' else status end,
         first_assigned_at = coalesce(first_assigned_at, now()),
         assignment_count = assignment_count + 1, updated_at = now()
   where id = p_ticket;
  get diagnostics n = row_count;
  insert into ticket_assignments(ticket_id, staff_id, assigned_by, method, reason)
  values (p_ticket, p_staff, p_by, p_method, p_reason);
  update symphony_staff set last_assigned_at = now() where id = p_staff;
  perform _ticket_event(p_ticket, p_by, case when prev is null then 'assigned' else 'reassigned' end,
                        _staff_name(prev), _staff_name(p_staff),
                        jsonb_build_object('method', p_method, 'reason', p_reason, 'from_id', prev, 'to_id', p_staff));
  return n > 0;
end;
$$;

-- Moteur de répartition : compétence + disponibilité + charge la plus faible,
-- puis l'agent servi il y a le plus longtemps. Rien n'est forcé si personne
-- n'est éligible : le ticket reste dans la file et l'événement est tracé.
create or replace function public._ticket_route(p_ticket uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pick uuid; pol text;
begin
  select s.routing_policy into pol from tickets t join ticket_services s on s.key = t.service_key where t.id = p_ticket;
  if pol = 'manual' then return null; end if;
  select st.id into pick
    from tickets t
    join team_members m on m.team_id = t.team_id
    join symphony_staff st on st.id = m.staff_id and st.is_active and st.availability = 'available'
   where t.id = p_ticket and t.assignee_id is null
     and _staff_eligible(st.id, t.id)
     and _active_load(st.id) < st.max_active_tickets
   order by case when pol = 'round_robin' then 0 else _active_load(st.id) end,
            st.last_assigned_at nulls first, st.id
   limit 1;
  if pick is null then
    perform _ticket_event(p_ticket, null, 'no_eligible_agent', null, null, '{}');
    return null;
  end if;
  if _ticket_assign(p_ticket, pick, null, 'auto', null, null) then return pick; end if;
  return null;
end;
$$;

-- Le membre courant peut-il voir ce ticket ?
create or replace function public.ticket_can_view(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select symphony_can('tickets.view_all') or exists (
    select 1 from tickets t where t.id = p_ticket and (
      t.assignee_id = symphony_current_staff() or t.created_by = symphony_current_staff()
      or exists (select 1 from team_members m where m.team_id = t.team_id and m.staff_id = symphony_current_staff())))
$$;

-- ── Fonctions publiques (appelées par Symphony) ──
create or replace function public.ticket_create(
  p_title text, p_description text, p_service_key text, p_priority text default 'normal',
  p_category text default null, p_impact text default 'one', p_doctor_id uuid default null,
  p_related_type text default null, p_related_id text default null, p_team_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); svc ticket_services; tid uuid; tg record; new_id uuid; who uuid;
begin
  if me is null or not symphony_can('tickets.create') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into svc from ticket_services where key = p_service_key and active;
  if svc.key is null then raise exception 'SERVICE_UNKNOWN'; end if;
  tid := coalesce(p_team_id, svc.default_team_id);
  if not exists (select 1 from teams where id = tid and active) then raise exception 'TEAM_UNKNOWN'; end if;
  select * into tg from _sla_targets(coalesce(p_priority, 'normal'));
  insert into tickets(title, description, category, service_key, team_id, priority, impact, required_skill_key,
                      doctor_id, related_type, related_id, created_by, response_due_at, resolution_due_at)
  values (trim(p_title), nullif(trim(p_description), ''), nullif(trim(p_category), ''), svc.key, tid,
          coalesce(p_priority, 'normal'), coalesce(p_impact, 'one'), svc.required_skill_key,
          p_doctor_id, p_related_type, p_related_id, me, now() + tg.response, now() + tg.resolution)
  returning id into new_id;
  perform _ticket_event(new_id, me, 'created', null, 'queued',
    jsonb_build_object('service', svc.key, 'team_id', tid, 'priority', coalesce(p_priority,'normal')));
  who := _ticket_route(new_id);
  return jsonb_build_object('id', new_id, 'ref', (select ref from tickets where id = new_id), 'assignee', _staff_name(who));
end;
$$;

create or replace function public.ticket_claim(p_ticket uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff();
begin
  if me is null or not symphony_can('tickets.work') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not _staff_eligible(me, p_ticket) then raise exception 'AGENT_NOT_ELIGIBLE'; end if;
  if not _ticket_assign(p_ticket, me, me, 'claim', null, null) then raise exception 'ALREADY_CLAIMED'; end if;
  return true;
end;
$$;

create or replace function public.ticket_assign(p_ticket uuid, p_staff uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); cur uuid; team uuid;
begin
  select assignee_id, team_id into cur, team from tickets where id = p_ticket;
  if me is null or not (symphony_can('tickets.view_all') and symphony_can('tickets.assign')
                        or exists (select 1 from team_members where team_id = team and staff_id = me and is_lead)
                        or exists (select 1 from teams where id = team and lead_staff_id = me)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if cur is not null and coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if not _ticket_assign(p_ticket, p_staff, me, 'manual', nullif(trim(p_reason), ''), cur) then
    raise exception 'TICKET_CHANGED';
  end if;
  return true;
end;
$$;

-- Le responsable rend le ticket à la file (raison obligatoire)
create or replace function public.ticket_release(p_ticket uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); t tickets;
begin
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if me is null or (t.assignee_id is distinct from me and not symphony_can('tickets.assign')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if t.status in ('resolved','closed') then raise exception 'TICKET_CLOSED'; end if;
  update ticket_assignments set ended_at = now(), end_reason = trim(p_reason) where ticket_id = p_ticket and ended_at is null;
  update tickets set assignee_id = null, status = 'queued', updated_at = now() where id = p_ticket;
  perform _ticket_event(p_ticket, me, 'released', _staff_name(t.assignee_id), null, jsonb_build_object('reason', trim(p_reason)));
  perform _ticket_route(p_ticket);
  return true;
end;
$$;

-- Cycle de vie validé
create or replace function public.ticket_transition(p_ticket uuid, p_status text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); t tickets; ok boolean := false; is_owner boolean; is_lead boolean;
begin
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if me is null or not ticket_can_view(p_ticket) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  is_owner := t.assignee_id = me;
  is_lead := symphony_can('tickets.assign');
  ok := case
    when t.status in ('assigned','escalated') and p_status = 'in_progress' then is_owner
    when t.status in ('assigned','in_progress','waiting_requester','waiting_team','escalated')
         and p_status in ('in_progress','waiting_requester','waiting_team') then is_owner
    when t.status in ('assigned','in_progress','waiting_requester','waiting_team') and p_status = 'escalated' then is_owner or is_lead
    when t.status in ('assigned','in_progress','waiting_requester','waiting_team','escalated') and p_status = 'resolved' then is_owner or is_lead
    when t.status = 'resolved' and p_status = 'closed' then is_owner or is_lead or t.created_by = me
    when t.status in ('resolved','closed') and p_status = 'queued' then true   -- réouverture
    else false end;
  if not ok then raise exception 'TRANSITION_NOT_ALLOWED: % -> %', t.status, p_status; end if;
  if p_status in ('resolved','queued','escalated') and coalesce(trim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;

  -- pause du délai pendant l'attente d'un tiers
  if p_status in ('waiting_requester','waiting_team') and t.sla_paused_at is null then
    update tickets set sla_paused_at = now() where id = p_ticket;
  elsif p_status not in ('waiting_requester','waiting_team') and t.sla_paused_at is not null then
    update tickets set sla_paused_seconds = sla_paused_seconds + extract(epoch from now() - sla_paused_at)::int,
                       resolution_due_at = resolution_due_at + (now() - sla_paused_at),
                       sla_paused_at = null where id = p_ticket;
  end if;

  if p_status = 'queued' then   -- réouverture : retour en file
    update ticket_assignments set ended_at = now(), end_reason = 'reopened' where ticket_id = p_ticket and ended_at is null;
    update tickets set status = 'queued', assignee_id = null, reopen_count = reopen_count + 1,
           resolved_at = null, closed_at = null, updated_at = now() where id = p_ticket;
    perform _ticket_event(p_ticket, me, 'reopened', t.status, 'queued', jsonb_build_object('reason', trim(p_note)));
    perform _ticket_route(p_ticket);
    return true;
  end if;

  update tickets set status = p_status, updated_at = now(),
         first_response_at = case when p_status = 'in_progress' and first_response_at is null then now() else first_response_at end,
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
         closed_at = case when p_status = 'closed' then now() else closed_at end,
         resolution_note = case when p_status = 'resolved' then trim(p_note) else resolution_note end,
         escalation_level = case when p_status = 'escalated' then escalation_level + 1 else escalation_level end
   where id = p_ticket;
  if p_status = 'in_progress' then
    update ticket_assignments set acknowledged_at = coalesce(acknowledged_at, now())
     where ticket_id = p_ticket and ended_at is null;
  end if;
  perform _ticket_event(p_ticket, me, 'status', t.status, p_status,
                        case when coalesce(trim(p_note), '') <> '' then jsonb_build_object('note', trim(p_note)) else '{}' end);
  return true;
end;
$$;

create or replace function public.ticket_comment(p_ticket uuid, p_body text, p_internal boolean default true)
returns bigint language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); cid bigint;
begin
  if me is null or not ticket_can_view(p_ticket) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into ticket_comments(ticket_id, author_id, body, internal) values (p_ticket, me, trim(p_body), coalesce(p_internal, true))
  returning id into cid;
  update tickets set updated_at = now(),
         first_response_at = case when first_response_at is null and assignee_id = me then now() else first_response_at end
   where id = p_ticket;
  perform _ticket_event(p_ticket, me, 'comment', null, null, jsonb_build_object('comment_id', cid, 'internal', coalesce(p_internal, true)));
  return cid;
end;
$$;

-- Balayage périodique : rend à la file les affectations non prises en main,
-- marque les dépassements de délai et escalade les tickets urgents en retard.
create or replace function public.ticket_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; requeued int := 0; breached int := 0;
begin
  for r in select t.id, t.assignee_id from tickets t
             join ticket_assignments a on a.ticket_id = t.id and a.ended_at is null
            where t.status = 'assigned' and a.acknowledged_at is null and a.assigned_at < now() - interval '30 minutes'
  loop
    update ticket_assignments set ended_at = now(), end_reason = 'not_acknowledged' where ticket_id = r.id and ended_at is null;
    update tickets set assignee_id = null, status = 'queued', updated_at = now() where id = r.id;
    perform _ticket_event(r.id, null, 'requeued', _staff_name(r.assignee_id), null, '{"reason":"not_acknowledged"}');
    perform _ticket_route(r.id);
    requeued := requeued + 1;
  end loop;
  for r in update tickets set response_breached = true
            where not response_breached and first_response_at is null and sla_paused_at is null
              and status not in ('resolved','closed') and response_due_at < now() returning id loop
    perform _ticket_event(r.id, null, 'sla_breach', null, 'response', '{}'); breached := breached + 1;
  end loop;
  for r in update tickets set resolution_breached = true
            where not resolution_breached and sla_paused_at is null
              and status not in ('resolved','closed') and resolution_due_at < now() returning id, priority, status loop
    perform _ticket_event(r.id, null, 'sla_breach', null, 'resolution', '{}'); breached := breached + 1;
    if r.priority in ('urgent','high') and r.status <> 'escalated' then
      update tickets set status = 'escalated', escalation_level = escalation_level + 1 where id = r.id and status not in ('resolved','closed','queued');
      perform _ticket_event(r.id, null, 'escalated', r.status, 'escalated', '{"reason":"sla_breach"}');
    end if;
  end loop;
  return jsonb_build_object('requeued', requeued, 'breached', breached);
end;
$$;

-- ── Organisation : fonctions d'administration (permission team.manage) ──
create or replace function public._org_guard() returns uuid language plpgsql stable security definer set search_path = public as $$
declare me uuid := symphony_current_staff();
begin
  if me is null or not symphony_can('team.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return me;
end; $$;

create or replace function public.org_save_team(p_id uuid, p_department text, p_name text, p_description text, p_lead uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := _org_guard(); tid uuid;
begin
  if p_lead is not null and not exists (select 1 from symphony_staff where id = p_lead and is_active) then raise exception 'LEAD_INVALID'; end if;
  if p_id is null then
    insert into teams(department_key, name, description, lead_staff_id) values (p_department, trim(p_name), nullif(trim(p_description),''), p_lead)
    returning id into tid;
  else
    update teams set department_key = p_department, name = trim(p_name), description = nullif(trim(p_description),''), lead_staff_id = p_lead
     where id = p_id returning id into tid;
  end if;
  if p_lead is not null then
    insert into team_members(team_id, staff_id, is_lead) values (tid, p_lead, true)
    on conflict (team_id, staff_id) do update set is_lead = true;
  end if;
  insert into org_events(actor_id, actor_name, kind, detail) values (me, _staff_name(me), 'team_saved',
    jsonb_build_object('team_id', tid, 'name', trim(p_name), 'department', p_department, 'lead', p_lead));
  return tid;
end; $$;

create or replace function public.org_team_member(p_team uuid, p_staff uuid, p_member boolean, p_is_lead boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := _org_guard();
begin
  if not exists (select 1 from symphony_staff where id = p_staff) then raise exception 'STAFF_UNKNOWN'; end if;
  if p_member then
    insert into team_members(team_id, staff_id, is_lead) values (p_team, p_staff, coalesce(p_is_lead,false))
    on conflict (team_id, staff_id) do update set is_lead = coalesce(p_is_lead,false);
  else
    if exists (select 1 from tickets where team_id = p_team and assignee_id = p_staff and status not in ('resolved','closed')) then
      raise exception 'HAS_OPEN_TICKETS';
    end if;
    delete from team_members where team_id = p_team and staff_id = p_staff;
  end if;
  insert into org_events(staff_id, actor_id, actor_name, kind, detail) values (p_staff, me, _staff_name(me),
    case when p_member then 'team_joined' else 'team_left' end, jsonb_build_object('team_id', p_team, 'is_lead', p_is_lead));
  return true;
end; $$;

create or replace function public.org_set_skill(p_staff uuid, p_skill text, p_level smallint, p_expires_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := _org_guard();
begin
  if p_level is null then
    delete from staff_skills where staff_id = p_staff and skill_key = p_skill;
  else
    insert into staff_skills(staff_id, skill_key, level, verified_by, verified_at, expires_at)
    values (p_staff, p_skill, p_level, me, now(), p_expires_at)
    on conflict (staff_id, skill_key) do update set level = excluded.level, verified_by = me, verified_at = now(), expires_at = excluded.expires_at;
  end if;
  insert into org_events(staff_id, actor_id, actor_name, kind, detail) values (p_staff, me, _staff_name(me),
    case when p_level is null then 'skill_removed' else 'skill_set' end, jsonb_build_object('skill', p_skill, 'level', p_level, 'expires_at', p_expires_at));
  return true;
end; $$;

create or replace function public.org_set_staff_ops(p_staff uuid, p_department text, p_max_active smallint, p_supervisor uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := _org_guard();
begin
  if p_supervisor = p_staff then raise exception 'SUPERVISOR_INVALID'; end if;
  update symphony_staff set department = coalesce(p_department, department),
         max_active_tickets = coalesce(p_max_active, max_active_tickets), supervisor_id = p_supervisor
   where id = p_staff;
  insert into org_events(staff_id, actor_id, actor_name, kind, detail) values (p_staff, me, _staff_name(me), 'staff_updated',
    jsonb_build_object('department', p_department, 'max_active', p_max_active, 'supervisor', p_supervisor));
  return true;
end; $$;

-- Chacun gère sa disponibilité ; un responsable peut la changer pour son équipe
create or replace function public.org_set_availability(p_status text, p_staff uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); target uuid := coalesce(p_staff, symphony_current_staff()); r record;
begin
  if me is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if target <> me and not (symphony_can('team.manage') or exists (
       select 1 from team_members a join team_members b on a.team_id = b.team_id
        where a.staff_id = me and a.is_lead and b.staff_id = target)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update symphony_staff set availability = p_status where id = target;
  insert into org_events(staff_id, actor_id, actor_name, kind, detail) values (target, me, _staff_name(me), 'availability', jsonb_build_object('status', p_status));
  -- un agent qui redevient disponible relance la répartition des tickets en attente de ses équipes
  if p_status = 'available' then
    for r in select t.id from tickets t join team_members m on m.team_id = t.team_id and m.staff_id = target
              where t.status = 'queued' order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at
              limit 20 loop
      perform _ticket_route(r.id);
    end loop;
  end if;
  return true;
end; $$;

-- ── Règles d'accès (lecture seulement ; toute écriture passe par les fonctions) ──
alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.skills enable row level security;
alter table public.staff_skills enable row level security;
alter table public.org_events enable row level security;
alter table public.ticket_services enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_assignments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_comments enable row level security;

do $$ declare t text; begin
  foreach t in array array['departments','teams','team_members','skills','staff_skills','ticket_services'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (symphony_is_staff())', t || '_staff_read', t);
  end loop;
end $$;
drop policy if exists org_events_read on public.org_events;
create policy org_events_read on public.org_events for select to authenticated
  using (symphony_can('team.manage') or staff_id = symphony_current_staff());
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets for select to authenticated using (ticket_can_view(id));
drop policy if exists ticket_assignments_read on public.ticket_assignments;
create policy ticket_assignments_read on public.ticket_assignments for select to authenticated using (ticket_can_view(ticket_id));
drop policy if exists ticket_events_read on public.ticket_events;
create policy ticket_events_read on public.ticket_events for select to authenticated using (ticket_can_view(ticket_id));
drop policy if exists ticket_comments_read on public.ticket_comments;
create policy ticket_comments_read on public.ticket_comments for select to authenticated using (ticket_can_view(ticket_id));

-- ── Droits d'exécution ──
do $$ declare f text; begin
  foreach f in array array['_staff_name(uuid)','_ticket_event(uuid,uuid,text,text,text,jsonb)','_staff_eligible(uuid,uuid)',
    '_active_load(uuid)','_ticket_assign(uuid,uuid,uuid,text,text,uuid)','_ticket_route(uuid)','_org_guard()','ticket_sweep()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['ticket_can_view(uuid)',
    'ticket_create(text,text,text,text,text,text,uuid,text,text,uuid)','ticket_claim(uuid)','ticket_assign(uuid,uuid,text)',
    'ticket_release(uuid,text)','ticket_transition(uuid,text,text)','ticket_comment(uuid,text,boolean)',
    'org_save_team(uuid,text,text,text,uuid)','org_team_member(uuid,uuid,boolean,boolean)',
    'org_set_skill(uuid,text,smallint,timestamptz)','org_set_staff_ops(uuid,text,smallint,uuid)','org_set_availability(text,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── Balayage toutes les 5 minutes (pg_cron) ──
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('docline_ticket_sweep');
exception when others then null; end $$;
select cron.schedule('docline_ticket_sweep', '*/5 * * * *', 'select public.ticket_sweep()');

-- Les fonctions s'exécutent avec les droits de postgres (contournement RLS
-- contrôlé, sinon les règles de lecture se rappelleraient en boucle)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('symphony_current_staff','_staff_name','_ticket_event','_staff_eligible',
              '_active_load','_ticket_assign','_ticket_route','ticket_can_view','ticket_create','ticket_claim','ticket_assign',
              'ticket_release','ticket_transition','ticket_comment','ticket_sweep','_org_guard','org_save_team','org_team_member',
              'org_set_skill','org_set_staff_ops','org_set_availability') loop
    execute format('alter function %s owner to postgres', f.sig);
  end loop;
end $$;

-- ── Ancienne table d'agents : vide et remplacée par symphony_staff ──
comment on table public.symphony_agents is 'OBSOLÈTE depuis 2026-10-10 : remplacée par symphony_staff + teams + staff_skills. Ne plus utiliser.';
