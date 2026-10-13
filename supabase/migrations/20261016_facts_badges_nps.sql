-- ============================================================
-- Expérience patient : des faits, pas des opinions (2026-10-16)
--
-- 1. Avis du patient, après une consultation vérifiée : trois questions oui/non
--    (écouté, traitement expliqué, recommanderait) et un mot facultatif réservé
--    au médecin. Plus d'étoiles, plus de commentaire public, plus de réponse
--    publique du médecin (qui confirmerait l'identité d'un patient : secret médical).
-- 2. Faits publics mesurés : état de la file en direct, meilleur moment pour
--    venir, badges vérifiés (ponctuel, prend le temps, attente courte, à l'écoute,
--    explique clairement, recommandé). Chaque badge indique sur combien de
--    passages ou de patients il repose, avec un minimum pour être honnête.
-- 3. Satisfaction envers Docline (NPS) : médecins, secrétaires et patients,
--    NPS total et par population, tableau de bord dans Symphony.
-- ============================================================

-- ── 1. Nouvel avis ──────────────────────────────────────────
alter table public.doctor_reviews alter column rating drop not null;
alter table public.doctor_reviews add column if not exists listened boolean;
alter table public.doctor_reviews add column if not exists explained boolean;
alter table public.doctor_reviews add column if not exists recommend boolean;
alter table public.doctor_reviews add column if not exists private_note text check (length(private_note) <= 400);
alter table public.doctor_reviews add column if not exists note_signed boolean not null default false;
alter table public.doctor_reviews add column if not exists note_read_at timestamptz;

create or replace function public.review_submit_v2(p_kind text, p_ref text, p_secret text,
  p_listened boolean, p_explained boolean, p_recommend boolean, p_note text default null, p_signed boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; c jsonb; txt text := nullif(trim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
        suspicious text; burst int; rid uuid;
begin
  c := review_context(p_kind, p_ref, p_secret);
  if not (c->>'eligible')::boolean then raise exception 'REVIEW_%', upper(coalesce(c->>'reason', 'unknown')); end if;
  if p_listened is null or p_explained is null or p_recommend is null then raise exception 'ANSWERS_REQUIRED'; end if;
  if length(txt) > 400 then raise exception 'NOTE_TOO_LONG'; end if;
  v := _review_visit(p_kind, p_ref, p_secret);
  select count(*) into burst from doctor_reviews where doctor_id = (v->>'doctor_id')::uuid and created_at > now() - interval '30 minutes';
  suspicious := case when p_kind = 'queue' and coalesce((v->>'consult_minutes')::int, 0) < 2 then 'Vérification automatique : consultation de moins de 2 minutes'
                     when burst >= 5 then 'Vérification automatique : nombreux avis en peu de temps' end;
  insert into doctor_reviews (doctor_id, source, queue_entry_id, appointment_id, visit_date, rating, tags, comment_status, author_label, wait_minutes,
                              listened, explained, recommend, private_note, note_signed, hidden, hidden_reason)
  values ((v->>'doctor_id')::uuid, p_kind, (v->>'queue_entry_id')::uuid, (v->>'appointment_id')::uuid, (v->>'visit_date')::date,
          null, '{}', 'none', coalesce(c->>'author_label', 'Un patient'), (v->>'wait')::int,
          p_listened, p_explained, p_recommend, txt, coalesce(p_signed, false) and c->>'author_label' is not null,
          suspicious is not null, suspicious)
  returning id into rid;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 2. Faits mesurés ────────────────────────────────────────
-- Rythme du cabinet : durée médiane d'une consultation (30 jours, 10 passages minimum)
create or replace function public._clinic_pace(p_doctor uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by m))::int end
    from (select extract(epoch from (done_at - called_at)) / 60 m from queue_entries
           where clinic_id = p_doctor and called_at is not null and done_at is not null
             and done_at > called_at and done_at - called_at between interval '1 minute' and interval '2 hours'
             and created_at > now() - interval '30 days') x
$$;

-- Rythme public (page du patient dans la file) : aucune estimation inventée
create or replace function public.queue_pace(p_clinic uuid)
returns int language sql stable security definer set search_path = public as $$ select _clinic_pace(p_clinic) $$;

-- Badges : valeur, base de calcul, seuil ; earned seulement si l'échantillon suffit
create or replace function public._doctor_badges(p_doctor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (
    select created_at, called_at, done_at, notes, queue_date from queue_entries
     where clinic_id = p_doctor and called_at is not null and called_at >= created_at and created_at > now() - interval '90 days'),
  wait as (select count(*) n, percentile_cont(0.5) within group (order by extract(epoch from (called_at - created_at)) / 60) m
             from q where called_at - created_at < interval '12 hours'),
  dur as (select count(*) n, percentile_cont(0.5) within group (order by extract(epoch from (done_at - called_at)) / 60) m
            from q where done_at is not null and done_at - called_at between interval '1 minute' and interval '2 hours'),
  ponct as (
    select count(*) n,
           count(*) filter (where (called_at at time zone 'Africa/Algiers') <= (queue_date + substring(notes from 'RDV en ligne · (\d{1,2}:\d{2})')::time) + interval '15 minutes') ok
      from q where notes ~ '^RDV en ligne · \d{1,2}:\d{2}'),
  ans as (select count(*) n,
                 count(*) filter (where listened) l, count(*) filter (where explained) e, count(*) filter (where recommend) r
            from doctor_reviews where doctor_id = p_doctor and not hidden and recommend is not null)
  select jsonb_build_array(
    jsonb_build_object('key', 'ponctuel', 'label', 'Ponctuel', 'n', ponct.n, 'min_n', 10, 'threshold', 80,
      'value', case when ponct.n > 0 then round(100.0 * ponct.ok / ponct.n) end,
      'earned', ponct.n >= 10 and 100.0 * ponct.ok / greatest(ponct.n, 1) >= 80,
      'detail', 'Rendez-vous reçus à moins de 15 min de l''heure prévue'),
    jsonb_build_object('key', 'prend_le_temps', 'label', 'Prend le temps', 'n', dur.n, 'min_n', 20, 'threshold', 15,
      'value', round(dur.m), 'earned', dur.n >= 20 and dur.m >= 15, 'detail', 'Durée médiane d''une consultation'),
    jsonb_build_object('key', 'attente_courte', 'label', 'Attente courte', 'n', wait.n, 'min_n', 20, 'threshold', 20,
      'value', round(wait.m), 'earned', wait.n >= 20 and wait.m <= 20, 'detail', 'Attente médiane en salle, de l''arrivée à l''appel'),
    jsonb_build_object('key', 'a_l_ecoute', 'label', 'À l''écoute', 'n', ans.n, 'min_n', 10, 'threshold', 85,
      'value', case when ans.n > 0 then round(100.0 * ans.l / ans.n) end, 'earned', ans.n >= 10 and 100.0 * ans.l / greatest(ans.n, 1) >= 85,
      'detail', 'Patients qui se sont sentis écoutés'),
    jsonb_build_object('key', 'explique', 'label', 'Explique clairement', 'n', ans.n, 'min_n', 10, 'threshold', 85,
      'value', case when ans.n > 0 then round(100.0 * ans.e / ans.n) end, 'earned', ans.n >= 10 and 100.0 * ans.e / greatest(ans.n, 1) >= 85,
      'detail', 'Patients à qui le traitement a été bien expliqué'),
    jsonb_build_object('key', 'recommande', 'label', 'Recommandé', 'n', ans.n, 'min_n', 10, 'threshold', 85,
      'value', case when ans.n > 0 then round(100.0 * ans.r / ans.n) end, 'earned', ans.n >= 10 and 100.0 * ans.r / greatest(ans.n, 1) >= 85,
      'detail', 'Patients qui le recommanderaient à un proche'))
  from wait, dur, ponct, ans
$$;

-- Meilleurs moments pour venir : attente médiane par jour et heure d'arrivée (90 jours)
create or replace function public._doctor_best_times(p_doctor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (
    select extract(isodow from created_at at time zone 'Africa/Algiers')::int dow,
           extract(hour from created_at at time zone 'Africa/Algiers')::int h,
           extract(epoch from (called_at - created_at)) / 60 m
      from queue_entries
     where clinic_id = p_doctor and called_at is not null and called_at >= created_at
       and called_at - created_at < interval '12 hours' and created_at > now() - interval '90 days'),
  cells as (select dow, h, count(*) n, round(percentile_cont(0.5) within group (order by m))::int med from q group by dow, h having count(*) >= 5)
  select case when (select count(*) from q) >= 30 then
    coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', h, 'median', med, 'n', n) order by med, n desc)
                from (select * from cells order by med, n desc limit 3) b), '[]') else '[]' end
$$;

-- État de la file en direct (seulement pour un cabinet qui utilise la file)
create or replace function public._doctor_live(p_doctor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st jsonb; d date := (now() at time zone 'Africa/Algiers')::date; waiting int; pace int;
begin
  if not exists (select 1 from queue_entries where clinic_id = p_doctor and created_at > now() - interval '14 days') then return null; end if;
  st := queue_status(p_doctor, d);
  select count(*) into waiting from queue_entries where clinic_id = p_doctor and queue_date = d and status = 'waiting';
  pace := _clinic_pace(p_doctor);
  return jsonb_build_object('accepting', (st->>'accepting')::boolean, 'reason', st->>'reason',
    'open_from', st->>'open_from', 'open_until', st->>'open_until', 'waiting', waiting,
    'estimate', case when pace is not null then waiting * pace end);
end;
$$;

create or replace function public.doctor_public_facts(p_doctor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from profiles where id = p_doctor and is_public and coalesce(is_active, true)) then
    jsonb_build_object('live', _doctor_live(p_doctor), 'best_times', _doctor_best_times(p_doctor),
      'badges', (select coalesce(jsonb_agg(b), '[]') from jsonb_array_elements(_doctor_badges(p_doctor)) b where (b->>'earned')::boolean))
  end
$$;

create or replace function public.doctor_public_facts_many(p_doctors uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(d, jsonb_build_object('live', _doctor_live(d),
           'badges', (select coalesce(jsonb_agg(b), '[]') from jsonb_array_elements(_doctor_badges(d)) b where (b->>'earned')::boolean))), '{}')
    from unnest(p_doctors[1:60]) d
   where exists (select 1 from profiles where id = d and is_public and coalesce(is_active, true))
$$;

-- Espace du médecin : badges et progression, carte de l'attente, réponses, mots privés
create or replace function public.my_experience()
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select * from doctor_reviews where doctor_id = auth.uid() and not hidden and recommend is not null),
  q as (select created_at, called_at,
               extract(isodow from created_at at time zone 'Africa/Algiers')::int dow,
               extract(hour from created_at at time zone 'Africa/Algiers')::int h,
               extract(epoch from (called_at - created_at)) / 60 m
          from queue_entries where clinic_id = auth.uid() and called_at is not null and called_at >= created_at
           and called_at - created_at < interval '12 hours' and created_at > now() - interval '90 days')
  select jsonb_build_object(
    'badges', _doctor_badges(auth.uid()),
    'best_times', _doctor_best_times(auth.uid()),
    'pace', _clinic_pace(auth.uid()),
    'answers', jsonb_build_object('n', (select count(*) from r),
        'listened', (select round(100.0 * count(*) filter (where listened) / nullif(count(*), 0)) from r),
        'explained', (select round(100.0 * count(*) filter (where explained) / nullif(count(*), 0)) from r),
        'recommend', (select round(100.0 * count(*) filter (where recommend) / nullif(count(*), 0)) from r),
        'last30', (select count(*) from r where created_at > now() - interval '30 days')),
    'wait', jsonb_build_object(
        'm30', (select round(percentile_cont(0.5) within group (order by m))::int from q where created_at > now() - interval '30 days'),
        'n30', (select count(*) from q where created_at > now() - interval '30 days'),
        'mprev', (select round(percentile_cont(0.5) within group (order by m))::int from q where created_at <= now() - interval '30 days' and created_at > now() - interval '60 days'),
        'n90', (select count(*) from q)),
    'heatmap', coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', h, 'median', med, 'n', n)) from (
        select dow, h, count(*) n, round(percentile_cont(0.5) within group (order by m))::int med from q group by dow, h having count(*) >= 3) c), '[]'),
    'notes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id, private_note as note, case when note_signed then author_label end as signed_by, visit_date, created_at, note_read_at is null as unread
          from doctor_reviews where doctor_id = auth.uid() and not hidden and private_note is not null
         order by created_at desc limit 100) x), '[]'))
$$;

create or replace function public.my_notes_mark_read()
returns void language sql security definer set search_path = public as $$
  update doctor_reviews set note_read_at = now() where doctor_id = auth.uid() and private_note is not null and note_read_at is null
$$;

-- Vérification des avis suspects (équipe Docline) : les mots privés restent privés
create or replace function public.reviews_moderation(p_status text default 'hidden', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (symphony_can('doctors.edit') or symphony_can('doctors.view')) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id, r.rating, r.listened, r.explained, r.recommend, r.author_label, r.visit_date, r.wait_minutes, r.source,
           r.hidden, r.hidden_reason, r.created_at, r.doctor_id, (r.private_note is not null) as has_note,
           coalesce(p.clinic_name, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.full_name) as doctor_name
      from doctor_reviews r join profiles p on p.id = r.doctor_id
     where case p_status when 'hidden' then r.hidden else true end
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]');
end;
$$;

-- Anciennes fonctions publiques (étoiles, commentaires, réponses) : retirées
drop function if exists public.my_reviews();
drop function if exists public.doctor_review_summaries(uuid[]);
drop function if exists public.doctor_reviews_public(uuid, int, int);
drop function if exists public.doctor_review_summary(uuid);
drop function if exists public.review_reply(uuid, text);
drop function if exists public.review_submit(text, text, text, int, text[], text, boolean);

-- ── 3. Satisfaction envers Docline (NPS) ───────────────────
create table if not exists public.nps_responses (
  id         uuid primary key default gen_random_uuid(),
  segment    text not null check (segment in ('doctor', 'staff', 'patient')),
  score      smallint not null check (score between 0 and 10),
  reasons    text[] not null default '{}',
  comment    text check (length(comment) <= 600),
  user_id    uuid references auth.users(id) on delete set null,
  doctor_id  uuid references public.profiles(id) on delete set null,
  review_id  uuid unique references public.doctor_reviews(id) on delete set null,
  source     text not null default 'in_app' check (source in ('in_app', 'after_visit', 'legacy')),
  created_at timestamptz not null default now()
);
create index if not exists nps_responses_created_idx on public.nps_responses (created_at desc);
alter table public.nps_responses enable row level security;
revoke all on public.nps_responses from anon, authenticated;

create table if not exists public.nps_prompts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  dismissed_at  timestamptz,
  answered_at   timestamptz
);
alter table public.nps_prompts enable row level security;
revoke all on public.nps_prompts from anon, authenticated;

-- Reprise des réponses de l'ancienne enquête (table feedback)
insert into nps_responses (segment, score, comment, user_id, source, created_at)
select 'doctor', f.nps_score, nullif(trim(f.comment), ''), f.user_id, 'legacy', f.created_at
  from feedback f
 where f.nps_score is not null
   and not exists (select 1 from nps_responses n where n.source = 'legacy' and n.user_id is not distinct from f.user_id and n.created_at = f.created_at);

create or replace function public._nps_reasons_ok(p_segment text, p text[])
returns boolean language sql immutable as $$
  select coalesce(array_length(p, 1), 0) <= 5 and coalesce(p <@ case p_segment
    when 'patient' then array['reservation', 'suivi_file', 'moins_attente', 'rappels', 'simplicite', 'infos_medecin', 'bugs', 'lenteur']
    else array['agenda', 'file_attente', 'ordonnances', 'dossiers', 'rdv_en_ligne', 'simplicite', 'rapidite', 'support', 'prix', 'bugs', 'lenteur', 'manque'] end, true)
$$;

create or replace function public._nps_segment()
returns text language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from staff where user_id = auth.uid() and coalesce(active, true)) then 'staff'
              when exists (select 1 from profiles where id = auth.uid()) then 'doctor' end
$$;

-- Faut-il poser la question ? 14 jours d'usage, puis une fois tous les 90 jours ; 21 jours de répit après « Plus tard »
create or replace function public.nps_should_ask()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare seg text := _nps_segment(); p nps_prompts; created timestamptz; last_answer timestamptz;
begin
  if auth.uid() is null or seg is null or symphony_is_staff() then return jsonb_build_object('ask', false); end if;
  select u.created_at into created from auth.users u where u.id = auth.uid();
  select * into p from nps_prompts where user_id = auth.uid();
  select max(created_at) into last_answer from nps_responses where user_id = auth.uid();
  return jsonb_build_object('segment', seg, 'ask',
    created < now() - interval '14 days'
    and (last_answer is null or last_answer < now() - interval '90 days')
    and (p.dismissed_at is null or p.dismissed_at < now() - interval '21 days'));
end;
$$;

create or replace function public.nps_submit(p_score int, p_reasons text[] default '{}', p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare seg text := _nps_segment();
begin
  if auth.uid() is null or seg is null then raise exception 'FORBIDDEN'; end if;
  if p_score is null or p_score not between 0 and 10 then raise exception 'SCORE_INVALID'; end if;
  if not _nps_reasons_ok(seg, p_reasons) then raise exception 'REASONS_INVALID'; end if;
  if exists (select 1 from nps_responses where user_id = auth.uid() and created_at > now() - interval '30 days') then raise exception 'ALREADY_ANSWERED'; end if;
  insert into nps_responses (segment, score, reasons, comment, user_id, doctor_id, source)
  values (seg, p_score, coalesce(p_reasons, '{}'), nullif(trim(left(p_comment, 600)), ''), auth.uid(),
          case when seg = 'doctor' then auth.uid() else (select clinic_id from staff where user_id = auth.uid() limit 1) end, 'in_app');
  insert into nps_prompts (user_id, answered_at) values (auth.uid(), now())
  on conflict (user_id) do update set answered_at = now();
end;
$$;

create or replace function public.nps_dismiss()
returns void language sql security definer set search_path = public as $$
  insert into nps_prompts (user_id, dismissed_at) values (auth.uid(), now())
  on conflict (user_id) do update set dismissed_at = now()
$$;

-- Patient : une réponse par consultation vérifiée, juste après son avis
create or replace function public.nps_submit_patient(p_kind text, p_ref text, p_secret text, p_score int, p_reasons text[] default '{}', p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; rid uuid;
begin
  if p_score is null or p_score not between 0 and 10 then raise exception 'SCORE_INVALID'; end if;
  if not _nps_reasons_ok('patient', p_reasons) then raise exception 'REASONS_INVALID'; end if;
  v := _review_visit(p_kind, p_ref, p_secret);
  if v is null then raise exception 'VISIT_UNKNOWN'; end if;
  select id into rid from doctor_reviews
   where queue_entry_id = (v->>'queue_entry_id')::uuid or appointment_id = (v->>'appointment_id')::uuid limit 1;
  if rid is null then raise exception 'REVIEW_FIRST'; end if;
  insert into nps_responses (segment, score, reasons, comment, doctor_id, review_id, source)
  values ('patient', p_score, coalesce(p_reasons, '{}'), nullif(trim(left(p_comment, 600)), ''), (v->>'doctor_id')::uuid, rid, 'after_visit')
  on conflict (review_id) do nothing;
end;
$$;

-- Tableau de bord Symphony : NPS total et par population, évolution, raisons, verbatims
create or replace function public.nps_dashboard(p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 730));
begin
  if not symphony_can('analytics.view') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'segments', (select jsonb_object_agg(seg, x) from (
        select coalesce(segment, 'total') seg, jsonb_build_object('n', count(*),
               'promoters', count(*) filter (where score >= 9), 'passives', count(*) filter (where score between 7 and 8),
               'detractors', count(*) filter (where score <= 6),
               'nps', case when count(*) > 0 then round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / count(*)) end,
               'distribution', (select jsonb_agg(c order by s) from (select s, (select count(*) from nps_responses n2 where n2.created_at > since and (g.segment is null or n2.segment = g.segment) and n2.score = s) c from generate_series(0, 10) s) d)) x
          from (select segment, score from nps_responses where created_at > since) g
         group by grouping sets ((segment), ())) y),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'segment', segment, 'n', n, 'nps', nps) order by m), '[]') from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') m, coalesce(segment, 'total') segment, count(*) n,
               round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / count(*)) nps
          from nps_responses where created_at > now() - interval '12 months'
         group by grouping sets ((date_trunc('month', created_at), segment), (date_trunc('month', created_at)))) z),
    'reasons', (select coalesce(jsonb_agg(jsonb_build_object('segment', segment, 'reason', rsn, 'group', grp, 'n', n) order by n desc), '[]') from (
        select segment, rsn, case when score >= 9 then 'promoters' when score <= 6 then 'detractors' else 'passives' end grp, count(*) n
          from nps_responses, unnest(reasons) rsn where created_at > since group by 1, 2, 3) w),
    'verbatims', (select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc), '[]') from (
        select n.segment, n.score, n.reasons, n.comment, n.created_at, n.source,
               coalesce(p.wilaya, '') as wilaya, coalesce(p.specialty, '') as specialty
          from nps_responses n left join profiles p on p.id = n.doctor_id
         where n.created_at > since and n.comment is not null order by n.created_at desc limit 80) v),
    'doctor_experience', (select jsonb_build_object('n', count(*),
        'recommend', round(100.0 * count(*) filter (where recommend) / nullif(count(*), 0)),
        'listened', round(100.0 * count(*) filter (where listened) / nullif(count(*), 0)),
        'explained', round(100.0 * count(*) filter (where explained) / nullif(count(*), 0)))
       from doctor_reviews where not hidden and recommend is not null and created_at > since)
  );
end;
$$;

-- ── Droits ──────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['_clinic_pace(uuid)', '_doctor_badges(uuid)', '_doctor_best_times(uuid)', '_doctor_live(uuid)',
                           '_nps_reasons_ok(text,text[])', '_nps_segment()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
  foreach f in array array['review_submit_v2(text,text,text,boolean,boolean,boolean,text,boolean)', 'queue_pace(uuid)',
                           'doctor_public_facts(uuid)', 'doctor_public_facts_many(uuid[])',
                           'nps_submit_patient(text,text,text,int,text[],text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
  foreach f in array array['my_experience()', 'my_notes_mark_read()', 'reviews_moderation(text,int)', 'nps_should_ask()',
                           'nps_submit(int,text[],text)', 'nps_dismiss()', 'nps_dashboard(int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
