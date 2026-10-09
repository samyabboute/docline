-- ============================================================
-- Notifications par email (2026-10-09)
-- La base prévient la fonction « notify » à chaque événement utile,
-- quelle que soit la page d'origine (réservation, agenda, espace patient,
-- lien de confirmation). Un échec d'envoi ne bloque jamais la réservation.
-- À appliquer APRÈS 20261008_patient_sync.sql (utilise cancelled_by).
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- Secret partagé base -> fonction, gardé dans le coffre Supabase
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'notify_secret',
                                'Docline : secret partagé entre la base et la fonction notify');
  end if;
end $$;

create or replace function public._notify_secret()
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret' limit 1
$$;
revoke all on function public._notify_secret() from public, anon, authenticated;
grant execute on function public._notify_secret() to service_role;

create or replace function public._notify(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://ferkzwzypmdtuypxribz.supabase.co/functions/v1/notify',
    body    := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', public._notify_secret()),
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'notify: %', sqlerrm;   -- ne jamais bloquer l'opération d'origine
end;
$$;
revoke all on function public._notify(jsonb) from public, anon, authenticated;

-- ── Rendez-vous ─────────────────────────────────────────────
create or replace function public.appointments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Utilisateur connecté (médecin, clinique, secrétaire) = saisie au cabinet : on ne s'écrit pas à soi-même.
    perform _notify(jsonb_build_object(
      'event', 'appointment_created', 'appointment_id', new.id,
      'source', case when auth.uid() is not null then 'doctor' else 'online' end));
  elsif new.status is distinct from old.status then
    perform _notify(jsonb_build_object(
      'event', 'appointment_status', 'appointment_id', new.id,
      'old_status', old.status, 'new_status', new.status));
  end if;
  return null;
end;
$$;
drop trigger if exists appointments_notify on public.appointments;
create trigger appointments_notify after insert or update of status on public.appointments
  for each row execute function public.appointments_notify();

-- ── Espace patient : bienvenue quand un email est renseigné ─
create or replace function public.patients_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.account_created_at is not null
     and (tg_op = 'INSERT' or new.email is distinct from old.email or old.account_created_at is null) then
    perform _notify(jsonb_build_object('event', 'patient_welcome', 'patient_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists patients_notify on public.patients;
create trigger patients_notify after insert or update of email, account_created_at on public.patients
  for each row execute function public.patients_notify();

revoke all on function public.appointments_notify() from public, anon, authenticated;
revoke all on function public.patients_notify() from public, anon, authenticated;

-- ── Modèles d'emails stockés en base : textes corrigés ──────
-- Plus d'adresses en .html, plus de durée d'essai contradictoire,
-- plus de page /aide inexistante, abonnement non limité au « Pro ».
update public.email_templates set
  subject = 'Bienvenue sur Docline',
  heading = 'Votre cabinet est prêt',
  intro_text = E'Bonjour {{first_name}},\n\nVotre compte Docline est actif. Pour bien démarrer :\n\n1. Renseignez vos horaires de consultation.\n2. Ajoutez ou importez vos patients.\n3. Partagez votre lien de réservation avec vos patients.\n\nUne question ? Répondez simplement à cet email.',
  cta_text = 'Ouvrir mon cabinet', cta_url = '{{app_url}}/dashboard'
where id = 'welcome';

update public.email_templates set
  subject = 'Votre accès Pro Docline est activé',
  heading = 'Votre accès Pro est activé',
  intro_text = E'Bonjour {{first_name}},\n\nToutes les fonctionnalités Pro sont débloquées sur votre compte : patients et ordonnances illimités, rappels automatiques, statistiques.\n\nNous vous préviendrons avant la fin de votre accès.',
  cta_text = 'Découvrir les fonctionnalités', cta_url = '{{app_url}}/dashboard'
where id = 'trial_granted';

update public.email_templates set
  subject = 'Votre essai Docline se termine bientôt',
  heading = 'Votre essai se termine bientôt',
  intro_text = E'Bonjour {{first_name}},\n\nVotre accès Pro arrive bientôt à son terme. Pour continuer sans interruption, choisissez votre abonnement : vos patients, rendez-vous et ordonnances restent bien sûr conservés.\n\nEn payant à l''année, deux mois vous sont offerts.',
  cta_text = 'Choisir mon abonnement', cta_url = '{{app_url}}/pricing'
where id = 'trial_expiring';

update public.email_templates set
  subject = 'Votre abonnement Docline est actif',
  heading = 'Merci, votre abonnement est actif',
  intro_text = E'Bonjour {{first_name}},\n\nNous avons bien reçu votre paiement. Toutes les fonctionnalités de votre abonnement sont disponibles dans votre espace.\n\nUne question sur votre abonnement ? Répondez simplement à cet email.',
  cta_text = 'Ouvrir mon cabinet', cta_url = '{{app_url}}/dashboard'
where id = 'payment_confirmed';

update public.email_templates set
  subject = 'Nous avons bien reçu votre message',
  heading = 'Message bien reçu',
  intro_text = E'Bonjour {{first_name}},\n\nMerci de nous avoir écrit. Notre équipe vous répond sous 24 heures ouvrées, à cette adresse.',
  cta_text = null, cta_url = null
where id = 'contact_autoreply';
