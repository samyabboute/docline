-- Écran commun de la salle d'attente d'un établissement : une file par médecin, sur une seule télévision.
-- Public (comme queue_board) : numéros, salle, nom masqué seulement si le médecin l'autorise.

create or replace function public.org_board(p_org uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare docs uuid[];
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_org and coalesce(is_active, true)) then return null; end if;
  docs := _org_doctor_ids(p_org);
  return jsonb_build_object(
    'org', (select jsonb_build_object(
              'name', coalesce(nullif(trim(o.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(o.last_name), ''), nullif(trim(o.full_name), '')), 'Cabinet médical'),
              'city', coalesce(nullif(trim(o.city), ''), o.wilaya), 'wilaya', o.wilaya)
            from profiles o where o.id = p_org),
    'doctors', coalesce((select jsonb_agg(x order by (x ->> 'ord'), (x ->> 'name')) from (
      select jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), 'Médecin'),
        'specialty', p.specialty,
        'ord', case when p.id = p_org then 0 else 1 end,
        'service', (select jsonb_build_object('name', s.name, 'color', s.color) from org_members m join org_services s on s.id = m.service_id
                     where m.org_id = p_org and m.user_id = p.id and s.active limit 1),
        'accepting', coalesce((queue_status(p.id, p_date) ->> 'accepting')::boolean, true),
        'current', (select jsonb_build_object('id', q.id, 'number', q.number, 'room', q.room, 'priority', q.priority,
                                              'name', case when coalesce(qs.show_name, true) then _mask_name(q.patient_name) end)
                      from queue_entries q left join queue_settings qs on qs.clinic_id = q.clinic_id
                     where q.clinic_id = p.id and q.queue_date = p_date and q.status = 'current'
                     order by q.called_at desc nulls last limit 1),
        'next', coalesce((select jsonb_agg(n) from (
                    select q.number as n from queue_entries q where q.clinic_id = p.id and q.queue_date = p_date and q.status = 'waiting'
                     order by case q.priority when 'critique' then 0 when 'urgente' then 1 else 2 end, q.number limit 4) w), '[]'),
        'waiting', (select count(*) from queue_entries q where q.clinic_id = p.id and q.queue_date = p_date and q.status = 'waiting'),
        'done', (select count(*) from queue_entries q where q.clinic_id = p.id and q.queue_date = p_date and q.status = 'done')) x
      from profiles p where p.id = any(docs) and not coalesce(p.is_clinic, false) and coalesce(p.is_active, true)) s), '[]'));
end;
$$;
revoke all on function public.org_board(uuid, date) from public;
grant execute on function public.org_board(uuid, date) to anon, authenticated;
alter function public.org_board(uuid, date) owner to postgres;
