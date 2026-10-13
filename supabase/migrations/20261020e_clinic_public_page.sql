-- Page publique d'un établissement : docline.health/clinique/<adresse>
-- Le titulaire (ou un membre autorisé à gérer les réglages) la publie ; offre Institution requise.
-- Seuls les médecins déjà publics (KYC validé, profil actif) y apparaissent.

create table if not exists public.org_public_settings (
  org_id         uuid primary key references public.profiles(id) on delete cascade,
  slug           text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  published      boolean not null default false,
  description    text check (length(description) <= 1200),
  hidden_doctors uuid[] not null default '{}',
  show_queue     boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table public.org_public_settings enable row level security;
revoke all on public.org_public_settings from public, anon, authenticated;

create or replace function public._slugify(p text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(p, ''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public._org_plan_ok(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions s where s.user_id = p_org and s.plan = 'clinic' and s.status = 'active'
                   and (s.expires_at is null or s.expires_at > now()))
$$;
revoke all on function public._org_plan_ok(uuid) from public, anon, authenticated;

-- Réglages (gestion)
create or replace function public.org_public_get(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s org_public_settings; o profiles;
begin
  if not org_can(p_org, 'settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into s from org_public_settings where org_id = p_org;
  select * into o from profiles where id = p_org;
  return jsonb_build_object(
    'plan_ok', _org_plan_ok(p_org),
    'published', coalesce(s.published, false),
    'slug', coalesce(s.slug, nullif(_slugify(coalesce(nullif(trim(o.clinic_name), ''), 'cabinet ' || coalesce(o.last_name, ''))), '')),
    'description', coalesce(s.description, o.bio),
    'hidden_doctors', coalesce(to_jsonb(s.hidden_doctors), '[]'),
    'show_queue', coalesce(s.show_queue, true),
    'profile', jsonb_build_object('name', coalesce(nullif(trim(o.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(o.last_name), ''), o.full_name)),
                                  'address', o.address, 'city', o.city, 'wilaya', o.wilaya, 'phone', o.phone_public),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', p.id,
                 'name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.full_name), 'specialty', p.specialty,
                 'public', coalesce(p.is_public, false) and coalesce(p.is_active, true)))
               from profiles p where p.id = any(_org_doctor_ids(p_org)) and not coalesce(p.is_clinic, false)), '[]'));
end;
$$;

create or replace function public.org_public_save(p_org uuid, p_published boolean, p_slug text, p_description text, p_hidden uuid[], p_show_queue boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_slug text := _slugify(p_slug);
begin
  if not org_can(p_org, 'settings.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_published and not _org_plan_ok(p_org) then raise exception 'PLAN_REQUIRED'; end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) < 3 or length(v_slug) > 60 then raise exception 'SLUG_INVALID'; end if;
  if exists (select 1 from org_public_settings where slug = v_slug and org_id <> p_org) then raise exception 'SLUG_TAKEN'; end if;
  insert into org_public_settings (org_id, slug, published, description, hidden_doctors, show_queue, updated_at)
  values (p_org, v_slug, coalesce(p_published, false), nullif(trim(p_description), ''), coalesce(p_hidden, '{}'), coalesce(p_show_queue, true), now())
  on conflict (org_id) do update set slug = excluded.slug, published = excluded.published, description = excluded.description,
     hidden_doctors = excluded.hidden_doctors, show_queue = excluded.show_queue, updated_at = now();
  return jsonb_build_object('slug', v_slug, 'published', coalesce(p_published, false));
end;
$$;

-- Lecture publique de la page
create or replace function public.clinic_public(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s org_public_settings; o profiles; docs uuid[];
begin
  select * into s from org_public_settings where slug = lower(p_slug) and published;
  if s.org_id is null or not _org_plan_ok(s.org_id) then return null; end if;
  select * into o from profiles where id = s.org_id and coalesce(is_active, true);
  if o.id is null then return null; end if;
  docs := array(select x from unnest(_org_doctor_ids(s.org_id)) x where not (x = any(s.hidden_doctors)));
  return jsonb_build_object(
    'id', o.id, 'slug', s.slug,
    'name', coalesce(nullif(trim(o.clinic_name), ''), 'Cabinet du Dr ' || coalesce(nullif(trim(o.last_name), ''), o.full_name)),
    'description', coalesce(s.description, o.bio),
    'address', o.address, 'city', o.city, 'wilaya', o.wilaya, 'phone', o.phone_public, 'avatar_url', o.avatar_url,
    'show_queue', s.show_queue,
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', sv.name, 'color', sv.color) order by sv.sort_order, sv.name)
                  from org_services sv where sv.org_id = s.org_id and sv.active
                   and exists (select 1 from org_members m where m.service_id = sv.id and m.role = 'doctor' and m.status = 'active' and m.user_id = any(docs))), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.full_name),
        'specialty', p.specialty, 'avatar_url', p.avatar_url, 'slug', p.slug, 'accepts_rdv', coalesce(p.accepts_rdv, false),
        'price', p.consultation_price, 'languages', p.languages,
        'service', (select jsonb_build_object('name', sv.name, 'color', sv.color) from org_members m join org_services sv on sv.id = m.service_id
                     where m.org_id = s.org_id and m.user_id = p.id and sv.active limit 1),
        'days', (select coalesce(jsonb_agg(a.day_of_week order by a.day_of_week), '[]') from doctor_availability a where a.doctor_id = p.id and a.is_active))
        order by case when p.id = s.org_id then 0 else 1 end, p.last_name)
      from profiles p where p.id = any(docs) and not coalesce(p.is_clinic, false) and p.is_public and coalesce(p.is_active, true)), '[]'),
    -- horaires de l'établissement : plage la plus large des médecins publiés, jour par jour (0 = dimanche)
    'hours', coalesce((select jsonb_agg(jsonb_build_object('dow', h.dow, 'from', to_char(h.f, 'HH24:MI'), 'to', to_char(h.t, 'HH24:MI')) order by h.dow)
      from (select a.day_of_week as dow, min(a.start_time) f, max(a.end_time) t from doctor_availability a
              join profiles p on p.id = a.doctor_id and p.is_public
             where a.doctor_id = any(docs) and a.is_active group by a.day_of_week) h), '[]'));
end;
$$;

do $$ declare f text; begin
  foreach f in array array['org_public_get(uuid)', 'org_public_save(uuid,boolean,text,text,uuid[],boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
revoke all on function public.clinic_public(text) from public;
grant execute on function public.clinic_public(text) to anon, authenticated;
alter function public.clinic_public(text) owner to postgres;
