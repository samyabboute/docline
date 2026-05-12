-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v8 : Comptes cliniques
-- Ajoute le support "type de compte" (médecin individuel ou clinique)
-- Le nom de la clinique remplace le nom du médecin dans toute l'UI.
-- ════════════════════════════════════════════════════════════════════

-- 1. Colonnes profiles ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_clinic boolean not null default false;

alter table public.profiles
  add column if not exists clinic_name text;

-- Garantit qu'un compte clinique a un nom de clinique non-vide
alter table public.profiles
  drop constraint if exists chk_clinic_has_name;
alter table public.profiles
  add  constraint chk_clinic_has_name
    check (is_clinic = false or (clinic_name is not null and length(trim(clinic_name)) > 0));

-- 2. Index pour recherche annuaire (find-doctor) ──────────────────────
create index if not exists idx_profiles_clinic
  on public.profiles (is_clinic)
  where is_clinic = true;

-- 3. Backfill éventuel à partir des user_metadata déjà saisis ─────────
-- (au cas où l'utilisateur s'est inscrit avant la migration via login v2)
update public.profiles p
   set is_clinic   = coalesce((u.raw_user_meta_data->>'is_clinic')::boolean, false),
       clinic_name = coalesce(p.clinic_name, u.raw_user_meta_data->>'clinic_name')
  from auth.users u
 where u.id = p.id
   and (p.is_clinic is distinct from coalesce((u.raw_user_meta_data->>'is_clinic')::boolean, false)
        or (p.clinic_name is null and u.raw_user_meta_data->>'clinic_name' is not null));

-- ════════════════════════════════════════════════════════════════════
-- DONE. Recharger l'app : le toggle "Je représente une clinique"
-- est désormais opérationnel à l'inscription.
-- ════════════════════════════════════════════════════════════════════
