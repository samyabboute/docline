-- Annuaire : établissements publiés, affichés avec les mêmes cartes que les médecins (+ plan du site).
create or replace function public.clinics_directory()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c order by c ->> 'name'), '[]') from (
    select jsonb_build_object(
      'id', o.id, 'slug', s.slug, 'updated_at', greatest(s.updated_at, o.updated_at),
      'name', coalesce(nullif(trim(o.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(o.last_name), ''), o.full_name)),
      'city', o.city, 'wilaya', o.wilaya, 'address', o.address, 'avatar_url', o.avatar_url,
      'description', coalesce(s.description, o.bio),
      'services', coalesce((select jsonb_agg(sv.name order by sv.sort_order, sv.name) from org_services sv where sv.org_id = o.id and sv.active
                             and exists (select 1 from org_members m where m.service_id = sv.id and m.role = 'doctor' and m.status = 'active')), '[]'),
      'specialties', coalesce((select jsonb_agg(distinct p.specialty) from profiles p where p.id = any(d.ids) and p.specialty is not null), '[]'),
      'languages', coalesce((select jsonb_agg(distinct l) from profiles p, unnest(p.languages) l where p.id = any(d.ids)), '[]'),
      'doctor_ids', to_jsonb(d.ids),
      'doctor_count', cardinality(d.ids),
      'accepts_rdv', exists (select 1 from profiles p where p.id = any(d.ids) and p.accepts_rdv),
      'min_price', (select min(p.consultation_price) from profiles p where p.id = any(d.ids) and p.consultation_price > 0)) c
    from org_public_settings s
    join profiles o on o.id = s.org_id and coalesce(o.is_active, true)
    cross join lateral (select array(
        select x from unnest(_org_doctor_ids(s.org_id)) x join profiles p on p.id = x
         where not (x = any(s.hidden_doctors)) and p.is_public and coalesce(p.is_active, true) and not coalesce(p.is_clinic, false)) as ids) d
    where s.published and _org_plan_ok(s.org_id) and cardinality(d.ids) > 0
  ) t
$$;
revoke all on function public.clinics_directory() from public;
grant execute on function public.clinics_directory() to anon, authenticated;
alter function public.clinics_directory() owner to postgres;
