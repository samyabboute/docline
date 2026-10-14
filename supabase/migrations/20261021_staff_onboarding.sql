-- Arrivée d'un membre d'équipe : une seule procédure pour tous les ajouts
-- (équipe Docline dans Symphony, personnel d'un établissement).
--   1. le responsable ajoute la personne → invitation à lien unique (7 jours) envoyée par email ;
--   2. la personne confirme prénom, nom, email, renseigne son téléphone et choisit son mot de passe ;
--   3. un même code à 6 chiffres part par SMS et par email ; elle le saisit ;
--   4. le compte est créé (ou rattaché), l'accès s'ouvre, elle se connecte normalement.
-- Tant que l'étape 3 n'est pas validée, aucun accès n'est ouvert (ni Symphony, ni établissement).

create table if not exists public.staff_invitations (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  kind           text not null check (kind in ('symphony', 'clinic')),
  member_id      uuid not null,                 -- symphony_staff.id ou org_members.id
  org_id         uuid,                          -- établissement (kind = clinic)
  email          text not null,
  first_name     text,
  last_name      text,
  phone          text,
  role_label     text,
  org_name       text,
  invited_by     uuid,
  status         text not null default 'pending' check (status in ('pending', 'code_sent', 'accepted', 'revoked')),
  code_hash      text,
  code_expires_at timestamptz,
  code_attempts  int not null default 0,
  codes_sent     int not null default 0,
  last_code_at   timestamptz,
  user_id        uuid,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  accepted_at    timestamptz
);
create index if not exists staff_invitations_member_idx on public.staff_invitations (member_id, created_at desc);
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from public, anon, authenticated;

-- Équipe Docline : téléphone et date d'activation
alter table public.symphony_staff add column if not exists phone text;
alter table public.symphony_staff add column if not exists activated_at timestamptz;
-- Membres déjà en place (ils ont un compte et l'utilisent) : considérés comme activés
update public.symphony_staff s set activated_at = coalesce(s.activated_at, s.created_at)
 where s.activated_at is null and exists (select 1 from auth.users u where lower(u.email) = lower(s.email));

-- Accès Symphony : seulement après activation
do $$
declare f text; def text;
begin
  foreach f in array array['public.symphony_is_staff()', 'public.symphony_can(text)', 'public.symphony_current_staff()',
                           'public.symphony_my_department()', 'public.is_admin()'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('lower(auth.email()) and is_active' in def) = 0 then raise exception 'motif absent dans %', f; end if;
    def := replace(def, 'lower(auth.email()) and is_active', 'lower(auth.email()) and is_active and activated_at is not null');
    execute def;
  end loop;
end $$;

-- Établissements : l'accès ne s'active plus automatiquement par l'email ; seule l'activation l'ouvre
do $$
declare def text;
begin
  def := pg_get_functiondef('public.workspace_init()'::regprocedure);
  if position('update org_members set user_id = auth.uid()' in def) = 0 then raise exception 'workspace_init : motif absent'; end if;
  def := regexp_replace(def, 'update org_members set user_id = auth\.uid\(\), status = ''active'', joined_at = coalesce\(joined_at, now\(\)\)\s+where user_id is null and status = ''invited'' and email is not null and lower\(email\) = lower\(auth\.email\(\)\);', '-- activation : uniquement via la procédure d''invitation (staff-onboarding)', 'g');
  if position('update org_members set user_id = auth.uid()' in def) > 0 then raise exception 'workspace_init : remplacement échoué'; end if;
  execute def;
end $$;
