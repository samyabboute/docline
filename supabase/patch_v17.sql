-- ════════════════════════════════════════════════════════════════════
-- patch_v17.sql  — Admin RLS policies + data integrity fixes
-- Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- ── HELPER: identify admins ────────────────────────────────────────
-- Reused in every policy below

-- ── 1. PROFILES — admin can read ALL profiles (fixes KPI totals) ───
DROP POLICY IF EXISTS "admin read all profiles" ON public.profiles;

CREATE POLICY "admin read all profiles"
ON public.profiles
FOR SELECT
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 2. PROFILES — admin can write/update all profiles ─────────────
DROP POLICY IF EXISTS "admin write all profiles" ON public.profiles;

CREATE POLICY "admin write all profiles"
ON public.profiles
FOR UPDATE
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
)
WITH CHECK (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 3. APPOINTMENTS — admin can read ALL appointments (fixes KPI) ──
DROP POLICY IF EXISTS "admin read all appointments" ON public.appointments;

CREATE POLICY "admin read all appointments"
ON public.appointments
FOR SELECT
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 4. SUBSCRIPTIONS — admin can read all subscriptions ───────────
DROP POLICY IF EXISTS "admin read all subscriptions" ON public.subscriptions;

CREATE POLICY "admin read all subscriptions"
ON public.subscriptions
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
)
WITH CHECK (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 5. KYC_AUDIT_LOG — admin can read/write ───────────────────────
DROP POLICY IF EXISTS "admin manage kyc_audit_log" ON public.kyc_audit_log;

CREATE POLICY "admin manage kyc_audit_log"
ON public.kyc_audit_log
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
)
WITH CHECK (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 6. ACCOUNT_DELETION_REQUESTS — admin read + doctor insert ────
-- Table is created in patch_v16.sql but the policy may be missing
-- if patch_v16 was run partially. Re-drop and recreate to be safe.
DROP POLICY IF EXISTS "manage deletion requests" ON public.account_deletion_requests;

CREATE POLICY "manage deletion requests"
ON public.account_deletion_requests
FOR ALL
USING (
  user_id = auth.uid()
  OR auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
)
WITH CHECK (
  user_id = auth.uid()
  OR auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE email = auth.email())
);

-- ── 7. ENSURE is_active column default is true for existing rows ───
-- (safety: make sure no existing doctors were wrongly marked inactive)
UPDATE public.profiles
SET is_active = true
WHERE is_active IS NULL;

-- ── 7. Index for is_active filter (performance) ───────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_is_active
  ON public.profiles(is_active)
  WHERE is_active = true;

-- ── 8. Ensure subscriptions has unique constraint on user_id ──────
-- (needed for upsert in set_plan edge function)
-- Only add if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
    AND contype = 'u'
    AND conname = 'subscriptions_user_id_unique'
  ) THEN
    -- Check if there are duplicate user_ids before adding constraint
    IF NOT EXISTS (
      SELECT user_id FROM public.subscriptions
      GROUP BY user_id HAVING COUNT(*) > 1
    ) THEN
      ALTER TABLE public.subscriptions
        ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
    END IF;
  END IF;
END $$;
