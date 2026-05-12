-- Table des demandes de paiement (Chargily + manuel)
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email           text,
  plan                 text        NOT NULL CHECK (plan IN ('pro','enterprise','clinic')),
  billing              text        NOT NULL CHECK (billing IN ('monthly','yearly')),
  amount               integer     NOT NULL,
  method               text        NOT NULL CHECK (method IN ('cib','edahabia','baridimob','virement','cash')),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','confirmed','failed','refunded')),
  reference            text,
  chargily_checkout_id text,
  notes                text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- L'utilisateur peut lire ses propres paiements
CREATE POLICY "user can read own payment_requests" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- L'utilisateur peut insérer ses propres paiements (paiement manuel)
CREATE POLICY "user can insert own payment_requests" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Colonnes optionnelles (ajout si la table existait déjà sans elles)
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS user_email           text,
  ADD COLUMN IF NOT EXISTS reference            text,
  ADD COLUMN IF NOT EXISTS chargily_checkout_id text,
  ADD COLUMN IF NOT EXISTS notes                text;

-- Index pour les lookups fréquents
CREATE INDEX IF NOT EXISTS idx_payment_requests_user    ON public.payment_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_checkout ON public.payment_requests (chargily_checkout_id)
  WHERE chargily_checkout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_requests_status  ON public.payment_requests (status);
