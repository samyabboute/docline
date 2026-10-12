-- ============================================================
-- Interactions médicamenteuses : socle technique (2026-10-13)
--
-- Chaîne : médicament (drugs) -> DCI -> molécules (dci_components)
--          -> substance du référentiel (component_substance_map, validé
--             par la pharmacienne) -> classes -> interactions (drug_interactions).
--
-- Garde-fous :
--  * Aucune alerte n'est visible des médecins tant que l'interrupteur
--    interaction_settings.live est éteint.
--  * L'interrupteur ne peut s'allumer que si la source a un droit de
--    réutilisation confirmé et qu'au moins une interaction est validée.
--  * Seules les lignes validées par la pharmacienne servent aux médecins.
--    Le validateur est toujours l'utilisateur connecté (auth.uid()),
--    jamais une valeur envoyée par le navigateur.
--  * Aucune écriture directe depuis le navigateur : tout passe par des
--    fonctions contrôlées et journalisées.
-- ============================================================

-- 1. Molécules de chaque DCI de la nomenclature (découpage automatique)
create table if not exists public.dci_components (
  dci        text not null,
  component  text not null,
  position   int  not null default 1,
  primary key (dci, component)
);
create index if not exists dci_components_component_idx on public.dci_components (component);

-- 2. Sources de référence (ex. Thésaurus ANSM, version du 15/09/2023)
create table if not exists public.interaction_sources (
  id            serial primary key,
  label         text not null,
  version_label text,
  published_on  date,
  url           text,
  reuse_status  text not null default 'pending' check (reuse_status in ('pending', 'confirmed', 'refused')),
  reuse_note    text,
  created_at    timestamptz not null default now()
);

-- 3. Substances et classes du référentiel
create table if not exists public.interaction_substances (
  id         serial primary key,
  key        text not null unique,          -- minuscules sans accents
  label      text not null,                 -- libellé de la source
  kind       text not null default 'substance' check (kind in ('substance', 'class')),
  source_id  int references public.interaction_sources(id)
);
create table if not exists public.interaction_class_members (
  class_id     int not null references public.interaction_substances(id) on delete cascade,
  substance_id int not null references public.interaction_substances(id) on delete cascade,
  primary key (class_id, substance_id)
);
create index if not exists interaction_class_members_sub_idx on public.interaction_class_members (substance_id);

-- 4. Rattachement molécule de la nomenclature -> substance du référentiel
create table if not exists public.component_substance_map (
  component    text not null,
  substance_id int  not null references public.interaction_substances(id) on delete cascade,
  origin       text not null default 'auto' check (origin in ('auto', 'manual')),
  score        real,
  status       text not null default 'proposed' check (status in ('proposed', 'validated', 'rejected')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  primary key (component, substance_id)
);
create index if not exists component_substance_map_sub_idx on public.component_substance_map (substance_id);

-- 5. Interactions (paire non ordonnée : a_id < b_id)
create table if not exists public.drug_interactions (
  id          bigint generated always as identity primary key,
  a_id        int  not null references public.interaction_substances(id) on delete cascade,
  b_id        int  not null references public.interaction_substances(id) on delete cascade,
  level       text not null check (level in ('contre_indication', 'association_deconseillee', 'precaution_emploi', 'a_prendre_en_compte')),
  mechanism   text,
  conduct     text,
  source_id   int  not null references public.interaction_sources(id),
  status      text not null default 'draft' check (status in ('draft', 'validated', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  check (a_id < b_id),
  unique (a_id, b_id, level, source_id)
);
create index if not exists drug_interactions_b_idx on public.drug_interactions (b_id);

-- 6. Interrupteur général (une seule ligne) et journal des validations
create table if not exists public.interaction_settings (
  id          boolean primary key default true check (id),
  live        boolean not null default false,
  switched_by uuid references auth.users(id),
  switched_at timestamptz
);
insert into public.interaction_settings (id, live) values (true, false) on conflict (id) do nothing;

create table if not exists public.interaction_review_log (
  id          bigint generated always as identity primary key,
  actor       uuid,
  actor_email text,
  action      text not null,
  target      text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- Lecture réservée à l'équipe autorisée ; aucune écriture directe
do $$ declare t text; begin
  foreach t in array array['dci_components', 'interaction_sources', 'interaction_substances', 'interaction_class_members',
                           'component_substance_map', 'drug_interactions', 'interaction_settings', 'interaction_review_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (symphony_can(''pharmacovigilance.view'') or symphony_can(''pharmacovigilance.validate''))', t || '_staff_read', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── Moteur : vérifie une ordonnance (liste d'identifiants de public.drugs) ──
-- Renvoie les associations à signaler, de la plus grave à la moins grave.
-- level 'doublon' : la même molécule figure dans deux lignes (ex. deux paracétamols).
create or replace function public.prescription_check(p_drug_ids bigint[])
returns table (drug_a bigint, drug_b bigint, substance_a text, substance_b text, level text,
               mechanism text, conduct text, source text, source_version text, reviewed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_reviewer boolean := symphony_can('pharmacovigilance.validate');
  v_live     boolean := coalesce((select s.live from interaction_settings s where s.id), false);
begin
  if auth.uid() is null or p_drug_ids is null then return; end if;
  if not v_live and not v_reviewer then return; end if;

  return query
  with d as (
    select x.id, x.dci from drugs x where x.id = any(p_drug_ids[1:30])
  ),
  comp as (
    select d.id as drug_id, c.component from d join dci_components c on c.dci = d.dci
  ),
  sub as (
    select comp.drug_id, m.substance_id, (m.status = 'validated') as ok
      from comp join component_substance_map m on m.component = comp.component
     where m.status = 'validated' or (v_reviewer and m.status = 'proposed')
  ),
  expanded as (
    select sub.drug_id, sub.substance_id, sub.substance_id as via, sub.ok from sub
    union
    select sub.drug_id, cm.class_id, sub.substance_id, sub.ok
      from sub join interaction_class_members cm on cm.substance_id = sub.substance_id
  ),
  hits as (
    select x.drug_id as da, y.drug_id as db, x.via as va, y.via as vb, i.level, i.mechanism, i.conduct, i.source_id,
           (x.ok and y.ok and i.status = 'validated') as ok
      from expanded x
      join expanded y on x.drug_id <> y.drug_id
      join drug_interactions i on i.a_id = x.substance_id and i.b_id = y.substance_id
     where i.status = 'validated' or (v_reviewer and i.status = 'draft')
  ),
  dup as (
    select a.drug_id as da, b.drug_id as db, a.component
      from comp a join comp b on a.component = b.component and a.drug_id < b.drug_id
     where a.component not in ('sodium', 'glucose', 'eau')
  ),
  found_rows as (
    select distinct on (least(h.da, h.db), greatest(h.da, h.db), h.level, h.va, h.vb)
           least(h.da, h.db) as a, greatest(h.da, h.db) as b,
           case when h.da < h.db then h.va else h.vb end as sa_id,
           case when h.da < h.db then h.vb else h.va end as sb_id,
           h.level, h.mechanism, h.conduct, h.source_id, h.ok
      from hits h
     order by least(h.da, h.db), greatest(h.da, h.db), h.level, h.va, h.vb, h.ok desc
  ),
  all_rows as (
    select f.a, f.b, sa.label as la, sb.label as lb, f.level, f.mechanism, f.conduct, src.label as src, src.version_label as ver, f.ok
      from found_rows f
      join interaction_substances sa on sa.id = f.sa_id
      join interaction_substances sb on sb.id = f.sb_id
      join interaction_sources src on src.id = f.source_id
    union all
    select dup.da, dup.db, dup.component, dup.component, 'doublon', null, null, null, null, true from dup
  )
  select r.a, r.b, r.la, r.lb, r.level, r.mechanism, r.conduct, r.src, r.ver, r.ok
    from all_rows r
   order by case r.level when 'contre_indication' then 1 when 'association_deconseillee' then 2
                         when 'doublon' then 3 when 'precaution_emploi' then 4 else 5 end, r.a, r.b;
end;
$$;

-- ── Fonctions de la pharmacienne (permission pharmacovigilance.validate) ──
create or replace function public.pv_log(p_action text, p_target text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into interaction_review_log (actor, actor_email, action, target, detail)
  values (auth.uid(), auth.email(), p_action, p_target, p_detail);
$$;

-- Propose automatiquement les rattachements molécule -> substance (nom identique ou très proche)
create or replace function public.pv_auto_map(p_min_score real default 0.8)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  insert into component_substance_map (component, substance_id, origin, score, status)
  select c.component, s.id, 'auto', similarity(c.component, s.key), 'proposed'
    from (select distinct component from dci_components) c
    join interaction_substances s on s.kind = 'substance' and (s.key = c.component or similarity(c.component, s.key) >= p_min_score)
  on conflict (component, substance_id) do nothing;
  get diagnostics n = row_count;
  perform pv_log('auto_map', null, jsonb_build_object('proposed', n, 'min_score', p_min_score));
  return n;
end;
$$;

create or replace function public.pv_review_mapping(p_component text, p_substance_id int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('validated', 'rejected', 'proposed') then raise exception 'BAD_STATUS'; end if;
  insert into component_substance_map (component, substance_id, origin, status, reviewed_by, reviewed_at)
  values (p_component, p_substance_id, 'manual', p_status, auth.uid(), now())
  on conflict (component, substance_id) do update
    set status = excluded.status, reviewed_by = auth.uid(), reviewed_at = now();
  perform pv_log('mapping', p_component || ' -> ' || p_substance_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.pv_review_interaction(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('validated', 'rejected', 'draft') then raise exception 'BAD_STATUS'; end if;
  update drug_interactions set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pv_log('interaction', p_id::text, jsonb_build_object('status', p_status));
end;
$$;

-- Droit de réutilisation d'une source : décision de la direction uniquement
create or replace function public.pv_set_source_reuse(p_source_id int, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_is_owner() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending', 'confirmed', 'refused') then raise exception 'BAD_STATUS'; end if;
  update interaction_sources set reuse_status = p_status, reuse_note = p_note where id = p_source_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pv_log('source_reuse', p_source_id::text, jsonb_build_object('status', p_status, 'note', p_note));
end;
$$;

-- Mise en service des alertes pour les médecins
create or replace function public.pv_set_live(p_live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if p_live and not exists (
       select 1 from drug_interactions i join interaction_sources s on s.id = i.source_id
        where i.status = 'validated' and s.reuse_status = 'confirmed') then
    raise exception 'NOT_READY' using hint = 'Il faut une source au droit de réutilisation confirmé et au moins une interaction validée.';
  end if;
  update interaction_settings set live = p_live, switched_by = auth.uid(), switched_at = now() where id;
  perform pv_log('live', null, jsonb_build_object('live', p_live));
end;
$$;

-- Tableau de bord de la validation
create or replace function public.pv_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (symphony_can('pharmacovigilance.view') or symphony_can('pharmacovigilance.validate')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'live',                  (select live from interaction_settings where id),
    'components',            (select count(distinct component) from dci_components),
    'components_validated',  (select count(distinct component) from component_substance_map where status = 'validated'),
    'mappings_proposed',     (select count(*) from component_substance_map where status = 'proposed'),
    'substances',            (select count(*) from interaction_substances),
    'interactions_draft',    (select count(*) from drug_interactions where status = 'draft'),
    'interactions_validated',(select count(*) from drug_interactions where status = 'validated'),
    'sources',               (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'version', version_label, 'reuse', reuse_status)), '[]') from interaction_sources)
  );
end;
$$;

do $$ declare f text; begin
  foreach f in array array['prescription_check(bigint[])', 'pv_log(text,text,jsonb)', 'pv_auto_map(real)',
                           'pv_review_mapping(text,int,text)', 'pv_review_interaction(bigint,text)',
                           'pv_set_source_reuse(int,text,text)', 'pv_set_live(boolean)', 'pv_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
revoke all on function public.pv_log(text, text, jsonb) from authenticated;
grant execute on function public.prescription_check(bigint[]) to authenticated;
grant execute on function public.pv_auto_map(real) to authenticated;
grant execute on function public.pv_review_mapping(text, int, text) to authenticated;
grant execute on function public.pv_review_interaction(bigint, text) to authenticated;
grant execute on function public.pv_set_source_reuse(int, text, text) to authenticated;
grant execute on function public.pv_set_live(boolean) to authenticated;
grant execute on function public.pv_overview() to authenticated;
