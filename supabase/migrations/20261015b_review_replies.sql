-- ============================================================
-- Avis patients : espace du médecin (2026-10-15)
--  * Le médecin voit ses avis et ses indicateurs : répartition des notes,
--    points forts, points à améliorer (visibles de lui seul), attente mesurée.
--  * Il peut répondre publiquement à un avis ; la réponse est relue par
--    l'équipe Docline avant publication, comme les commentaires des patients.
--  * Il ne peut ni modifier ni supprimer un avis.
-- ============================================================
alter table public.doctor_reviews add column if not exists reply text check (length(reply) <= 600);
alter table public.doctor_reviews add column if not exists reply_status text not null default 'none'
  check (reply_status in ('none', 'pending', 'published', 'rejected'));
alter table public.doctor_reviews add column if not exists reply_at timestamptz;

-- Réponse du médecin (texte vide = retirer la réponse)
create or replace function public.review_reply(p_id uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare txt text := nullif(trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), '');
begin
  if length(txt) > 600 then raise exception 'REPLY_TOO_LONG'; end if;
  update doctor_reviews
     set reply = txt, reply_status = case when txt is null then 'none' else 'pending' end, reply_at = case when txt is null then null else now() end
   where id = p_id and doctor_id = auth.uid() and not hidden;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

-- Espace du médecin : avis et indicateurs
create or replace function public.my_reviews()
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select * from doctor_reviews where doctor_id = auth.uid() and not hidden),
  w as (select extract(epoch from (called_at - created_at)) / 60 as m, created_at from queue_entries
         where clinic_id = auth.uid() and called_at is not null and called_at >= created_at
           and called_at - created_at < interval '12 hours' and created_at > now() - interval '90 days')
  select jsonb_build_object(
    'summary', doctor_review_summary(auth.uid()),
    'count', (select count(*) from r),
    'average', (select round(avg(rating)::numeric, 1) from r),
    'last30', (select count(*) from r where created_at > now() - interval '30 days'),
    'distribution', (select jsonb_object_agg(s, (select count(*) from r where rating = s)) from generate_series(1, 5) s),
    'tags', (select coalesce(jsonb_object_agg(t, n), '{}') from (select t, count(*) n from r, unnest(r.tags) t group by t) x),
    'wait_30', (select round(percentile_cont(0.5) within group (order by m)::numeric) from w where created_at > now() - interval '30 days'),
    'wait_30_samples', (select count(*) from w where created_at > now() - interval '30 days'),
    'wait_90', (select round(percentile_cont(0.5) within group (order by m)::numeric) from w),
    'wait_90_samples', (select count(*) from w),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id, rating, tags, case when comment_status = 'published' then comment end as comment, comment_status,
             author_label, visit_date, wait_minutes, source, created_at, reply, reply_status, reply_at
        from r order by created_at desc limit 300) x), '[]'))
$$;

-- Commentaires publics : avec la réponse publiée du médecin
create or replace function public.doctor_reviews_public(p_doctor uuid, p_limit int default 10, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
    select rating, tags, comment, author_label, to_char(visit_date, 'YYYY-MM') as visit_month, source,
           case when reply_status = 'published' then reply end as reply
      from doctor_reviews
     where doctor_id = p_doctor and not hidden and comment_status = 'published'
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 10), 1), 30) offset greatest(coalesce(p_offset, 0), 0)) x
$$;

-- Modération : commentaires et réponses à relire
create or replace function public.reviews_moderation(p_status text default 'pending', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (symphony_can('doctors.edit') or symphony_can('doctors.view')) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id, r.rating, r.tags, r.comment, r.comment_status, r.author_label, r.visit_date, r.wait_minutes, r.source,
           r.hidden, r.hidden_reason, r.created_at, r.doctor_id, r.reply, r.reply_status, r.reply_at,
           coalesce(p.clinic_name, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.full_name) as doctor_name
      from doctor_reviews r join profiles p on p.id = r.doctor_id
     where case p_status when 'pending' then (r.comment_status = 'pending' or r.reply_status = 'pending') and not r.hidden
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
  elsif p_action = 'reply_publish' then
    update doctor_reviews set reply_status = 'published', moderated_by = auth.uid(), moderated_at = now() where id = p_id and reply is not null;
  elsif p_action = 'reply_reject' then
    update doctor_reviews set reply_status = 'rejected', moderated_by = auth.uid(), moderated_at = now() where id = p_id and reply is not null;
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

revoke all on function public.review_reply(uuid, text) from public, anon;
grant execute on function public.review_reply(uuid, text) to authenticated;
alter function public.review_reply(uuid, text) owner to postgres;
alter function public.my_reviews() owner to postgres;
alter function public.doctor_reviews_public(uuid, int, int) owner to postgres;
alter function public.reviews_moderation(text, int) owner to postgres;
alter function public.review_moderate(uuid, text, text) owner to postgres;
