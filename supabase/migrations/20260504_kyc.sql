-- ═══════════════════════════════════════════════════════════════
-- Migration KYC médical — Docline v18
-- Vérification d'identité des médecins par document
-- ═══════════════════════════════════════════════════════════════

-- 1. Colonnes KYC sur la table profiles
-- ───────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_status        text    NOT NULL DEFAULT 'not_submitted'
    CHECK (kyc_status IN ('not_submitted','pending_review','approved','rejected')),
  ADD COLUMN IF NOT EXISTS kyc_document_url  text,          -- chemin dans storage: {uid}/kyc_{ts}.{ext}
  ADD COLUMN IF NOT EXISTS kyc_document_type text,          -- 'ordre', 'diplome', 'autre'
  ADD COLUMN IF NOT EXISTS kyc_order_number  text,          -- Numéro d'inscription à l'Ordre des Médecins
  ADD COLUMN IF NOT EXISTS kyc_submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_reviewer_id   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS kyc_reject_reason text;

-- Index pour recherche rapide des dossiers en attente (admin)
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status ON public.profiles(kyc_status);

-- 2. Bucket Supabase Storage : doctor-kyc (privé)
-- ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doctor-kyc',
  'doctor-kyc',
  false,            -- bucket privé : jamais accessible sans URL signée
  10485760,         -- 10 MB max par fichier
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Politiques RLS Storage
-- ─────────────────────────
-- Le médecin peut uploader dans son propre dossier : {uid}/...
DO $$ BEGIN
  CREATE POLICY "Doctor upload own KYC doc"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'doctor-kyc'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Le médecin peut lire son propre document
DO $$ BEGIN
  CREATE POLICY "Doctor read own KYC doc"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'doctor-kyc'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Le médecin peut remplacer son document (mise à jour)
DO $$ BEGIN
  CREATE POLICY "Doctor update own KYC doc"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'doctor-kyc'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role : accès total (admin, robot IA futur)
DO $$ BEGIN
  CREATE POLICY "Service role full access KYC"
    ON storage.objects FOR ALL TO service_role
    USING (bucket_id = 'doctor-kyc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Table de log KYC (historique des décisions)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyc_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('submitted','approved','rejected','resubmitted')),
  reviewer_id   uuid REFERENCES auth.users(id),
  document_url  text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kyc_audit_log ENABLE ROW LEVEL SECURITY;

-- Médecin peut lire son propre historique
DO $$ BEGIN
  CREATE POLICY "Doctor read own kyc log"
    ON public.kyc_audit_log FOR SELECT TO authenticated
    USING (doctor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role : accès total
DO $$ BEGIN
  CREATE POLICY "Service role kyc log"
    ON public.kyc_audit_log FOR ALL TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Fonction helper : soumettre ou re-soumettre un dossier KYC
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_kyc(
  p_doctor_id     uuid,
  p_document_url  text,
  p_document_type text DEFAULT 'ordre',
  p_order_number  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_status text;
BEGIN
  SELECT kyc_status INTO v_old_status FROM public.profiles WHERE id = p_doctor_id;

  UPDATE public.profiles SET
    kyc_status        = 'pending_review',
    kyc_document_url  = p_document_url,
    kyc_document_type = p_document_type,
    kyc_order_number  = COALESCE(p_order_number, kyc_order_number),
    kyc_submitted_at  = now(),
    kyc_reviewed_at   = NULL,
    kyc_reviewer_id   = NULL,
    kyc_reject_reason = NULL,
    updated_at        = now()
  WHERE id = p_doctor_id;

  INSERT INTO public.kyc_audit_log (doctor_id, action, document_url)
  VALUES (
    p_doctor_id,
    CASE WHEN v_old_status = 'rejected' THEN 'resubmitted' ELSE 'submitted' END,
    p_document_url
  );
END;
$$;
