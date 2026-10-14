-- Recherche d'un compte par email, réservée aux fonctions serveur (clé de service).
create or replace function public._auth_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke all on function public._auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public._auth_user_id_by_email(text) to service_role;
alter function public._auth_user_id_by_email(text) owner to postgres;
