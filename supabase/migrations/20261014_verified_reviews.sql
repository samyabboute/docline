-- ============================================================
-- Avis patients vérifiés (2026-10-14)
--
-- Seul un patient réellement passé en consultation peut donner son avis :
--  * file d'attente : quand le cabinet termine la consultation (statut « done »),
--    la page du patient (QR code) propose l'avis ; la clé secrète remise à
--    l'inscription prouve que c'est bien lui ;
--  * rendez-vous en ligne : quand le rendez-vous passe à « completed », le
--    ticket du patient (lien personnel) propose l'avis et un email l'y invite.
-- Un seul avis par passage. Le temps d'attente est mesuré par la file, pas
-- déclaré. La note est publiée aussitôt ; un commentaire écrit est relu par
-- l'équipe avant publication. Les moyennes publiques n'apparaissent qu'à
-- partir de 3 avis.
-- ============================================================

-- 1. Horodatage de la file : arrivée (created_at), appel, fin de consultation
alter table public.queue_entries add column if not exists called_at timestamptz;
alter table public.queue_entries add column if not exists done_at timestamptz;

create or replace function public.queue_entries_stamp()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'current' and new.called_at is null then new.called_at := now(); end if;
    if new.status = 'done' then
      new.called_at := coalesce(new.called_at, old.called_at, now());
      new.done_at := coalesce(new.done_at, now());
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists queue_entries_stamp on public.queue_entries;
create trigger queue_entries_stamp before update of status on public.queue_entries
  for each row execute function public.queue_entries_stamp();

-- Clé d'avis remise au seul patient inscrit ; table fermée : le cabinet ne peut pas la lire
create table if not exists public.queue_review_keys (
  queue_entry_id uuid primary key references public.queue_entries(id) on delete cascade,
  secret         uuid not null default gen_random_uuid()
);
alter table public.queue_review_keys enable row level security;
revoke all on public.queue_review_keys from anon, authenticated;

-- 2. Inscription : la réponse remet la clé d'avis au seul patient inscrit
create or replace function public.queue_join(p_clinic uuid, p_date date, p_name text, p_priority text default 'normale', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; e queue_entries; recent int; st jsonb; k uuid;
begin
  if not _queue_day_ok(p_date) then raise exception 'DATE_INVALID'; end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 60 then raise exception 'NAME_INVALID'; end if;
  if p_priority not in ('normale', 'urgente', 'critique') then raise exception 'PRIORITY_INVALID'; end if;
  if not exists (select 1 from profiles where id = p_clinic and coalesce(is_active, true)) then raise exception 'CLINIC_UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtext(p_clinic::text || p_date::text));
  st := queue_status(p_clinic, p_date);
  if not (st->>'accepting')::boolean then raise exception 'QUEUE_%', upper(st->>'reason'); end if;
  select count(*) into recent from queue_entries where clinic_id = p_clinic and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'RATE_LIMITED'; end if;
  select coalesce(max(number), 0) + 1 into n from queue_entries where clinic_id = p_clinic and queue_date = p_date;
  insert into queue_entries(clinic_id, number, patient_name, status, priority, queue_date, notes)
  values (p_clinic, n, left(trim(p_name), 60), 'waiting', p_priority, p_date, left(nullif(trim(p_note), ''), 120))
  returning * into e;
  insert into queue_review_keys (queue_entry_id) values (e.id) returning secret into k;
  return jsonb_build_object('id', e.id, 'number', e.number, 'created_at', e.created_at, 'secret', k,
    'ahead', (select count(*) from queue_entries where clinic_id = p_clinic and queue_date = p_date
                and status in ('waiting', 'current') and number < n));
end;
$$;

-- 3. Les avis
create table if not exists public.doctor_reviews (
  id             uuid primary key default gen_random_uuid(),
  doctor_id      uuid not null references public.profiles(id) on delete cascade,
  source         text not null check (source in ('queue', 'appointment')),
  queue_entry_id uuid unique references public.queue_entries(id) on delete set null,
  appointment_id uuid unique references public.appointments(id) on delete set null,
  visit_date     date not null,
  rating         smallint not null check (rating between 1 and 5),
  tags           text[] not null default '{}',
  comment        text check (length(comment) <= 600),
  comment_status text not null default 'none' check (comment_status in ('none', 'pending', 'published', 'rejected')),
  author_label   text not null,
  wait_minutes   int check (wait_minutes between 0 and 720),
  hidden         boolean not null default false,
  hidden_reason  text,
  moderated_by   uuid references auth.users(id),
  moderated_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists doctor_reviews_doctor_idx on public.doctor_reviews (doctor_id, created_at desc);
alter table public.doctor_reviews enable row level security;
revoke all on public.doctor_reviews from anon, authenticated;

-- Libellés autorisés (les textes affichés sont gérés par les pages)
create or replace function public._review_tags_ok(p text[])
returns boolean language sql immutable as $$
  select coalesce(p <@ array['ecoute', 'explications', 'ponctualite', 'accueil', 'cabinet', 'confiance',
                             'attente', 'explications_insuffisantes', 'accueil_ameliorer', 'tarif_flou', 'rapidite'], true)
     and coalesce(array_length(p, 1), 0) <= 6
$$;

-- Retrouve le passage à partir de la preuve détenue par le patient
create or replace function public._review_visit(p_kind text, p_ref text, p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q queue_entries; a appointments;
begin
  if p_kind = 'queue' then
    begin
      select qe.* into q from queue_entries qe join queue_review_keys k on k.queue_entry_id = qe.id
       where qe.id = p_ref::uuid and k.secret = p_secret::uuid;
    exception when others then return null;
    end;
    if q.id is null then return null; end if;
    return jsonb_build_object('doctor_id', q.clinic_id, 'visit_date', q.queue_date, 'name', q.patient_name,
      'done', q.status = 'done', 'ended_at', coalesce(q.done_at, q.created_at),
      'wait', case when q.called_at is not null then greatest(0, least(720, round(extract(epoch from (q.called_at - q.created_at)) / 60)))::int end,
      'consult_minutes', case when q.called_at is not null and q.done_at is not null then round(extract(epoch from (q.done_at - q.called_at)) / 60)::int end,
      'queue_entry_id', q.id);
  elsif p_kind = 'appointment' then
    select * into a from appointments where ticket_token = p_secret and coalesce(p_secret, '') <> '';
    if a.id is null then return null; end if;
    return jsonb_build_object('doctor_id', a.doctor_id, 'visit_date', a.requested_date, 'name', a.patient_name,
      'done', a.status = 'completed', 'ended_at', coalesce(a.updated_at, a.requested_date::timestamptz),
      'wait', null, 'appointment_id', a.id);
  end if;
  return null;
end;
$$;

-- Ce que la page affiche avant l'avis
create or replace function public.review_context(p_kind text, p_ref text, p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; d profiles; reviewed boolean;
begin
  v := _review_visit(p_kind, p_ref, p_secret);
  if v is null then return jsonb_build_object('eligible', false, 'reason', 'unknown'); end if;
  select * into d from profiles where id = (v->>'doctor_id')::uuid;
  reviewed := exists (select 1 from doctor_reviews r where r.queue_entry_id = (v->>'queue_entry_id')::uuid or r.appointment_id = (v->>'appointment_id')::uuid);
  return jsonb_build_object(
    'eligible', (v->>'done')::boolean and not reviewed and (v->>'ended_at')::timestamptz > now() - interval '14 days',
    'reason', case when reviewed then 'already' when not (v->>'done')::boolean then 'not_done'
                   when (v->>'ended_at')::timestamptz <= now() - interval '14 days' then 'expired' end,
    'doctor_name', case when d.is_clinic and d.clinic_name is not null then d.clinic_name
                        else 'Dr ' || regexp_replace(coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), d.full_name, ''), '^[Dd]r\.?\s*', '') end,
    'specialty', d.specialty, 'visit_date', v->>'visit_date', 'wait_minutes', (v->>'wait')::int,
    'author_label', _mask_name(v->>'name'));
end;
$$;

-- Dépôt de l'avis
create or replace function public.review_submit(p_kind text, p_ref text, p_secret text, p_rating int,
                                                p_tags text[] default '{}', p_comment text default null, p_anonymous boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; c jsonb; txt text := nullif(trim(regexp_replace(coalesce(p_comment, ''), '\s+', ' ', 'g')), '');
        suspicious text; burst int;
begin
  c := review_context(p_kind, p_ref, p_secret);
  if not (c->>'eligible')::boolean then raise exception 'REVIEW_%', upper(coalesce(c->>'reason', 'unknown')); end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'RATING_INVALID'; end if;
  if not _review_tags_ok(p_tags) then raise exception 'TAGS_INVALID'; end if;
  if length(txt) > 600 then raise exception 'COMMENT_TOO_LONG'; end if;
  v := _review_visit(p_kind, p_ref, p_secret);
  -- Garde-fous contre les avis de complaisance : consultation éclair ou avis en rafale.
  -- L'avis est conservé mais mis de côté jusqu'à vérification par l'équipe.
  select count(*) into burst from doctor_reviews where doctor_id = (v->>'doctor_id')::uuid and created_at > now() - interval '30 minutes';
  suspicious := case when p_kind = 'queue' and coalesce((v->>'consult_minutes')::int, 0) < 2 then 'Vérification automatique : consultation de moins de 2 minutes'
                     when burst >= 5 then 'Vérification automatique : nombreux avis en peu de temps' end;
  insert into doctor_reviews (doctor_id, source, queue_entry_id, appointment_id, visit_date, rating, tags, comment, comment_status, author_label, wait_minutes, hidden, hidden_reason)
  values ((v->>'doctor_id')::uuid, p_kind, (v->>'queue_entry_id')::uuid, (v->>'appointment_id')::uuid, (v->>'visit_date')::date,
          p_rating, coalesce(p_tags, '{}'), txt, case when txt is null then 'none' else 'pending' end,
          case when p_anonymous or c->>'author_label' is null then 'Patient vérifié' else c->>'author_label' end,
          (v->>'wait')::int, suspicious is not null, suspicious);
  return jsonb_build_object('ok', true, 'comment_pending', txt is not null);
end;
$$;

-- Résumé public d'un médecin (annuaire, page publique)
create or replace function public.doctor_review_summary(p_doctor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select * from doctor_reviews where doctor_id = p_doctor and not hidden),
  w as (select extract(epoch from (called_at - created_at)) / 60 as m from queue_entries
         where clinic_id = p_doctor and called_at is not null and created_at > now() - interval '90 days'
           and called_at >= created_at and called_at - created_at < interval '12 hours')
  select jsonb_build_object(
    'count', (select count(*) from r),
    'rating', case when (select count(*) from r) >= 3 then round((select avg(rating) from r)::numeric, 1) end,
    'tags', case when (select count(*) from r) >= 3 then (select coalesce(jsonb_agg(jsonb_build_object('tag', t, 'n', n) order by n desc), '[]')
               from (select t, count(*) n from r, unnest(r.tags) t
                      where t in ('ecoute', 'explications', 'ponctualite', 'accueil', 'cabinet', 'confiance', 'rapidite')
                      group by t order by n desc limit 3) x) end,
    'wait_median', case when (select count(*) from w) >= 10 then round((select percentile_cont(0.5) within group (order by m) from w)::numeric) end,
    'wait_samples', (select count(*) from w))
$$;

-- Résumés de plusieurs médecins en un appel (cartes de l'annuaire)
create or replace function public.doctor_review_summaries(p_doctors uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(d, doctor_review_summary(d)), '{}') from unnest(p_doctors[1:60]) d
$$;

-- Commentaires publiés d'un médecin
create or replace function public.doctor_reviews_public(p_doctor uuid, p_limit int default 10, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
    select rating, tags, comment, author_label, to_char(visit_date, 'YYYY-MM') as visit_month, source
      from doctor_reviews
     where doctor_id = p_doctor and not hidden and comment_status = 'published'
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 10), 1), 30) offset greatest(coalesce(p_offset, 0), 0)) x
$$;

-- Le médecin voit ses avis (commentaires publiés ou non, sans pouvoir les modifier)
create or replace function public.my_reviews()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('summary', doctor_review_summary(auth.uid()),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, rating, tags, case when comment_status = 'published' then comment end as comment, comment_status,
             author_label, visit_date, wait_minutes, source, created_at
        from doctor_reviews where doctor_id = auth.uid() and not hidden order by created_at desc limit 200) x), '[]'))
$$;

-- Modération (équipe Docline)
create or replace function public.reviews_moderation(p_status text default 'pending', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (symphony_can('doctors.edit') or symphony_can('doctors.view')) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id, r.rating, r.tags, r.comment, r.comment_status, r.author_label, r.visit_date, r.wait_minutes, r.source,
           r.hidden, r.hidden_reason, r.created_at, r.doctor_id,
           coalesce(p.clinic_name, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.full_name) as doctor_name
      from doctor_reviews r join profiles p on p.id = r.doctor_id
     where case p_status when 'pending' then r.comment_status = 'pending' and not r.hidden
                         when 'hidden' then r.hidden
                         else true end
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]');
end;
$$;

create or replace function public.review_moderate(p_id uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('doctors.edit') then raise exception 'FORBIDDEN'; end if;
  if p_action = 'publish' then
    update doctor_reviews set comment_status = 'published', moderated_by = auth.uid(), moderated_at = now() where id = p_id and comment is not null;
  elsif p_action = 'reject' then
    update doctor_reviews set comment_status = 'rejected', moderated_by = auth.uid(), moderated_at = now() where id = p_id and comment is not null;
  elsif p_action = 'hide' then
    if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
    update doctor_reviews set hidden = true, hidden_reason = p_reason, moderated_by = auth.uid(), moderated_at = now() where id = p_id;
  elsif p_action = 'restore' then
    update doctor_reviews set hidden = false, hidden_reason = null, moderated_by = auth.uid(), moderated_at = now() where id = p_id;
  else
    raise exception 'BAD_ACTION';
  end if;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['_review_visit(text,text,text)', '_review_tags_ok(text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
  foreach f in array array['review_context(text,text,text)', 'review_submit(text,text,text,int,text[],text,boolean)',
                           'doctor_review_summary(uuid)', 'doctor_review_summaries(uuid[])', 'doctor_reviews_public(uuid,int,int)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
  foreach f in array array['my_reviews()', 'reviews_moderation(text,int)', 'review_moderate(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
