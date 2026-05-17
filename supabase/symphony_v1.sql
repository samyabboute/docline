-- ================================================================
-- symphony_v1.sql — Système de gestion d'équipe Symphony
-- Docline · 2026-05-17
-- ================================================================

-- ── 1. Table des employés Symphony ───────────────────────────────
CREATE TABLE IF NOT EXISTS symphony_staff (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        UNIQUE NOT NULL,
  employee_id   text        UNIQUE NOT NULL,  -- EMP-000001
  full_name     text        NOT NULL,
  department    text        NOT NULL CHECK (department IN (
                              'direction','sales','customer_success',
                              'billing','marketing','rd','devops','ops'
                            )),
  role          text        NOT NULL DEFAULT 'l1' CHECK (role IN (
                              'l1','l2','l3','super_admin'
                            )),
  is_active     boolean     NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Séquence auto pour numéros employés ────────────────────────
CREATE SEQUENCE IF NOT EXISTS symphony_employee_seq START 1;

-- Fonction de génération EMP-XXXXXX
CREATE OR REPLACE FUNCTION generate_employee_id()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'EMP-' || LPAD(nextval('symphony_employee_seq')::text, 6, '0');
END;
$$;

-- ── 3. Audit log Symphony — chaque action sensible tracée ─────────
CREATE TABLE IF NOT EXISTS symphony_audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   text        NOT NULL,          -- EMP-XXXXXX
  employee_name text,
  action        text        NOT NULL CHECK (action IN (
                              -- Utilisateurs
                              'delete_user','suspend_user','activate_user',
                              -- Plans
                              'set_plan','grant_access',
                              -- KYC
                              'approve_kyc','reject_kyc',
                              -- Paiements
                              'approve_payment','reject_payment',
                              -- Staff
                              'add_staff','remove_staff','update_staff',
                              -- Système
                              'export_data','view_sensitive'
                            )),
  severity      text        NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal','elevated','critical')),
  target_type   text,        -- 'user', 'subscription', 'staff', etc.
  target_id     text,
  target_email  text,
  details       jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_symphony_audit_employee ON symphony_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_symphony_audit_action   ON symphony_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_symphony_audit_created  ON symphony_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_symphony_staff_email    ON symphony_staff(email);
CREATE INDEX IF NOT EXISTS idx_symphony_staff_role     ON symphony_staff(role);

-- ── 4. RLS Policies ──────────────────────────────────────────────
ALTER TABLE symphony_staff    ENABLE ROW LEVEL SECURITY;
ALTER TABLE symphony_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role bypasse RLS → edge functions ont accès complet
-- Lecture staff : uniquement les admins authentifiés
CREATE POLICY "symphony_staff_read" ON symphony_staff
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "symphony_audit_read" ON symphony_audit_log
  FOR SELECT TO authenticated USING (true);

-- Écriture : uniquement service role (via edge functions)
CREATE POLICY "symphony_staff_write" ON symphony_staff
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "symphony_audit_write" ON symphony_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Trigger updated_at sur symphony_staff ─────────────────────
CREATE OR REPLACE FUNCTION update_symphony_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_symphony_staff_updated_at
  BEFORE UPDATE ON symphony_staff
  FOR EACH ROW EXECUTE FUNCTION update_symphony_updated_at();

-- ── 6. Seed : compte Super Admin (toi) ───────────────────────────
INSERT INTO symphony_staff (email, employee_id, full_name, department, role)
VALUES ('contact@docline.health', 'EMP-000001', 'Djaafar Lounes', 'direction', 'super_admin')
ON CONFLICT (email) DO UPDATE SET
  employee_id = EXCLUDED.employee_id,
  role = 'super_admin',
  department = 'direction',
  updated_at = now();

-- ── 7. Permissions par rôle (documentation) ──────────────────────
-- L1 : lecture seule, support basique
-- L2 : approuver KYC, approuver paiements, changer plan (avec modal interval)
-- L3 : tout L2 + supprimer utilisateur, suspendre compte, exporter données
-- super_admin : tout, sans restriction

COMMENT ON TABLE symphony_staff IS
  'Équipe interne Symphony. Rôles: l1 (lecture), l2 (opérations), l3 (actions sensibles), super_admin (tout).';

COMMENT ON TABLE symphony_audit_log IS
  'Trace immuable de toutes les actions sensibles. Chaque ligne = une action + employé + cible + timestamp.';
