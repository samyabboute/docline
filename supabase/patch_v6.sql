-- ============================================================
-- DOCLINE — Patch v6 : Chargily Pay + fix payment_requests
-- Exécuter dans Supabase SQL Editor (après patch_v5.sql)
-- ============================================================

-- ── 1. Ajouter la colonne 'reference' manquante ───────────────
-- (la référence de transaction saisie par l'utilisateur)
alter table public.payment_requests
  add column if not exists reference text;

-- ── 2. Ajouter chargily_checkout_id ──────────────────────────
alter table public.payment_requests
  add column if not exists chargily_checkout_id text;

create index if not exists idx_payment_req_chargily
  on public.payment_requests(chargily_checkout_id)
  where chargily_checkout_id is not null;

-- ── 3. Mettre à jour la contrainte de statut ─────────────────
-- Ajouter 'confirmed' (paiement Chargily vérifié par webhook)
alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;

alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending','approved','confirmed','rejected'));

-- ── 4. S'assurer que 'cib' est bien dans la contrainte method ─
-- (normalement déjà fait par patch_v5, sécurité supplémentaire)
alter table public.payment_requests
  drop constraint if exists payment_requests_method_check;

alter table public.payment_requests
  add constraint payment_requests_method_check
  check (method in ('cib','edahabia','virement','cash'));

-- ── Vérification ─────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
  where table_name = 'payment_requests'
    and table_schema = 'public'
  order by ordinal_position;
