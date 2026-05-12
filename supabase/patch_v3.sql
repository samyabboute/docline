-- ============================================================
-- DOCLINE — Patch v3 : colonne featured sur profiles
-- Exécuter dans Supabase SQL Editor
-- ============================================================

-- Ajoute la colonne featured (médecin mis en avant / sponsorisé)
alter table public.profiles
  add column if not exists featured boolean default false;

-- Index pour trier les featured en premier efficacement
create index if not exists profiles_featured_idx on public.profiles (featured desc);

-- Pour mettre un médecin en vedette :
--   update public.profiles set featured = true where id = 'UUID_DU_MEDECIN';
-- Pour retirer :
--   update public.profiles set featured = false where id = 'UUID_DU_MEDECIN';

-- ============================================================
-- Patch is_public : rendre visible tous les profils complets
-- (médecins avec nom + spécialité renseignés)
-- ============================================================
update public.profiles
  set is_public = true
  where is_public is null
    and full_name is not null
    and specialty is not null;
