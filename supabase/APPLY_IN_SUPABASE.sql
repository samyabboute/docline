-- ═══════════════════════════════════════════════════════════════════════════
-- DOCLINE — Script de migration unique à exécuter dans le SQL Editor Supabase
-- Copier-coller l'intégralité dans : supabase.com → votre projet → SQL Editor
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / OR REPLACE)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. feedback : colonnes NPS ───────────────────────────────────────────
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS nps_score smallint CHECK (nps_score BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS category  text     CHECK (category IN ('ui','performance','feature','bug','support','autre'));

-- Rendre rating nullable (non requis pour NPS)
DO $$ BEGIN
  ALTER TABLE public.feedback ALTER COLUMN rating DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- ── 2. Politiques RLS feedback ───────────────────────────────────────────
-- Lecture : utilisateur propriétaire OU admin
DROP POLICY IF EXISTS "users_read_own_feedback"  ON public.feedback;
DROP POLICY IF EXISTS "feedback_read_policy"      ON public.feedback;
CREATE POLICY "feedback_read_policy" ON public.feedback FOR SELECT USING (
  (auth.uid() = user_id)
  OR (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
);

-- Insert : utilisateur propriétaire OU admin (pour la simulation)
DROP POLICY IF EXISTS "feedback_insert_policy" ON public.feedback;
CREATE POLICY "feedback_insert_policy" ON public.feedback FOR INSERT WITH CHECK (
  (auth.uid() = user_id)
  OR (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
);

-- ── 3. Fonction RPC admin_insert_simulated_feedback ──────────────────────
-- SECURITY DEFINER = s'exécute en tant que propriétaire (bypass RLS total)
-- Seuls les admins Docline peuvent l'appeler (vérification JWT dans la fonction)
CREATE OR REPLACE FUNCTION public.admin_insert_simulated_feedback(rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
  inserted_count int;
BEGIN
  -- Vérifier que l'appelant est bien un admin Docline
  caller_email := (auth.jwt() ->> 'email');
  IF caller_email NOT IN ('samyabboute5@gmail.com', 'contact@docline.health') THEN
    RAISE EXCEPTION 'Accès refusé — réservé aux administrateurs Docline';
  END IF;

  -- Insérer les lignes (bypass RLS grâce à SECURITY DEFINER)
  INSERT INTO public.feedback (user_id, nps_score, rating, category, comment, page, created_at)
  SELECT
    (r->>'user_id')::uuid,
    (r->>'nps_score')::smallint,
    (r->>'rating')::smallint,
    r->>'category',
    r->>'comment',
    COALESCE(r->>'page', 'dashboard'),
    COALESCE((r->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(rows) AS r;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('inserted', inserted_count);
END;
$$;

-- Autoriser l'accès à cette fonction via l'anon key (Supabase client)
GRANT EXECUTE ON FUNCTION public.admin_insert_simulated_feedback(jsonb) TO anon, authenticated;

-- ── 4. Table symphony_agents ─────────────────────────────────────────
-- Équipe interne Docline : agents, leads, managers par département
CREATE TABLE IF NOT EXISTS public.symphony_agents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  email         text        NOT NULL UNIQUE,
  full_name     text,
  department    text        CHECK (department IN ('support','billing','kyc','commercial','marketing')),
  role          text        NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','lead','manager')),
  employee_id   char(4)     UNIQUE,
  is_active     boolean     NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Activer RLS
ALTER TABLE public.symphony_agents ENABLE ROW LEVEL SECURITY;

-- Seuls les super-admins Docline peuvent lire / écrire
DROP POLICY IF EXISTS "symphony_agents_admin_policy" ON public.symphony_agents;
CREATE POLICY "symphony_agents_admin_policy" ON public.symphony_agents
  USING (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
  WITH CHECK (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'));

-- Trigger de mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_symphony_agents_updated ON public.symphony_agents;
CREATE TRIGGER trg_symphony_agents_updated
  BEFORE UPDATE ON public.symphony_agents
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_symphony_agents_dept   ON public.symphony_agents(department);
CREATE INDEX IF NOT EXISTS idx_symphony_agents_active ON public.symphony_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_symphony_agents_emp    ON public.symphony_agents(employee_id);

-- ── 6. Index performance feedback ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_feedback_nps      ON public.feedback(nps_score, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_nps ON public.feedback(user_id, nps_score);

-- ── 7. Table maintenance_notify ──────────────────────────────────────────────
-- Visiteurs souhaitant être notifiés lors de la reprise du service
CREATE TABLE IF NOT EXISTS public.maintenance_notify (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prenom     text        NOT NULL,
  nom        text        NOT NULL,
  email      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

ALTER TABLE public.maintenance_notify ENABLE ROW LEVEL SECURITY;

-- INSERT public : tout le monde peut s'inscrire (visiteurs anonymes)
DROP POLICY IF EXISTS "maintenance_notify_insert" ON public.maintenance_notify;
CREATE POLICY "maintenance_notify_insert" ON public.maintenance_notify
  FOR INSERT WITH CHECK (true);

-- SELECT / DELETE : admins Docline uniquement (pour envoyer les emails puis purger)
DROP POLICY IF EXISTS "maintenance_notify_admin" ON public.maintenance_notify;
CREATE POLICY "maintenance_notify_admin" ON public.maintenance_notify
  FOR ALL
  USING  (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
  WITH CHECK (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'));

-- ── 8. Table user_metadata + colonnes KYC ────────────────────────────────────────
-- Crée la table si elle n'existe pas, puis ajoute les colonnes KYC pour symphony-kyc.html
CREATE TABLE IF NOT EXISTS public.user_metadata (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Colonnes KYC (idempotentes)
ALTER TABLE public.user_metadata
  ADD COLUMN IF NOT EXISTS kyc_status  text    DEFAULT 'pending'
    CHECK (kyc_status IN ('pending','in_review','approved','rejected')),
  ADD COLUMN IF NOT EXISTS kyc_docs    jsonb   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS kyc_note    text;

-- Activer RLS
ALTER TABLE public.user_metadata ENABLE ROW LEVEL SECURITY;

-- Utilisateur peut lire/écrire ses propres métadonnées
DROP POLICY IF EXISTS "user_metadata_self" ON public.user_metadata;
CREATE POLICY "user_metadata_self" ON public.user_metadata
  FOR ALL
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins Docline : accès complet (pour KYC)
DROP POLICY IF EXISTS "user_metadata_kyc_admin" ON public.user_metadata;
CREATE POLICY "user_metadata_kyc_admin" ON public.user_metadata
  FOR ALL
  USING  (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
  WITH CHECK (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'));

-- Trigger updated_at (réutilise la fonction créée à la section 4)
DROP TRIGGER IF EXISTS trg_user_metadata_updated ON public.user_metadata;
CREATE TRIGGER trg_user_metadata_updated
  BEFORE UPDATE ON public.user_metadata
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Index pour filtrage rapide par statut KYC
CREATE INDEX IF NOT EXISTS idx_user_metadata_kyc ON public.user_metadata(kyc_status);

-- ── 9. Table email_logs ──────────────────────────────────────────────────────
-- Trace de tous les emails envoyés par la plateforme (visible dans Symphony)
CREATE TABLE IF NOT EXISTS public.email_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text        NOT NULL,
  recipient_email text        NOT NULL,
  recipient_name  text,
  subject         text,
  status          text        NOT NULL DEFAULT 'sent'
                              CHECK (status IN ('sent', 'failed')),
  triggered_by    text,       -- email de l'admin ou utilisateur déclencheur
  metadata        jsonb       DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Seuls les admins Docline peuvent lire les logs d'emails
DROP POLICY IF EXISTS "email_logs_admin" ON public.email_logs;
CREATE POLICY "email_logs_admin" ON public.email_logs
  FOR ALL
  USING  (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'))
  WITH CHECK (auth.jwt() ->> 'email' IN ('samyabboute5@gmail.com', 'contact@docline.health'));

-- Index pour filtrage par type et date
CREATE INDEX IF NOT EXISTS idx_email_logs_type    ON public.email_logs(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_date    ON public.email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_to      ON public.email_logs(recipient_email);

-- ═══════════════════════════════════════════════════════════════════════════
-- ✓ Après exécution : simulation NPS, validation KYC, maintenance_notify
--   et email_logs fonctionnent sans aucune autre action.
-- ═══════════════════════════════════════════════════════════════════════════
