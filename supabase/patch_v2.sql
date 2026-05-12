-- ============================================================
-- PROSPEO — Patch v2 : colonne full_name sur profiles
-- Exécuter dans Supabase SQL Editor si rdv_tables.sql a déjà été lancé
-- ============================================================

-- Ajoute full_name si absent (opération idempotente)
alter table public.profiles
  add column if not exists full_name text;

-- Remarque : full_name est dérivé de first_name + last_name lors
-- de la création de compte. On peut le synchroniser une fois :
update public.profiles
  set full_name = trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
  where full_name is null
    and (first_name is not null or last_name is not null);
