-- ================================================================
-- patch_v20.sql — Payment flow columns + policies
-- Docline v20 · 2026-05-17
-- ================================================================

-- 1. Add new columns to subscriptions (safe: IF NOT EXISTS style)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS interval text CHECK (interval IN ('month','year')),
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('online','transfer','cash')),
  ADD COLUMN IF NOT EXISTS trial_end_date timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_notes text;

-- 2. Add plan_interval to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_interval text;

-- 3. Backfill existing active paid subscriptions
UPDATE subscriptions
SET payment_status = 'paid'
WHERE plan IN ('pro','clinic')
  AND status = 'active'
  AND payment_status = 'pending';

-- 4. Admin RLS policy (service role bypasses RLS anyway, but belt-and-suspenders)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'subscriptions'
      AND policyname = 'admin_payment_update'
  ) THEN
    EXECUTE '
      CREATE POLICY "admin_payment_update" ON subscriptions
        FOR ALL
        TO authenticated
        USING (true)
        WITH CHECK (true)
    ';
  END IF;
END $$;

-- 5. Update kyc_audit_log action CHECK to include new payment actions
-- Drop old constraint and recreate (Postgres does not support ALTER CONSTRAINT)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT constraint_name INTO cname
  FROM information_schema.table_constraints
  WHERE table_name = 'kyc_audit_log'
    AND constraint_type = 'CHECK'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE kyc_audit_log DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE kyc_audit_log
  ADD CONSTRAINT kyc_audit_log_action_check
  CHECK (action IN (
    'approved','rejected','set_plan',
    'activated','deactivated',
    'approve_payment','reject_payment'
  ));
