-- Membres d'un établissement : lecture du profil et de l'abonnement des médecins pour lesquels ils travaillent
-- (en-tête d'ordonnance, nom affiché, accès aux pages incluses dans l'offre du médecin).
create or replace function public.member_of(p_doctor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_doctor or exists (
    select 1 from org_members m
     where m.user_id = auth.uid() and m.status = 'active'
       and (m.doctor_scope is null or p_doctor = any(m.doctor_scope))
       and (m.org_id = p_doctor or exists (select 1 from org_members d where d.org_id = m.org_id and d.user_id = p_doctor
                                            and d.role = 'doctor' and d.status = 'active')))
$$;
revoke all on function public.member_of(uuid) from public, anon;
grant execute on function public.member_of(uuid) to authenticated;
alter function public.member_of(uuid) owner to postgres;

drop policy if exists org_profiles_read on public.profiles;
create policy org_profiles_read on public.profiles for select to authenticated using (member_of(id));
drop policy if exists org_subs_read on public.subscriptions;
create policy org_subs_read on public.subscriptions for select to authenticated using (member_of(user_id));
