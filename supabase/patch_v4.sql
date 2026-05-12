-- ============================================================
-- DOCLINE — Patch v4 : RLS publique élargie + robustesse profil
-- Exécuter dans Supabase SQL Editor (après rdv_tables.sql + patch_v3.sql)
-- ============================================================

-- ── 1. RLS : permettre aux patients de voir les médecins avec profil complet
-- L'ancienne policy "anon_read_public_profiles" ne montrait que is_public=true.
-- En bêta, on veut aussi montrer les médecins qui ont nom+spécialité renseignés.
drop policy if exists "anon_read_public_profiles" on public.profiles;

create policy "anon_read_public_profiles" on public.profiles
  for select using (
    -- Médecin avec profil complet (visible en recherche bêta)
    (full_name is not null and specialty is not null)
    -- OU le médecin consulte son propre profil (profil-public.html)
    or auth.uid() = id
  );

-- ── 2. S'assurer que les médecins peuvent faire un upsert sur leur propre profil
-- (nécessaire pour profil-public.html qui utilise upsert au lieu de update)
drop policy if exists "users_own_profile_insert" on public.profiles;
create policy "users_own_profile_insert" on public.profiles
  for insert with check (auth.uid() = id);

-- ── 3. full_name = first_name + last_name pour les comptes existants sans full_name
update public.profiles
  set full_name = trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
  where full_name is null
    and (first_name is not null or last_name is not null);

-- ── 4. Trigger : auto-créer full_name au signup (si pas déjà fait)
create or replace function public.sync_full_name()
returns trigger language plpgsql as $$
begin
  if new.full_name is null then
    new.full_name := trim(coalesce(new.first_name,'') || ' ' || coalesce(new.last_name,''));
    if new.full_name = '' then new.full_name := null; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_full_name_trigger on public.profiles;
create trigger sync_full_name_trigger
  before insert or update on public.profiles
  for each row execute function public.sync_full_name();

-- ── Vérification
select count(*) as total_profiles,
       count(full_name) as avec_full_name,
       count(specialty) as avec_specialty,
       count(case when is_public then 1 end) as publics,
       count(case when featured then 1 end) as en_vedette
from public.profiles;
