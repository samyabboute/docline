-- Email templates (admin-editable)
CREATE TABLE IF NOT EXISTS public.email_templates (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  subject     text NOT NULL,
  heading     text NOT NULL,
  intro_text  text NOT NULL,
  cta_text    text,
  cta_url     text,
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='email_templates' AND policyname='authenticated read email_templates') THEN
    CREATE POLICY "authenticated read email_templates" ON public.email_templates FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

INSERT INTO public.email_templates (id, name, subject, heading, intro_text, cta_text, cta_url) VALUES
  ('welcome',           'Bienvenue',            'Bienvenue sur Docline 🎉',                        'Votre espace médical est prêt !',               E'Bonjour {{first_name}},\n\nVotre compte Docline est maintenant activé. Commencez par ajouter vos premiers patients et gérez vos rendez-vous facilement depuis votre espace personnel.', 'Accéder à mon espace →', '{{app_url}}/app.html'),
  ('trial_granted',     'Accès Pro activé',     'Votre accès Pro Docline est activé 🚀',           'Accès Pro gratuit — 2 mois offerts',            E'Bonjour {{first_name}},\n\nFélicitations ! Vous faites partie des premiers médecins Docline. Profitez de toutes les fonctionnalités Pro gratuitement pendant 2 mois, sans engagement.', 'Explorer les fonctionnalités →', '{{app_url}}/app.html'),
  ('trial_expiring',    'Essai bientôt terminé','Votre essai Docline se termine dans 7 jours ⏰',  'Votre période d''essai se termine bientôt',     E'Bonjour {{first_name}},\n\nVotre accès Pro gratuit expire dans 7 jours. Pour continuer à profiter de toutes les fonctionnalités sans interruption, choisissez votre abonnement dès maintenant.', 'Voir les offres →', '{{app_url}}/pricing.html'),
  ('payment_confirmed', 'Paiement confirmé',    'Votre abonnement Docline est actif ✅',            'Abonnement confirmé — Merci !',                 E'Bonjour {{first_name}},\n\nVotre paiement a bien été reçu et votre abonnement Pro est maintenant actif. Toutes les fonctionnalités sont disponibles dans votre espace.', 'Accéder à mon espace →', '{{app_url}}/app.html'),
  ('contact_autoreply', 'Auto-reply contact',   'Votre message a bien été reçu — Docline',         'Nous avons bien reçu votre message',            E'Bonjour {{first_name}},\n\nMerci de nous avoir contactés. Notre équipe vous répondra dans les 24 heures ouvrées.\n\nEn attendant, n''hésitez pas à consulter notre centre d''aide en ligne.', 'Centre d''aide →', 'https://docline.health/aide')
ON CONFLICT (id) DO NOTHING;

-- Flag pour éviter d'envoyer le bienvenue deux fois
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent boolean DEFAULT false;
