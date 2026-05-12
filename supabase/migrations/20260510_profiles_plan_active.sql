-- Colonnes manquantes dans profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan       text    NOT NULL DEFAULT 'free'
                            CHECK (plan IN ('free','pro','clinic')),
  ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true;
