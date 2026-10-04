-- Migration: Add NPS columns to feedback table
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS nps_score smallint CHECK (nps_score BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS category  text     CHECK (category IN ('ui','performance','feature','bug','support','autre')),
  ALTER COLUMN rating DROP NOT NULL;

-- Drop old select policy
DROP POLICY IF EXISTS "users_read_own_feedback" ON public.feedback;

-- New combined policy: own row OR admin email
CREATE POLICY "feedback_read_policy" ON public.feedback FOR SELECT USING (
  (auth.uid() = user_id)
  OR (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
);

-- New index
CREATE INDEX IF NOT EXISTS idx_feedback_nps ON public.feedback(nps_score, created_at DESC);
