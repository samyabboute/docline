-- ════════════════════════════════════════════════════════════════════
-- Symphony HQ — gestion de l'entreprise Docline
--   1. Permissions par département + niveau (personnalisables par membre)
--   2. Équipe : ajout / modification / désactivation des membres (côté serveur)
--   3. Tâches partagées (Kanban) + commentaires
--   4. Cockpit entreprise (indicateurs en une requête)
--   5. Sécurité : personnel, audit et rôles fermés aux médecins
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
-- ════════════════════════════════════════════════════════════════════

-- ── 0. Colonnes complémentaires sur le personnel ─────────────────────
alter table public.symphony_staff
  add column if not exists title         text,
  add column if not exists permissions   text[],          -- null = permissions par défaut du poste
  add column if not exists last_seen_at  timestamptz;

-- Le compteur EMP-XXXXXX repartait de 1 alors que EMP-000001 existe déjà : on le recale.
create sequence if not exists public.symphony_employee_seq start 1;
select setval('public.symphony_employee_seq', greatest(
  (select coalesce(max(nullif(regexp_replace(employee_id, '\D', '', 'g'), '')::bigint), 0) from public.symphony_staff), 1));

-- ── 1. Identité et permissions ───────────────────────────────────────
create or replace function public.symphony_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.email(), '')) in ('samyabboute5@gmail.com', 'contact@docline.health')
$$;

-- Permissions par défaut selon le département et le niveau.
-- L1 = consultation, L2 = décisions opérationnelles, L3 = responsable d'équipe.
create or replace function public.symphony_default_perms(p_dept text, p_level text)
returns text[] language plpgsql immutable as $$
declare
  base text[] := array['overview'];
  l2   text[] := array[]::text[];
  l3   text[] := array['tasks.view_all'];
begin
  if p_level = 'super_admin' then return array['*']; end if;

  case p_dept
    when 'direction' then
      base := base || array['analytics.view','doctors.view','kyc.view','payments.view','revenue.view','marketing.view','demand.view','incidents.view','team.view','tasks.view_all'];
      l2   := array['doctors.edit','kyc.decide','payments.decide','featured.manage','security.view'];
      l3   := l3 || array['team.manage','simulate.use','users.sensitive'];
    when 'sales' then
      base := base || array['doctors.view','demand.view','analytics.view'];
      l2   := array['doctors.edit','featured.manage'];
      l3   := l3 || array['revenue.view','team.view'];
    when 'customer_success' then
      base := base || array['doctors.view','kyc.view','incidents.view'];
      l2   := array['kyc.decide','doctors.edit'];
      l3   := l3 || array['payments.view','team.view'];
    when 'billing' then
      base := base || array['payments.view','revenue.view','doctors.view'];
      l2   := array['payments.decide'];
      l3   := l3 || array['team.view'];
    when 'marketing' then
      base := base || array['marketing.view','analytics.view','demand.view','doctors.view'];
      l2   := array['featured.manage'];
      l3   := l3 || array['team.view'];
    when 'rd' then
      base := base || array['incidents.view','analytics.view'];
      l2   := array['security.view'];
      l3   := l3 || array['simulate.use','team.view'];
    when 'devops' then
      base := base || array['incidents.view','security.view'];
      l2   := array['simulate.use'];
      l3   := l3 || array['team.view'];
    when 'ops' then
      base := base || array['kyc.view','doctors.view','payments.view','incidents.view'];
      l2   := array['kyc.decide','payments.decide'];
      l3   := l3 || array['doctors.edit','team.view'];
    else
      null;
  end case;

  if p_level = 'l2' then return base || l2; end if;
  if p_level = 'l3' then return base || l2 || l3; end if;
  return base;
end;
$$;

-- Fiche du membre connecté (null si pas membre). Met à jour la dernière connexion.
create or replace function public.symphony_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r symphony_staff;
begin
  select * into r from symphony_staff where lower(email) = lower(auth.email()) limit 1;

  if symphony_is_owner() then
    if r.id is not null then update symphony_staff set last_seen_at = now() where id = r.id; end if;
    return jsonb_build_object(
      'email', lower(auth.email()), 'owner', true,
      'full_name', coalesce(r.full_name, 'Fondateur'), 'title', coalesce(r.title, 'Fondateur'),
      'employee_id', coalesce(r.employee_id, 'EMP-000001'),
      'department', 'direction', 'role', 'super_admin', 'permissions', to_jsonb(array['*']));
  end if;

  if r.id is null or not r.is_active then return null; end if;
  update symphony_staff set last_seen_at = now() where id = r.id;
  return jsonb_build_object(
    'email', lower(r.email), 'owner', false,
    'full_name', r.full_name, 'title', r.title, 'employee_id', r.employee_id,
    'department', r.department, 'role', r.role,
    'permissions', to_jsonb(case when r.role = 'super_admin' then array['*']
                                 else coalesce(r.permissions, symphony_default_perms(r.department, r.role)) end));
end;
$$;

create or replace function public.symphony_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select symphony_is_owner()
      or exists (select 1 from symphony_staff where lower(email) = lower(auth.email()) and is_active)
$$;

create or replace function public.symphony_can(p_perm text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  r symphony_staff;
  perms text[];
begin
  if symphony_is_owner() then return true; end if;
  select * into r from symphony_staff where lower(email) = lower(auth.email()) and is_active limit 1;
  if r.id is null then return false; end if;
  if r.role = 'super_admin' then return true; end if;
  perms := coalesce(r.permissions, symphony_default_perms(r.department, r.role));
  return '*' = any(perms) or p_perm = any(perms);
end;
$$;

create or replace function public.symphony_my_department()
returns text language sql stable security definer set search_path = public as $$
  select department from symphony_staff where lower(email) = lower(auth.email()) and is_active limit 1
$$;

-- ── 2. admin_roles = miroir automatique de l'équipe ─────────────────
-- Les anciennes pages Symphony vérifient admin_roles : chaque membre actif y est recopié.
alter table public.admin_roles drop constraint if exists admin_roles_role_check;
alter table public.admin_roles add constraint admin_roles_role_check
  check (role in ('super_admin','support','kyc_agent','l1','l2','l3'));

create or replace function public.symphony_sync_admin_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and lower(old.email) <> lower(new.email) then
    delete from admin_roles where email = lower(old.email);
  end if;
  if new.is_active then
    insert into admin_roles (email, role, added_by) values (lower(new.email), new.role, 'symphony')
    on conflict (email) do update set role = excluded.role;
  else
    delete from admin_roles where email = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_symphony_sync_admin_roles on public.symphony_staff;
create trigger trg_symphony_sync_admin_roles
  after insert or update on public.symphony_staff
  for each row execute function public.symphony_sync_admin_roles();

insert into public.admin_roles (email, role, added_by)
select lower(email), role, 'symphony' from public.symphony_staff where is_active
on conflict (email) do update set role = excluded.role;

-- ── 3. Sécurité : plus d'accès des médecins aux données internes ────
drop policy if exists "authenticated can read admin_roles" on public.admin_roles;
drop policy if exists "staff read admin_roles" on public.admin_roles;
create policy "staff read admin_roles" on public.admin_roles
  for select to authenticated using (email = lower(auth.email()) or symphony_is_staff());

drop policy if exists "symphony_staff_read" on public.symphony_staff;
create policy "symphony_staff_read" on public.symphony_staff
  for select to authenticated using (symphony_is_staff());

drop policy if exists "symphony_audit_read" on public.symphony_audit_log;
create policy "symphony_audit_read" on public.symphony_audit_log
  for select to authenticated using (symphony_can('security.view'));

-- Écriture sur les profils médecins : seulement avec la permission adaptée
drop policy if exists "admin write all profiles" on public.profiles;
create policy "admin write all profiles" on public.profiles
  for update
  using (symphony_can('doctors.edit') or symphony_can('kyc.decide') or symphony_can('featured.manage'))
  with check (symphony_can('doctors.edit') or symphony_can('kyc.decide') or symphony_can('featured.manage'));

-- ── 4. Gestion de l'équipe (réservée à team.manage) ─────────────────
create or replace function public.symphony_save_member(
  p_email text, p_full_name text, p_department text, p_role text,
  p_title text default null, p_permissions text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me        jsonb := symphony_me();
  v_email   text  := lower(trim(p_email));
  existing  symphony_staff;
  v_emp     text;
begin
  if me is null or not symphony_can('team.manage') then
    raise exception 'Accès refusé : permission « gérer l''équipe » requise';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email invalide'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Nom requis'; end if;
  if p_department not in ('direction','sales','customer_success','billing','marketing','rd','devops','ops') then
    raise exception 'Département invalide';
  end if;
  if p_role not in ('l1','l2','l3','super_admin') then raise exception 'Niveau invalide'; end if;
  if p_role = 'super_admin' and not symphony_is_owner() then
    raise exception 'Seul le fondateur peut nommer un Super Admin';
  end if;
  if v_email in ('samyabboute5@gmail.com', 'contact@docline.health') and not symphony_is_owner() then
    raise exception 'Le compte du fondateur ne peut pas être modifié';
  end if;

  select * into existing from symphony_staff where lower(email) = v_email limit 1;
  if existing.id is not null and existing.role = 'super_admin' and not symphony_is_owner() then
    raise exception 'Seul le fondateur peut modifier un Super Admin';
  end if;

  if existing.id is null then
    v_emp := generate_employee_id();
    insert into symphony_staff (email, employee_id, full_name, department, role, title, permissions, is_active)
    values (v_email, v_emp, trim(p_full_name), p_department, p_role, nullif(trim(p_title), ''), p_permissions, true);
  else
    v_emp := existing.employee_id;
    update symphony_staff
       set full_name = trim(p_full_name), department = p_department, role = p_role,
           title = nullif(trim(p_title), ''), permissions = p_permissions, is_active = true
     where id = existing.id;
  end if;

  insert into symphony_audit_log (employee_id, employee_name, action, severity, target_type, target_email, details)
  values (me->>'employee_id', me->>'full_name',
          case when existing.id is null then 'add_staff' else 'update_staff' end,
          case when p_role in ('l3','super_admin') then 'elevated' else 'normal' end,
          'staff', v_email,
          jsonb_build_object('department', p_department, 'role', p_role, 'custom_permissions', p_permissions));

  return jsonb_build_object('ok', true, 'employee_id', v_emp, 'created', existing.id is null);
end;
$$;

create or replace function public.symphony_set_member_active(p_email text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       jsonb := symphony_me();
  v_email  text  := lower(trim(p_email));
  existing symphony_staff;
begin
  if me is null or not symphony_can('team.manage') then
    raise exception 'Accès refusé : permission « gérer l''équipe » requise';
  end if;
  if v_email = me->>'email' then raise exception 'Vous ne pouvez pas désactiver votre propre compte'; end if;
  select * into existing from symphony_staff where lower(email) = v_email limit 1;
  if existing.id is null then raise exception 'Membre introuvable'; end if;
  if existing.role = 'super_admin' and not symphony_is_owner() then
    raise exception 'Seul le fondateur peut désactiver un Super Admin';
  end if;

  update symphony_staff set is_active = p_active where id = existing.id;

  insert into symphony_audit_log (employee_id, employee_name, action, severity, target_type, target_email, details)
  values (me->>'employee_id', me->>'full_name',
          case when p_active then 'update_staff' else 'remove_staff' end,
          case when p_active then 'normal' else 'elevated' end,
          'staff', v_email, jsonb_build_object('is_active', p_active));
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 5. Tâches ────────────────────────────────────────────────────────
create table if not exists public.symphony_tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 2 and 160),
  description      text check (description is null or char_length(description) <= 4000),
  status           text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority         text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  department       text check (department is null or department in
                     ('direction','sales','customer_success','billing','marketing','rd','devops','ops')),
  assignee_email   text,
  created_by_email text not null default lower(auth.email()),
  due_date         date,
  related_type     text check (related_type is null or related_type in ('doctor','kyc','payment','incident','other')),
  related_id       text,
  related_label    text check (related_label is null or char_length(related_label) <= 160),
  position         double precision not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists idx_symphony_tasks_status   on public.symphony_tasks (status);
create index if not exists idx_symphony_tasks_assignee on public.symphony_tasks (lower(assignee_email));
create index if not exists idx_symphony_tasks_dept     on public.symphony_tasks (department);

create or replace function public.symphony_tasks_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.assignee_email := nullif(lower(trim(new.assignee_email)), '');
  if new.status <> 'done' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' then
    new.completed_at := now();
  elsif old.status <> 'done' then
    new.completed_at := now();
  end if;
  if tg_op = 'UPDATE' then new.created_by_email := old.created_by_email; end if;
  return new;
end;
$$;
drop trigger if exists trg_symphony_tasks_touch on public.symphony_tasks;
create trigger trg_symphony_tasks_touch before insert or update on public.symphony_tasks
  for each row execute function public.symphony_tasks_touch();

alter table public.symphony_tasks enable row level security;

drop policy if exists "tasks_select" on public.symphony_tasks;
create policy "tasks_select" on public.symphony_tasks for select to authenticated using (
  symphony_is_staff() and (
    symphony_can('tasks.view_all')
    or assignee_email = lower(auth.email())
    or created_by_email = lower(auth.email())
    or (department is not null and department = symphony_my_department())
  ));

drop policy if exists "tasks_insert" on public.symphony_tasks;
create policy "tasks_insert" on public.symphony_tasks for insert to authenticated
  with check (symphony_is_staff() and created_by_email = lower(auth.email()));

drop policy if exists "tasks_update" on public.symphony_tasks;
create policy "tasks_update" on public.symphony_tasks for update to authenticated
  using (symphony_is_staff() and (
    symphony_can('tasks.view_all') or assignee_email = lower(auth.email()) or created_by_email = lower(auth.email())
    or (department is not null and department = symphony_my_department())))
  with check (symphony_is_staff());

drop policy if exists "tasks_delete" on public.symphony_tasks;
create policy "tasks_delete" on public.symphony_tasks for delete to authenticated
  using (symphony_can('tasks.view_all') or created_by_email = lower(auth.email()));

create table if not exists public.symphony_task_comments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.symphony_tasks(id) on delete cascade,
  author_email text not null default lower(auth.email()),
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index if not exists idx_symphony_task_comments_task on public.symphony_task_comments (task_id, created_at);
alter table public.symphony_task_comments enable row level security;

drop policy if exists "task_comments_select" on public.symphony_task_comments;
create policy "task_comments_select" on public.symphony_task_comments for select to authenticated
  using (exists (select 1 from public.symphony_tasks t where t.id = task_id));

drop policy if exists "task_comments_insert" on public.symphony_task_comments;
create policy "task_comments_insert" on public.symphony_task_comments for insert to authenticated
  with check (author_email = lower(auth.email()) and exists (select 1 from public.symphony_tasks t where t.id = task_id));

drop policy if exists "task_comments_delete" on public.symphony_task_comments;
create policy "task_comments_delete" on public.symphony_task_comments for delete to authenticated
  using (author_email = lower(auth.email()) or symphony_can('tasks.view_all'));

-- ── 6. Cockpit entreprise ────────────────────────────────────────────
-- Chaque bloc est isolé : si une table n'existe pas encore, l'indicateur vaut null.
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
        'cash_30d',                coalesce(sum(amount) filter (where status = 'confirmed' and created_at > now() - interval '30 days'), 0),
        'cash_prev_30d',           coalesce(sum(amount) filter (where status = 'confirmed' and created_at <= now() - interval '30 days'
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

-- Demande marché pour le panneau (recherches patients vs médecins inscrits)
create or replace function public.symphony_demand(p_days int default 30)
returns table (specialty text, wilaya text, searches bigint, doctors bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not symphony_can('demand.view') then raise exception 'Accès refusé'; end if;
  return query
    select e.specialty,
           coalesce(e.wilaya, '(non précisée)') as wilaya,
           count(*) as searches,
           (select count(*) from profiles p
             where p.is_public and p.specialty = e.specialty
               and (e.wilaya is null or lower(p.wilaya) = lower(e.wilaya))) as doctors
    from search_events e
    where e.created_at > now() - make_interval(days => greatest(least(coalesce(p_days, 30), 365), 1))
    group by e.specialty, e.wilaya
    order by count(*) desc
    limit 300;
end;
$$;

-- ── 7. Droits d'exécution ────────────────────────────────────────────
revoke all on function public.symphony_demand(int)                  from public, anon;
grant execute on function public.symphony_demand(int)                  to authenticated;
revoke all on function public.symphony_me()                         from public, anon;
revoke all on function public.symphony_can(text)                    from public, anon;
revoke all on function public.symphony_is_staff()                   from public, anon;
revoke all on function public.symphony_is_owner()                   from public, anon;
revoke all on function public.symphony_my_department()              from public, anon;
revoke all on function public.symphony_save_member(text,text,text,text,text,text[]) from public, anon;
revoke all on function public.symphony_set_member_active(text,boolean)              from public, anon;
revoke all on function public.symphony_overview()                   from public, anon;
grant execute on function public.symphony_me()                         to authenticated;
grant execute on function public.symphony_can(text)                    to authenticated;
grant execute on function public.symphony_is_staff()                   to authenticated;
grant execute on function public.symphony_is_owner()                   to authenticated;
grant execute on function public.symphony_my_department()              to authenticated;
grant execute on function public.symphony_default_perms(text,text)     to authenticated;
grant execute on function public.symphony_save_member(text,text,text,text,text,text[]) to authenticated;
grant execute on function public.symphony_set_member_active(text,boolean)              to authenticated;
grant execute on function public.symphony_overview()                   to authenticated;
