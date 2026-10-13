-- Le titulaire d'un établissement gère l'agenda, la file, les fiches et le labo de ses médecins
-- (comme un administrateur). Le dossier médical d'un confrère lui reste fermé.

create or replace function public.member_can(p_doctor uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_doctor
  or (p_perm not like 'medical.%' and exists (
        select 1 from org_members d where d.org_id = auth.uid() and d.user_id = p_doctor and d.role = 'doctor' and d.status = 'active'))
  or exists (
    select 1 from org_members m
     where m.user_id = auth.uid() and m.status = 'active'
       and (p_perm = any(m.permissions) or (m.role = 'admin' and p_perm not like 'medical.%'))
       and (m.doctor_scope is null or p_doctor = any(m.doctor_scope))
       and (m.org_id = p_doctor or exists (select 1 from org_members d where d.org_id = m.org_id and d.user_id = p_doctor
                                            and d.role = 'doctor' and d.status = 'active')))
$$;

create or replace function public.member_of(p_doctor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_doctor
  or exists (select 1 from org_members d where d.org_id = auth.uid() and d.user_id = p_doctor and d.role = 'doctor' and d.status = 'active')
  or exists (
    select 1 from org_members m
     where m.user_id = auth.uid() and m.status = 'active'
       and (m.doctor_scope is null or p_doctor = any(m.doctor_scope))
       and (m.org_id = p_doctor or exists (select 1 from org_members d where d.org_id = m.org_id and d.user_id = p_doctor
                                            and d.role = 'doctor' and d.status = 'active')))
$$;

-- org_doctors : le titulaire voit aussi ses médecins (member_of couvre désormais ce cas)

-- Espace de travail : le titulaire reçoit un contexte « administration » pour chacun de ses médecins
create or replace function public.workspace_init()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles; out jsonb; own jsonb;
begin
  if auth.uid() is null then return null; end if;
  update org_members set user_id = auth.uid(), status = 'active', joined_at = coalesce(joined_at, now())
   where user_id is null and status = 'invited' and email is not null and lower(email) = lower(auth.email());
  select * into me from profiles where id = auth.uid();
  select jsonb_build_object(
    'self', jsonb_build_object('id', auth.uid(), 'name', coalesce(nullif(trim(concat_ws(' ', me.first_name, me.last_name)), ''), me.full_name, auth.email()),
                               'is_clinic', coalesce(me.is_clinic, false),
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

  select jsonb_build_object('member_id', null, 'org_id', auth.uid(), 'role', 'admin', 'permissions', '[]'::jsonb, 'service_id', null, 'owner', true,
           'org_name', coalesce(nullif(trim(me.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(me.last_name), ''), nullif(trim(me.full_name), '')), 'Cabinet médical'),
           'doctors', jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email), 'specialty', p.specialty)))
    into own
    from org_members dm join profiles p on p.id = dm.user_id
   where dm.org_id = auth.uid() and dm.role = 'doctor' and dm.status = 'active';
  if own is not null and own -> 'doctors' is not null and jsonb_typeof(own -> 'doctors') = 'array' then
    out := jsonb_set(out, '{memberships}', (out -> 'memberships') || jsonb_build_array(own));
  end if;
  return out;
end;
$$;
