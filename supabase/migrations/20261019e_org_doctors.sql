-- Médecins d'un établissement visibles par l'utilisateur (titulaire ou membre actif),
-- limités à son périmètre de médecins. Sert à l'agenda de l'établissement.
create or replace function public.org_doctors(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (auth.uid() = p_org or exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'org', (select jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(p.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(p.last_name), ''), nullif(trim(p.full_name), '')), 'Cabinet médical'))
              from profiles p where p.id = p_org),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'specialty', d.specialty) order by d.ord, d.name) from (
        select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email) as name, p.specialty, 0 as ord
          from profiles p where p.id = p_org and not coalesce(p.is_clinic, false)
        union
        select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(trim(p.full_name), ''), p.email), p.specialty, 1
          from org_members m join profiles p on p.id = m.user_id
         where m.org_id = p_org and m.role = 'doctor' and m.status = 'active') d
      where member_of(d.id)), '[]'));
end;
$$;
revoke all on function public.org_doctors(uuid) from public, anon;
grant execute on function public.org_doctors(uuid) to authenticated;
alter function public.org_doctors(uuid) owner to postgres;
