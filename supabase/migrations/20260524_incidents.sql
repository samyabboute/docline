-- ═══════════════════════════════════════════════════════════════════
-- ITIL Incident Management — tables incidents + incident_updates
-- ═══════════════════════════════════════════════════════════════════

-- ── incidents ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        NOT NULL DEFAULT 'application',
  -- application | infrastructure | security | performance | data | other
  priority         TEXT        NOT NULL DEFAULT 'P3',
  -- P1 Critique | P2 Élevée | P3 Moyenne | P4 Faible
  status           TEXT        NOT NULL DEFAULT 'new',
  -- new | assigned | in_progress | escalated | resolved | closed
  assigned_to      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_email   TEXT,
  reported_by      TEXT,           -- email of the reporter
  affected_service TEXT,
  escalation_level INTEGER     NOT NULL DEFAULT 0,  -- 0=none 1=L1 2=L2 3=L3
  sla_deadline     TIMESTAMPTZ,    -- auto-calculated from priority
  resolved_at      TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── incident_updates (journal d'audit complet) ───────────────────
CREATE TABLE IF NOT EXISTS incident_updates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID        NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author      TEXT        NOT NULL,   -- email
  type        TEXT        NOT NULL,
  -- note | status_change | escalation | assignment | resolution | closure
  content     TEXT        NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_incidents_status     ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_priority   ON incidents(priority);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inc_updates_incident ON incident_updates(incident_id, created_at);

-- ── updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON incidents;
CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : admin only ─────────────────────────────────────────────
ALTER TABLE incidents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_updates ENABLE ROW LEVEL SECURITY;

-- Service-role (Edge Functions) can do anything
CREATE POLICY "service_role_incidents"        ON incidents        FOR ALL USING (true);
CREATE POLICY "service_role_incident_updates" ON incident_updates FOR ALL USING (true);
