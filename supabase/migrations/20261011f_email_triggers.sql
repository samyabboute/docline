-- ============================================================
-- Emails automatiques (2026-10-11)
-- La base prévient le médecin au bon moment, via la fonction notify :
-- vérification (reçue, validée, refusée), demande de paiement reçue ou
-- refusée, reçu de paiement, échéance prolongée, compte suspendu ou
-- réactivé. Deux envois planifiés : rappel de rendez-vous la veille
-- (18 h, heure d'Alger) et fin d'essai (9 h, heure d'Alger).
-- Chaque email n'est envoyé qu'une fois (dédoublonnage dans notify).
-- ============================================================

create or replace function public.profiles_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kyc_status is distinct from old.kyc_status and new.kyc_status in ('pending_review', 'approved', 'rejected') then
    perform _notify(jsonb_build_object('event', 'kyc_status', 'doctor_id', new.id, 'status', new.kyc_status));
  end if;
  if old.is_active is not null and new.is_active is distinct from old.is_active then
    perform _notify(jsonb_build_object('event', 'account_status', 'doctor_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_email_notify on public.profiles;
create trigger profiles_email_notify after update of kyc_status, is_active on public.profiles
  for each row execute function public.profiles_email_notify();

create or replace function public.payment_requests_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'rejected') then
    perform _notify(jsonb_build_object('event', 'payment_request', 'request_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists payment_requests_email_notify on public.payment_requests;
create trigger payment_requests_email_notify after insert or update of status on public.payment_requests
  for each row execute function public.payment_requests_email_notify();

create or replace function public.billing_entries_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'payment' then
    perform _notify(jsonb_build_object('event', 'payment_recorded', 'entry_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists billing_entries_email_notify on public.billing_entries;
create trigger billing_entries_email_notify after insert on public.billing_entries
  for each row execute function public.billing_entries_email_notify();

create or replace function public.billing_extensions_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform _notify(jsonb_build_object('event', 'extension_approved', 'extension_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists billing_extensions_email_notify on public.billing_extensions;
create trigger billing_extensions_email_notify after update of status on public.billing_extensions
  for each row execute function public.billing_extensions_email_notify();

do $$ declare f text; begin
  foreach f in array array['profiles_email_notify()', 'payment_requests_email_notify()', 'billing_entries_email_notify()', 'billing_extensions_email_notify()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;

-- Envois planifiés (heures UTC ; Alger = UTC+1)
do $$ begin perform cron.unschedule('docline_appt_reminders'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('docline_trial_reminders'); exception when others then null; end $$;
select cron.schedule('docline_appt_reminders', '0 17 * * *', $$select public._notify('{"event":"appointment_reminders"}'::jsonb)$$);
select cron.schedule('docline_trial_reminders', '0 8 * * *', $$select public._notify('{"event":"trial_reminders"}'::jsonb)$$);
