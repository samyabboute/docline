-- Admin roles table for multi-user access control
CREATE TABLE IF NOT EXISTS admin_roles (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  role       text        NOT NULL CHECK (role IN ('super_admin', 'support', 'kyc_agent')),
  added_by   text,
  created_at timestamptz DEFAULT now()
);

-- RLS: authenticated users can read all rows (panel already has auth guard)
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read admin_roles" ON admin_roles
  FOR SELECT TO authenticated USING (true);

-- Only service role (Edge Functions) can insert / update / delete
-- (no client-side write policies)

-- Seed super admin
INSERT INTO admin_roles (email, role, added_by)
VALUES ('samyabboute5@gmail.com', 'super_admin', 'system')
ON CONFLICT (email) DO NOTHING;
