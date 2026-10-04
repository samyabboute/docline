-- ════════════════════════════════════════════════════════════════════
-- patch_v19.sql — Fix subscriptions & kyc_audit_log constraint
-- Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Add 'set_plan' + 'deactivated' + 'activated' to kyc_audit_log ─
-- (patch_v18 only added 'ai_analysis'; admin actions like set_plan,
--  activated, deactivated were also missing)
ALTER TABLE public.kyc_audit_log
  DROP CONSTRAINT IF EXISTS kyc_audit_log_action_check;

ALTER TABLE public.kyc_audit_log
  ADD CONSTRAINT kyc_audit_log_action_check
  CHECK (action IN (
    'submitted','approved','rejected','resubmitted',
    'ai_analysis','set_plan','activated','deactivated'
  ));

-- ── 2. Ensure subscriptions table has updated_at column ───────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 3. Fix any doctor stuck with wrong plan / missing subscription ────
-- This upserts subscriptions for every doctor whose profiles.plan != 'free'
-- but has no active subscription row (or a stale one).
-- Safe to run multiple times (idempotent).

INSERT INTO public.subscriptions (user_id, plan, status, created_at, updated_at)
SELECT
  p.id          AS user_id,
  p.plan        AS plan,
  'active'      AS status,
  now()         AS created_at,
  now()         AS updated_at
FROM public.profiles p
WHERE p.plan IN ('pro', 'clinic')
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p.id AND s.status = 'active' AND s.plan = p.plan
  )
ON CONFLICT DO NOTHING;

-- Also activate any row that has the right plan but wrong status
UPDATE public.subscriptions s
SET status = 'active', updated_at = now()
FROM public.profiles p
WHERE s.user_id = p.id
  AND p.plan IN ('pro', 'clinic')
  AND s.plan = p.plan
  AND s.status != 'active';

-- ── 4. Confirm — show all non-free subscriptions ──────────────────────
SELECT s.user_id, p.full_name, s.plan, s.status, s.updated_at
FROM public.subscriptions s
LEFT JOIN public.profiles p ON p.id = s.user_id
WHERE s.plan != 'free'
ORDER BY s.updated_at DESC
LIMIT 20;
