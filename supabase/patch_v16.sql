-- ════════════════════════════════════════════════════════════
-- patch_v16.sql  — Admin writes + password reset + account deletion
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════

-- ── 1. FIX app_settings RLS (admin write) ─────────────────────
-- The existing table only had a SELECT policy. Admins need UPSERT.
DROP POLICY IF EXISTS "admin can write app_settings"  ON public.app_settings;
DROP POLICY IF EXISTS "admin write app_settings"       ON public.app_settings;
DROP POLICY IF EXISTS "admins can write app_settings"  ON public.app_settings;

CREATE POLICY "admins can write app_settings"
ON public.app_settings
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
)
WITH CHECK (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
);

-- ── 2. FIX promo_codes RLS (admin write) ──────────────────────
DROP POLICY IF EXISTS "admins can write promo_codes" ON public.promo_codes;

CREATE POLICY "admins can write promo_codes"
ON public.promo_codes
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
)
WITH CHECK (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
);

-- ── 3. Add trial_ends_at column alias (patch_v15 used trial_end) ─
-- Ensure both column names work
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at   timestamptz,
  ADD COLUMN IF NOT EXISTS trial_granted_months integer DEFAULT 2;

-- Sync existing trial_end values if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'trial_end'
  ) THEN
    UPDATE public.profiles SET trial_ends_at = trial_end WHERE trial_ends_at IS NULL AND trial_end IS NOT NULL;
  END IF;
END $$;

-- ── 4. Account deletion requests table ────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id             uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_email   text        NOT NULL,
  doctor_name    text,
  plan           text        NOT NULL DEFAULT 'free',
  has_active_sub boolean     NOT NULL DEFAULT false,
  cancellation_fee_da integer NOT NULL DEFAULT 0,
  reason         text,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processed','cancelled')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  processed_by   text
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Doctor can see and create their own request
CREATE POLICY "doctor can manage own deletion request"
ON public.account_deletion_requests
FOR ALL
USING  (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admin can see all deletion requests
CREATE POLICY "admins can manage all deletion requests"
ON public.account_deletion_requests
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
);

-- ── 5. Password reset log (audit) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_password_resets (
  id           uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  target_email text        NOT NULL,
  reset_type   text        NOT NULL DEFAULT 'email_link'
                           CHECK (reset_type IN ('email_link', 'admin_set')),
  requested_by text        NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can log password resets"
ON public.admin_password_resets
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
);

-- ── 6. Marketing offers table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_offers (
  id             uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title          text        NOT NULL,
  body           text        NOT NULL,
  offer_type     text        NOT NULL DEFAULT 'discount'
                             CHECK (offer_type IN ('discount','free_trial','feature','custom')),
  discount_pct   integer,
  target_plan    text        DEFAULT 'all',
  sent_count     integer     NOT NULL DEFAULT 0,
  sent_at        timestamptz,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can manage marketing offers"
ON public.marketing_offers
FOR ALL
USING (
  auth.email() IN ('samyabboute5@gmail.com', 'contact@docline.health')
  OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
);

-- ── 7. Seed additional app_settings if missing ────────────────
INSERT INTO public.app_settings (key, value, updated_at, updated_by)
VALUES
  ('trial_max_users',       '10',    now(), 'system'),
  ('cancellation_fee_pro',  '2500',  now(), 'system'),
  ('cancellation_fee_clinic','6500', now(), 'system')
ON CONFLICT (key) DO NOTHING;
