-- Rappel SMS une heure avant le rendez-vous (promis aux patients sur la page de réservation).
-- 1. Chaque rendez-vous porte son horodatage exact (date + heure, heure d'Alger), y compris ceux saisis au cabinet.
-- 2. Un report de rendez-vous réarme le rappel.
-- 3. La fonction send-reminder passe toutes les 10 minutes (fenêtre 55 à 65 min avant le RDV, un seul envoi par RDV).

create or replace function public.appointments_schedule_ts()
returns trigger language plpgsql as $$
begin
  if new.requested_date is not null and coalesce(new.requested_time, '') ~ '^\d{1,2}:\d{2}' then
    if tg_op = 'INSERT' or new.scheduled_at_ts is null
       or new.requested_date is distinct from old.requested_date or new.requested_time is distinct from old.requested_time then
      new.scheduled_at_ts := (new.requested_date + substring(new.requested_time from '^\d{1,2}:\d{2}')::time) at time zone 'Africa/Algiers';
      if tg_op = 'UPDATE' and (new.requested_date is distinct from old.requested_date or new.requested_time is distinct from old.requested_time)
         and new.scheduled_at_ts > now() then
        new.reminder_sent := false;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_schedule_ts on public.appointments;
create trigger appointments_schedule_ts before insert or update of requested_date, requested_time, scheduled_at_ts on public.appointments
  for each row execute function public.appointments_schedule_ts();

-- Reprise : rendez-vous sans horodatage
update public.appointments
   set scheduled_at_ts = (requested_date + substring(requested_time from '^\d{1,2}:\d{2}')::time) at time zone 'Africa/Algiers'
 where scheduled_at_ts is null and requested_date is not null and coalesce(requested_time, '') ~ '^\d{1,2}:\d{2}';

-- Rendez-vous déjà passés : jamais de rappel rétroactif
update public.appointments set reminder_sent = true
 where coalesce(reminder_sent, false) = false and scheduled_at_ts < now();

create or replace function public._send_sms_reminders()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://ferkzwzypmdtuypxribz.supabase.co/functions/v1/send-reminder',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', public._notify_secret()),
    timeout_milliseconds := 15000);
exception when others then
  raise warning 'send-reminder: %', sqlerrm;
end;
$$;
revoke all on function public._send_sms_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'docline_sms_reminders';
select cron.schedule('docline_sms_reminders', '*/10 * * * *', 'select public._send_sms_reminders()');
