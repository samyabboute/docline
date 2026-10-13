-- ============================================================
-- P0 sécurité (2026-10-19) : les ordonnances étaient lisibles et modifiables
-- par n'importe qui. Deux règles héritées de l'ancien module de devis
-- (« lecture / signature publique si share_token ») s'appliquaient à toutes les
-- ordonnances, qui reçoivent toutes un share_token. Aucune page ne s'en sert.
-- Seul le médecin propriétaire garde l'accès (règle users_own_proposals).
-- ============================================================
drop policy if exists public_read_proposal_by_token on public.proposals;
drop policy if exists public_sign_proposal on public.proposals;
revoke all on public.proposals from anon;
