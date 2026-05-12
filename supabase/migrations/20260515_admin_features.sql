-- ============================================================
-- DOCLINE — Admin features: promo access, last_seen, app_settings
-- ============================================================

-- 1. Promo trial access (2-month free for launch users)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at  timestamptz,
  ADD COLUMN IF NOT EXISTS trial_granted_by text,   -- admin email who granted it
  ADD COLUMN IF NOT EXISTS last_seen_at   timestamptz;

-- Index for expiry checks
CREATE INDEX IF NOT EXISTS idx_profiles_trial    ON public.profiles (trial_ends_at) WHERE trial_ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_lastseen ON public.profiles (last_seen_at)  WHERE last_seen_at  IS NOT NULL;

-- 2. App settings (key-value store for admin toggles)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

-- Seed default payment method toggles
INSERT INTO public.app_settings (key, value) VALUES
  ('payment_cib',       'true'::jsonb),
  ('payment_edahabia',  'true'::jsonb),
  ('payment_baridimob', 'true'::jsonb),
  ('payment_virement',  'true'::jsonb),
  ('payment_cash',      'true'::jsonb),
  ('maintenance_mode',  'false'::jsonb),
  ('new_signups',       'true'::jsonb),
  ('launch_banner',     '"Bienvenue ! Docline est en ligne 🎉"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS: only service_role can write; authenticated can read (Edge Functions use anon key)
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='public read app_settings') THEN
    CREATE POLICY "public read app_settings" ON public.app_settings FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

-- 3. Helper: is_on_trial() — returns true if current user has an active trial
CREATE OR REPLACE FUNCTION public.is_on_trial()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at > now()
  );
$$;

-- 4. Promo codes table (for marketing)
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  code        text        NOT NULL UNIQUE,
  description text,
  plan        text        NOT NULL DEFAULT 'pro' CHECK (plan IN ('pro','enterprise')),
  duration_days integer   NOT NULL DEFAULT 60,
  max_uses    integer,
  uses        integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promo_codes' AND policyname='authenticated read active promo_codes') THEN
    CREATE POLICY "authenticated read active promo_codes" ON public.promo_codes FOR SELECT TO authenticated USING (active = true AND (expires_at IS NULL OR expires_at > now()));
  END IF;
END $$;

-- 5. Promo redemptions log
CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promo_code   text        NOT NULL,
  redeemed_at  timestamptz DEFAULT now()
);

ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promo_redemptions' AND policyname='user read own redemptions') THEN
    CREATE POLICY "user read own redemptions" ON public.promo_redemptions FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;
