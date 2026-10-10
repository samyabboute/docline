-- ============================================================
-- Lectures de la billetterie et de l'annuaire (2026-10-10)
-- Filtrage des vues côté serveur, sur les seuls tickets visibles.
-- ============================================================

create or replace function public._ticket_json(t public.tickets)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object(
    'service_name', (select name from ticket_services where key = t.service_key),
    'team_name', (select name from teams where id = t.team_id),
    'assignee_name', _staff_name(t.assignee_id),
    'creator_name', _staff_name(t.created_by),
    'doctor_name', (select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), full_name, email)
                      from profiles where id = t.doctor_id),
    'overdue', t.status not in ('resolved','closed') and t.sla_paused_at is null
               and (t.resolution_due_at < now() or (t.first_response_at is null and t.response_due_at < now())))
$$;

create or replace function public.ticket_list(p_view text default 'mine', p_search text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); q text := nullif(lower(trim(p_search)), ''); res jsonb; counts jsonb;
begin
  if me is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with vis as (
    select t.*,
           t.status not in ('resolved','closed') as open,
           t.status not in ('resolved','closed') and t.sla_paused_at is null
             and (t.resolution_due_at < now() or (t.first_response_at is null and t.response_due_at < now())) as late,
           exists (select 1 from team_members m where m.team_id = t.team_id and m.staff_id = me) as my_team
      from tickets t
     where (symphony_can('tickets.view_all') or t.assignee_id = me or t.created_by = me
            or exists (select 1 from team_members m where m.team_id = t.team_id and m.staff_id = me))
       and (q is null or lower(t.ref) like '%' || q || '%' or lower(t.title) like '%' || q || '%'
            or lower(coalesce(t.description,'')) like '%' || q || '%')
  ), tagged as (
    select v.*,
      (v.open and v.assignee_id = me) as v_mine,
      (v.status = 'queued' and v.my_team) as v_team,
      (v.status = 'queued' and _staff_eligible(me, v.id)) as v_available,
      (v.open and v.assignee_id is null) as v_unassigned,
      v.late as v_overdue,
      (v.status in ('waiting_requester','waiting_team')) as v_waiting,
      (v.status = 'escalated') as v_escalated,
      (v.status in ('resolved','closed')) as v_resolved
      from vis v
  )
  select
    coalesce((select jsonb_agg(_ticket_json(t) order by
               case x.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, x.created_at desc)
                from tagged x join tickets t on t.id = x.id
               where case p_view when 'mine' then x.v_mine when 'team' then x.v_team when 'available' then x.v_available
                                 when 'unassigned' then x.v_unassigned when 'overdue' then x.v_overdue when 'waiting' then x.v_waiting
                                 when 'escalated' then x.v_escalated when 'resolved' then x.v_resolved else true end
               limit p_limit), '[]'::jsonb),
    jsonb_build_object(
      'mine', count(*) filter (where v_mine), 'team', count(*) filter (where v_team),
      'available', count(*) filter (where v_available), 'unassigned', count(*) filter (where v_unassigned),
      'overdue', count(*) filter (where v_overdue), 'waiting', count(*) filter (where v_waiting),
      'escalated', count(*) filter (where v_escalated), 'resolved', count(*) filter (where v_resolved),
      'all', count(*))
    into res, counts
    from tagged;
  return jsonb_build_object('tickets', res, 'counts', counts);
end;
$$;

create or replace function public.ticket_detail(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := symphony_current_staff(); t tickets;
begin
  if me is null or not ticket_can_view(p_ticket) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into t from tickets where id = p_ticket;
  return jsonb_build_object(
    'ticket', _ticket_json(t),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from ticket_events e where e.ticket_id = p_ticket), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('author_name', _staff_name(c.author_id)) order by c.id)
                            from ticket_comments c where c.ticket_id = p_ticket), '[]'),
    'can', jsonb_build_object(
      'work', coalesce(t.assignee_id = me, false),
      'claim', t.assignee_id is null and t.status = 'queued' and _staff_eligible(me, p_ticket),
      'assign', (symphony_can('tickets.view_all') and symphony_can('tickets.assign'))
                or exists (select 1 from team_members where team_id = t.team_id and staff_id = me and is_lead)
                or exists (select 1 from teams where id = t.team_id and lead_staff_id = me),
      'lead', symphony_can('tickets.assign')),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.full_name, s.email),
                     'availability', s.availability, 'load', _active_load(s.id), 'max', s.max_active_tickets,
                     'eligible', _staff_eligible(s.id, p_ticket)) order by _active_load(s.id), s.full_name)
                     from team_members m join symphony_staff s on s.id = m.staff_id and s.is_active
                    where m.team_id = t.team_id), '[]'));
end;
$$;

-- Annuaire : une seule source (symphony_staff), avec équipes, compétences et charge
create or replace function public.org_directory()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not symphony_is_staff() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'me', symphony_current_staff(),
    'can_manage', symphony_can('team.manage'),
    'departments', (select jsonb_agg(to_jsonb(d) order by d.sort) from departments d where d.active),
    'skills', (select jsonb_agg(to_jsonb(k) order by k.name) from skills k where k.active),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'department_key', t.department_key,
               'description', t.description, 'lead_staff_id', t.lead_staff_id,
               'queued', (select count(*) from tickets x where x.team_id = t.id and x.status = 'queued'),
               'members', coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'is_lead', m.is_lead))
                                      from team_members m where m.team_id = t.id), '[]')) order by t.department_key, t.name)
               from teams t where t.active), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'id', s.id, 'email', s.email, 'full_name', s.full_name, 'employee_id', s.employee_id,
               'department', s.department, 'role', s.role, 'title', s.title, 'is_active', s.is_active,
               'availability', s.availability, 'max_active_tickets', s.max_active_tickets,
               'supervisor_id', s.supervisor_id, 'last_seen_at', s.last_seen_at, 'last_assigned_at', s.last_assigned_at,
               'load', _active_load(s.id),
               'skills', coalesce((select jsonb_agg(jsonb_build_object('key', k.skill_key, 'level', k.level, 'expires_at', k.expires_at))
                                     from staff_skills k where k.staff_id = s.id), '[]')) order by s.is_active desc, s.full_name)
               from symphony_staff s), '[]'));
end;
$$;

do $$ declare f text; begin
  revoke all on function public._ticket_json(public.tickets) from public, anon, authenticated;
  foreach f in array array['ticket_list(text,text,int)','ticket_detail(uuid)','org_directory()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
alter function public._ticket_json(public.tickets) owner to postgres;
alter function public.ticket_list(text,text,int) owner to postgres;
alter function public.ticket_detail(uuid) owner to postgres;
alter function public.org_directory() owner to postgres;
