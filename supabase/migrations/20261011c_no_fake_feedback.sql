-- L'outil de simulation pouvait injecter de faux avis NPS dans la table feedback
-- (données de production). La fonction qui le permettait est retirée.
drop function if exists public.admin_insert_simulated_feedback(jsonb);
