-- ════════════════════════════════════════════════════════════════════
-- patch_v18.sql  — Fix proposals.client_id foreign key
-- Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- patch_v17 added client_id with FK → profiles(id) which is wrong.
-- The ordonnances form sets client_id from the `clients` table, not `profiles`.
-- Fix: drop the wrong FK constraint, keep the column as a plain UUID.

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_client_id_fkey;

-- Now add the correct FK → clients(id)
-- (using ADD CONSTRAINT only if column exists, which it does from patch_v17)
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES public.clients(id)
  ON DELETE SET NULL;
