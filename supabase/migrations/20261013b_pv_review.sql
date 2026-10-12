-- ============================================================
-- Interactions médicamenteuses : fonctions de l'écran de validation (2026-10-13)
-- Page Symphony « Interactions » : la pharmacienne rattache les molécules
-- de la nomenclature aux substances du référentiel, saisit et valide les
-- interactions. Lecture : pharmacovigilance.view ou .validate ;
-- écriture : pharmacovigilance.validate ; sources : direction uniquement.
-- ============================================================

create index if not exists drugs_dci_idx on public.drugs (dci);
alter table public.drug_interactions add column if not exists created_by uuid references auth.users(id);
alter table public.drug_interactions add column if not exists created_at timestamptz not null default now();

create or replace function public.pv_can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select symphony_can('pharmacovigilance.view') or symphony_can('pharmacovigilance.validate')
$$;

create or replace function public.pv_fold(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select trim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '\s+', ' ', 'g'))
$$;

-- Molécules de la nomenclature, avec leurs médicaments en vigueur et leurs rattachements
-- p_filter : todo (proposé, à valider), unmapped (aucun rattachement retenu), validated, all
create or replace function public.pv_components(p_q text default null, p_filter text default 'todo',
                                                p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_q text := pv_fold(p_q); res jsonb;
begin
  if not pv_can_view() then raise exception 'FORBIDDEN'; end if;
  with base as (
    select c.component,
           count(distinct d.id) filter (where d.status = 'active') as n_active,
           (array_agg(distinct d.brand) filter (where d.status = 'active'))[1:4] as brands,
           (array_agg(distinct c.dci))[1:3] as dcis
      from dci_components c
      left join drugs d on d.dci = c.dci
     where v_q = '' or c.component like '%' || v_q || '%'
     group by c.component
  ),
  maps as (
    select m.component, jsonb_agg(jsonb_build_object('substance_id', s.id, 'label', s.label, 'kind', s.kind,
             'status', m.status, 'origin', m.origin, 'score', m.score) order by (m.status = 'validated') desc, m.score desc nulls last) as mappings,
           bool_or(m.status = 'validated') as has_valid, bool_or(m.status = 'proposed') as has_prop
      from component_substance_map m join interaction_substances s on s.id = m.substance_id
     group by m.component
  ),
  f as (
    select b.*, coalesce(mp.mappings, '[]'::jsonb) as mappings, coalesce(mp.has_valid, false) as has_valid, coalesce(mp.has_prop, false) as has_prop
      from base b left join maps mp on mp.component = b.component
     where case coalesce(p_filter, 'todo')
             when 'todo' then coalesce(mp.has_prop, false)
             when 'unmapped' then not coalesce(mp.has_valid, false) and not coalesce(mp.has_prop, false)
             when 'validated' then coalesce(mp.has_valid, false)
             else true end
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.n_active desc, x.component)
                        from (select * from f order by n_active desc, component
                               limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb))
    into res;
  return res;
end;
$$;

-- Recherche de substances et classes du référentiel
create or replace function public.pv_substances(p_q text default null, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_q text := pv_fold(p_q);
begin
  if not pv_can_view() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select s.id, s.label, s.kind, s.key,
           (select count(*) from interaction_class_members cm where cm.class_id = s.id) as members,
           (select count(*) from drug_interactions i where i.a_id = s.id or i.b_id = s.id) as interactions
      from interaction_substances s
     where v_q = '' or s.key like '%' || v_q || '%' or similarity(s.key, v_q) > 0.35
     order by (s.key = v_q) desc, (s.key like v_q || '%') desc, similarity(s.key, v_q) desc, s.label
     limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb);
end;
$$;

-- Crée une substance ou une classe (et, pour une classe, ses membres)
create or replace function public.pv_save_substance(p_label text, p_kind text default 'substance',
                                                    p_source_id int default null, p_members int[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; v_key text := pv_fold(p_label);
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if length(v_key) < 2 then raise exception 'LABEL_REQUIRED'; end if;
  if p_kind not in ('substance', 'class') then raise exception 'BAD_KIND'; end if;
  insert into interaction_substances (key, label, kind, source_id)
  values (v_key, trim(p_label), p_kind, p_source_id)
  on conflict (key) do update set label = excluded.label
  returning id into v_id;
  if p_kind = 'class' and p_members is not null then
    insert into interaction_class_members (class_id, substance_id)
    select v_id, m from unnest(p_members) m where m <> v_id
    on conflict do nothing;
  end if;
  perform pv_log('substance', v_id::text, jsonb_build_object('label', p_label, 'kind', p_kind, 'members', p_members));
  return v_id;
end;
$$;

create or replace function public.pv_set_class_member(p_class_id int, p_substance_id int, p_member boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from interaction_substances where id = p_class_id and kind = 'class') then raise exception 'NOT_A_CLASS'; end if;
  if p_member then
    insert into interaction_class_members values (p_class_id, p_substance_id) on conflict do nothing;
  else
    delete from interaction_class_members where class_id = p_class_id and substance_id = p_substance_id;
  end if;
  perform pv_log('class_member', p_class_id || ' / ' || p_substance_id, jsonb_build_object('member', p_member));
end;
$$;

-- Interactions du référentiel
create or replace function public.pv_interactions(p_q text default null, p_status text default null, p_level text default null,
                                                  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_q text := pv_fold(p_q); res jsonb;
begin
  if not pv_can_view() then raise exception 'FORBIDDEN'; end if;
  with f as (
    select i.id, i.level, i.mechanism, i.conduct, i.status, i.reviewed_at, i.created_at,
           a.label as a_label, a.kind as a_kind, b.label as b_label, b.kind as b_kind,
           s.label as source, s.version_label as source_version, s.reuse_status,
           (select u.email from auth.users u where u.id = i.reviewed_by) as reviewer
      from drug_interactions i
      join interaction_substances a on a.id = i.a_id
      join interaction_substances b on b.id = i.b_id
      join interaction_sources s on s.id = i.source_id
     where (v_q = '' or a.key like '%' || v_q || '%' or b.key like '%' || v_q || '%')
       and (p_status is null or i.status = p_status)
       and (p_level is null or i.level = p_level)
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
       select * from f
        order by case status when 'draft' then 0 when 'validated' then 1 else 2 end,
                 case level when 'contre_indication' then 1 when 'association_deconseillee' then 2 when 'precaution_emploi' then 3 else 4 end,
                 a_label, b_label
        limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb))
    into res;
  return res;
end;
$$;

-- Saisie d'une interaction : toujours en brouillon, à valider ensuite
create or replace function public.pv_add_interaction(p_a int, p_b int, p_level text, p_mechanism text, p_conduct text, p_source_id int)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if p_a is null or p_b is null or p_a = p_b then raise exception 'TWO_SUBSTANCES_REQUIRED'; end if;
  if p_level not in ('contre_indication', 'association_deconseillee', 'precaution_emploi', 'a_prendre_en_compte') then raise exception 'BAD_LEVEL'; end if;
  if not exists (select 1 from interaction_sources where id = p_source_id) then raise exception 'SOURCE_REQUIRED'; end if;
  insert into drug_interactions (a_id, b_id, level, mechanism, conduct, source_id, status, created_by)
  values (least(p_a, p_b), greatest(p_a, p_b), p_level, nullif(trim(p_mechanism), ''), nullif(trim(p_conduct), ''), p_source_id, 'draft', auth.uid())
  on conflict (a_id, b_id, level, source_id) do update
    set mechanism = excluded.mechanism, conduct = excluded.conduct, status = 'draft', reviewed_by = null, reviewed_at = null
  returning id into v_id;
  perform pv_log('interaction_saved', v_id::text, jsonb_build_object('a', p_a, 'b', p_b, 'level', p_level));
  return v_id;
end;
$$;

-- Ajout d'une source de référence : direction uniquement
create or replace function public.pv_add_source(p_label text, p_version text default null, p_published_on date default null, p_url text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  if not symphony_is_owner() then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_label, ''))) < 3 then raise exception 'LABEL_REQUIRED'; end if;
  insert into interaction_sources (label, version_label, published_on, url)
  values (trim(p_label), nullif(trim(p_version), ''), p_published_on, nullif(trim(p_url), ''))
  returning id into v_id;
  perform pv_log('source_added', v_id::text, jsonb_build_object('label', p_label, 'version', p_version));
  return v_id;
end;
$$;

-- Qui suis-je pour cet écran
create or replace function public.pv_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('view', pv_can_view(), 'validate', symphony_can('pharmacovigilance.validate'), 'owner', symphony_is_owner())
$$;

do $$ declare f text; begin
  foreach f in array array['pv_can_view()', 'pv_components(text,text,int,int)', 'pv_substances(text,int)',
                           'pv_save_substance(text,text,int,int[])', 'pv_set_class_member(int,int,boolean)',
                           'pv_interactions(text,text,text,int,int)', 'pv_add_interaction(int,int,text,text,text,int)',
                           'pv_add_source(text,text,date,text)', 'pv_me()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
