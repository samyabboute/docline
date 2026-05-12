-- ─────────────────────────────────────────────────────────────
-- Docline — Appointments enhancements
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Nouvelles colonnes appointments
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS patient_confirmed    BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_token   TEXT      DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS sms_confirmation_sent BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS arrived_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show              BOOLEAN   DEFAULT false;

-- Garantir l'unicité du token (si la colonne est nouvelle)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'appointments' AND indexname = 'appointments_confirmation_token_key'
  ) THEN
    CREATE UNIQUE INDEX appointments_confirmation_token_key ON appointments(confirmation_token);
  END IF;
END $$;

-- 2. Compteur no-show sur clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0;

-- 3. Vue utilitaire : RDV du jour enrichis
DROP VIEW IF EXISTS v_today_appointments;
CREATE VIEW v_today_appointments AS
SELECT
  a.id,
  a.doctor_id,
  a.patient_name,
  a.patient_phone,
  a.requested_date,
  a.requested_time,
  a.status,
  a.patient_confirmed,
  a.sms_confirmation_sent,
  a.arrived_at,
  a.no_show,
  a.confirmation_token,
  p.full_name   AS doctor_name,
  p.clinic_name AS clinic_name
FROM appointments a
LEFT JOIN profiles p ON p.id = a.doctor_id
WHERE a.requested_date = CURRENT_DATE;

-- 4. RLS : permettre la lecture anonyme par token (confirm.html)
-- La politique autorise SELECT public sur appointments uniquement via confirmation_token
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'appointments' AND policyname = 'anon_confirm_by_token'
  ) THEN
    CREATE POLICY anon_confirm_by_token ON appointments
      FOR SELECT TO anon
      USING (confirmation_token IS NOT NULL);
  END IF;
END $$;

-- Politique UPDATE anonyme (uniquement les champs de confirmation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'appointments' AND policyname = 'anon_update_confirmation'
  ) THEN
    CREATE POLICY anon_update_confirmation ON appointments
      FOR UPDATE TO anon
      USING (confirmation_token IS NOT NULL)
      WITH CHECK (true);
  END IF;
END $$;
