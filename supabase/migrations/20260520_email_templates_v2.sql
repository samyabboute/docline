-- Email templates v2 — remove emojis, professional subjects and CTA text
UPDATE public.email_templates SET
  subject    = 'Bienvenue sur Docline',
  heading    = 'Votre espace médical est prêt',
  cta_text   = 'Accéder à mon espace',
  updated_at = now()
WHERE id = 'welcome';

UPDATE public.email_templates SET
  subject    = 'Votre accès Pro Docline est activé',
  intro_text = E'Bonjour {{first_name}},\n\nFélicitations. Vous faites partie des premiers médecins Docline. Profitez de toutes les fonctionnalités Pro gratuitement pendant 2 mois, sans engagement.',
  cta_text   = 'Explorer les fonctionnalités',
  updated_at = now()
WHERE id = 'trial_granted';

UPDATE public.email_templates SET
  subject    = 'Votre essai Docline se termine dans 7 jours',
  cta_text   = 'Voir les offres',
  updated_at = now()
WHERE id = 'trial_expiring';

UPDATE public.email_templates SET
  subject    = 'Votre abonnement Docline est actif',
  heading    = 'Abonnement confirmé — Merci',
  cta_text   = 'Accéder à mon espace',
  updated_at = now()
WHERE id = 'payment_confirmed';

UPDATE public.email_templates SET
  cta_text   = 'Centre d''aide',
  updated_at = now()
WHERE id = 'contact_autoreply';
