-- ============================================================
-- SMS et WhatsApp : journal des envois et suivi de remise (2026-10-18)
-- Chaque message (code, confirmation, rappel, test) est journalisé sans le
-- numéro en clair (empreinte + indice « +213 ••• 456 »). Twilio met à jour
-- le statut de remise (twilio-status). Lecture réservée à l'équipe.
-- ============================================================
create table if not exists public.message_logs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  kind          text not null check (kind in ('otp', 'booking_confirmation', 'appointment_sms', 'reminder', 'test')),
  channel       text not null check (channel in ('sms', 'whatsapp')),
  to_hash       text not null,
  to_hint       text,
  doctor_id     uuid references public.profiles(id) on delete set null,
  status        text not null default 'queued',
  provider_sid  text unique,
  error_code    text,
  error_message text,
  price         numeric,
  price_unit    text
);
create index if not exists message_logs_created_idx on public.message_logs (created_at desc);
alter table public.message_logs enable row level security;
revoke all on public.message_logs from anon, authenticated;

create or replace function public.messaging_overview(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not (symphony_can('settings.manage') or symphony_can('analytics.view')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'n', count(*),
        'delivered', count(*) filter (where status in ('delivered', 'read')),
        'sent', count(*) filter (where status in ('sent', 'queued', 'accepted', 'sending')),
        'failed', count(*) filter (where status in ('failed', 'undelivered')),
        'skipped', count(*) filter (where status = 'skipped'),
        'cost', round(coalesce(sum(abs(price)), 0)::numeric, 2),
        'unit', max(price_unit))
      from message_logs where created_at > since),
    'by', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'channel', channel, 'n', n, 'delivered', d, 'failed', f) order by n desc), '[]') from (
        select kind, channel, count(*) n, count(*) filter (where status in ('delivered', 'read')) d,
               count(*) filter (where status in ('failed', 'undelivered')) f
          from message_logs where created_at > since group by kind, channel) x),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('code', error_code, 'n', n, 'message', m) order by n desc), '[]') from (
        select error_code, count(*) n, max(error_message) m from message_logs
         where created_at > since and error_code is not null group by error_code) e),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]') from (
        select created_at, kind, channel, to_hint, status, error_code, error_message, price, price_unit
          from message_logs where created_at > since order by created_at desc limit 60) r)
  );
end;
$$;
revoke all on function public.messaging_overview(int) from public, anon;
grant execute on function public.messaging_overview(int) to authenticated;
alter function public.messaging_overview(int) owner to postgres;

-- Annulation par le cabinet : nouveau type de message
alter table public.message_logs drop constraint if exists message_logs_kind_check;
alter table public.message_logs add constraint message_logs_kind_check
  check (kind in ('otp', 'booking_confirmation', 'appointment_sms', 'reminder', 'cancellation', 'test'));
