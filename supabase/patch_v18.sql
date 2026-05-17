-- ════════════════════════════════════════════════════════════════════
-- patch_v18.sql  — Fix proposals.client_id foreign key
-- Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- patch_v17 added client_id with FK → profiles(id) which is wrong.
-- The ordonnances form sets client_id from the `clients` table, not `profiles`.
-- Fix: drop the wrong FK constraint, keep the column as a plain UUID.

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_client_id_fkey;

-- Now add the correct FK → clients(id)
-- (using ADD CONSTRAINT only if column exists, which it does from patch_v17)
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES public.clients(id)
  ON DELETE SET NULL;

-- ── Fix kyc_audit_log CHECK constraint — add 'ai_analysis' action ─
-- The analyze-kyc edge function logs with action='ai_analysis'
-- but the original CHECK only allowed: submitted|approved|rejected|resubmitted
ALTER TABLE public.kyc_audit_log
  DROP CONSTRAINT IF EXISTS kyc_audit_log_action_check;

ALTER TABLE public.kyc_audit_log
  ADD CONSTRAINT kyc_audit_log_action_check
  CHECK (action IN ('submitted','approved','rejected','resubmitted','ai_analysis'));

-- ── Fix plan prices in app_settings ───────────────────────────────
-- Update to correct prices: Pro = 5900 DA, Clinic = 13900 DA
INSERT INTO public.app_settings (key, value, updated_at, updated_by)
VALUES
  ('plan_price_pro_monthly',    '5900',  now(), 'system'),
  ('plan_price_pro_yearly',     '59000', now(), 'system'),
  ('plan_price_clinic_monthly', '13900', now(), 'system'),
  ('plan_price_clinic_yearly',  '139000',now(), 'system'),
  ('cancellation_fee_pro',      '5900',  now(), 'system'),
  ('cancellation_fee_clinic',   '13900', now(), 'system')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
