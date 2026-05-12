-- Ajouter les colonnes médicales manquantes à la table clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS date_naissance  date,
  ADD COLUMN IF NOT EXISTS groupe_sanguin  text,
  ADD COLUMN IF NOT EXISTS medecin_traitant text,
  ADD COLUMN IF NOT EXISTS insurance_type  text DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS insurance_num   text,
  ADD COLUMN IF NOT EXISTS antecedents     text;
