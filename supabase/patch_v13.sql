-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v13 : Staff access control columns
-- La table staff manquait user_id et page_access → checkStaff() non fonctionnel
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Colonnes manquantes sur la table staff ─────────────────────

-- user_id : lien vers l'utilisateur auth (rempli quand le staff accepte l'invitation)
alter table public.staff
  add column if not exists user_id     uuid references auth.users(id) on delete set null,
  add column if not exists page_access text[]      default '{}',
  add column if not exists invited_at  timestamptz;

-- Index pour la lookup par user_id (utilisé par checkStaff dans shell.js)
create index if not exists idx_staff_user_id on public.staff(user_id)
  where user_id is not null;

-- ── 2. RLS : permettre à un membre staff de lire son propre enregistrement ──
-- Actuellement la policy "clinic_own_staff" autorise uniquement le médecin (clinic_id)
-- → les membres staff ne peuvent pas lire leur ligne → checkStaff() renvoie null → pas de contrôle

drop policy if exists "staff_read_own" on public.staff;
create policy "staff_read_own" on public.staff
  for select
  using (auth.uid() = user_id);

-- ── 3. Index page_access (optionnel, pour gin search future) ─────
-- Pas critique pour l'instant, on garde simple.

-- ════════════════════════════════════════════════════════════════════
-- DONE. Après exécution :
-- 1. La page /staff peut sauvegarder page_access sans erreur
-- 2. checkStaff() dans shell.js peut lire le rôle et les accès du staff
-- 3. Les pages non autorisées affichent bien "Accès refusé" pour le staff
--
-- RAPPEL : user_id est rempli par l'Edge Function invite-staff
-- quand le membre accepte son invitation et crée son compte.
-- Pour les membres existants, remplir user_id manuellement si besoin.
-- ════════════════════════════════════════════════════════════════════
