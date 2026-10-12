-- ============================================================
-- Interactions : libellé de niveau d'origine (2026-10-13)
-- Certaines lignes du Thésaurus combinent plusieurs niveaux selon la
-- situation (ex. « CI - PE » selon la dose). Le niveau retenu pour
-- l'alerte est le plus grave ; le libellé d'origine est conservé et
-- affiché à la pharmacienne, la conduite à tenir détaille les cas.
-- ============================================================
alter table public.drug_interactions add column if not exists level_label text;

-- La liste de l'écran de validation renvoie aussi ce libellé
create or replace function public.pv_interactions(p_q text default null, p_status text default null, p_level text default null,
                                                  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_q text := pv_fold(p_q); res jsonb;
begin
  if not pv_can_view() then raise exception 'FORBIDDEN'; end if;
  with f as (
    select i.id, i.level, i.level_label, i.mechanism, i.conduct, i.status, i.reviewed_at, i.created_at,
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

-- Une seule alerte par paire de médicaments : la plus grave (une règle précise
-- l'emporte sur la règle générale de la classe, ex. CI plutôt que « à prendre en compte »)
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
    select distinct on (least(h.da, h.db), greatest(h.da, h.db))
           least(h.da, h.db) as a, greatest(h.da, h.db) as b,
           case when h.da < h.db then h.va else h.vb end as sa_id,
           case when h.da < h.db then h.vb else h.va end as sb_id,
           h.level, h.mechanism, h.conduct, h.source_id, h.ok
      from hits h
     order by least(h.da, h.db), greatest(h.da, h.db), h.ok desc,
              case h.level when 'contre_indication' then 1 when 'association_deconseillee' then 2
                           when 'precaution_emploi' then 3 else 4 end,
              (h.va <> h.vb) desc
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
