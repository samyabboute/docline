-- Protection des SMS contre les abus (pompage de SMS, harcèlement d'un numéro, robots).
-- Les règles sont appliquées dans le module d'envoi (supabase/functions/_shared/messaging.ts),
-- avant chaque SMS, quelle que soit la fonction qui l'envoie. Chaque refus est journalisé (statut « blocked »).

alter table public.message_logs add column if not exists scope text;
alter table public.message_logs add column if not exists ip_hash text;
alter table public.message_logs drop constraint if exists message_logs_kind_check;
alter table public.message_logs add constraint message_logs_kind_check
  check (kind in ('otp', 'staff_code', 'booking_confirmation', 'appointment_sms', 'reminder', 'cancellation', 'test'));
create index if not exists message_logs_to_idx on public.message_logs (to_hash, created_at desc);
create index if not exists message_logs_ip_idx on public.message_logs (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists message_logs_doctor_idx on public.message_logs (doctor_id, created_at desc) where doctor_id is not null;

-- Numéros qui ne reçoivent plus aucun SMS (désinscription STOP, abus, demande de la personne)
create table if not exists public.sms_blocklist (
  to_hash    text primary key,
  to_hint    text,
  reason     text,
  source     text not null default 'admin' check (source in ('admin', 'stop', 'auto')),
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.sms_blocklist enable row level security;
revoke all on public.sms_blocklist from public, anon, authenticated;

-- Réglages (une seule ligne) : arrêt d'urgence et plafonds
create table if not exists public.sms_guard_settings (
  id             int primary key default 1 check (id = 1),
  paused         boolean not null default false,
  hourly_cap     int not null default 200 check (hourly_cap between 10 and 10000),
  daily_cap      int not null default 1200 check (daily_cap between 50 and 100000),
  per_number_day int not null default 8 check (per_number_day between 2 and 50),
  updated_at     timestamptz not null default now(),
  updated_by     text
);
insert into public.sms_guard_settings (id) values (1) on conflict do nothing;
alter table public.sms_guard_settings enable row level security;
revoke all on public.sms_guard_settings from public, anon, authenticated;

-- Tableau de bord (Symphony, permission Paramètres)
create or replace function public.sms_guard_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st sms_guard_settings;
begin
  if not symphony_can('settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into st from sms_guard_settings where id = 1;
  return jsonb_build_object(
    'settings', to_jsonb(st),
    'last_hour', (select count(*) from message_logs where created_at > now() - interval '1 hour' and status not in ('blocked', 'skipped')),
    'last_day', (select count(*) from message_logs where created_at > now() - interval '1 day' and status not in ('blocked', 'skipped')),
    'blocked_day', (select count(*) from message_logs where created_at > now() - interval '1 day' and status = 'blocked'),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('code', error_code, 'label', max_msg, 'n', n) order by n desc) from (
        select error_code, max(error_message) max_msg, count(*) n from message_logs
         where created_at > now() - interval '7 days' and status = 'blocked' group by error_code) r), '[]'),
    'top_numbers', coalesce((select jsonb_agg(jsonb_build_object('hint', hint, 'hash', to_hash, 'n', n, 'blocked', b) order by n desc) from (
        select to_hash, max(to_hint) hint, count(*) n, exists (select 1 from sms_blocklist b where b.to_hash = m.to_hash) b
          from message_logs m where created_at > now() - interval '1 day' group by to_hash order by count(*) desc limit 6) t), '[]'),
    'blocklist', coalesce((select jsonb_agg(jsonb_build_object('hash', to_hash, 'hint', to_hint, 'reason', reason, 'source', source, 'at', created_at) order by created_at desc)
        from sms_blocklist), '[]'));
end;
$$;

create or replace function public.sms_guard_save(p_paused boolean, p_hourly int, p_daily int, p_per_number int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update sms_guard_settings set paused = coalesce(p_paused, paused), hourly_cap = coalesce(p_hourly, hourly_cap),
         daily_cap = coalesce(p_daily, daily_cap), per_number_day = coalesce(p_per_number, per_number_day),
         updated_at = now(), updated_by = auth.email() where id = 1;
end;
$$;

-- p_e164 : numéro au format international (+2135…) ; l'empreinte est la même que celle du module d'envoi
create or replace function public.sms_block(p_e164 text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(coalesce(p_e164, ''), '[^0-9+]', '', 'g');
begin
  if not symphony_can('settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v !~ '^\+[0-9]{8,15}$' then raise exception 'PHONE_INVALID'; end if;
  insert into sms_blocklist (to_hash, to_hint, reason, source, created_by)
  values (encode(sha256(convert_to(v, 'UTF8')), 'hex'), left(v, 4) || ' ••• ' || right(v, 3), nullif(trim(p_reason), ''), 'admin', auth.email())
  on conflict (to_hash) do update set reason = excluded.reason, created_by = excluded.created_by;
end;
$$;

create or replace function public.sms_block_hash(p_hash text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into sms_blocklist (to_hash, to_hint, reason, source, created_by)
  values (p_hash, (select max(to_hint) from message_logs where to_hash = p_hash), nullif(trim(p_reason), ''), 'admin', auth.email())
  on conflict (to_hash) do nothing;
end;
$$;

create or replace function public.sms_unblock(p_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from sms_blocklist where to_hash = p_hash;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['sms_guard_overview()', 'sms_guard_save(boolean,int,int,int)', 'sms_block(text,text)', 'sms_block_hash(text,text)', 'sms_unblock(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;

-- Le numéro de mes tests du 14 octobre (+213 555 00 00 00) ne doit plus jamais recevoir de SMS Docline
insert into public.sms_blocklist (to_hash, to_hint, reason, source, created_by)
values (encode(sha256(convert_to('+213555000000', 'UTF8')), 'hex'), '+213 ••• 000', 'Numéro utilisé par erreur lors de tests', 'admin', 'docline')
on conflict do nothing;
