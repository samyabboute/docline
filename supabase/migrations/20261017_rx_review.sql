-- ============================================================
-- Vérification d'ordonnance : ce qui sert au médecin dès aujourd'hui (2026-10-17)
--
-- Actif tout de suite (faits, sans référentiel tiers) :
--  * doublon : la même molécule dans deux lignes (nomenclature) ;
--  * médicament retiré ou non renouvelé dans la nomenclature officielle ;
--  * médicament réservé à l'hôpital (introuvable en officine) ;
--  * traitements en cours : les ordonnances de ce médecin pour ce patient
--    (90 derniers jours) entrent dans la vérification ;
--  * allergies notées dans le dossier (déjà actif).
-- Soumis à la mise en service (référentiel validé par la pharmacienne) :
--  * interactions entre médicaments, allergies à une famille, situations du patient.
-- Habitudes du médecin : ses médicaments fréquents et sa dernière posologie,
-- pour prescrire plus vite.
-- ============================================================

-- 1. Doublons toujours actifs, interactions soumises à la mise en service
create or replace function public.prescription_check(p_drug_ids bigint[])
returns table (drug_a bigint, drug_b bigint, substance_a text, substance_b text, level text,
               mechanism text, conduct text, source text, source_version text, reviewed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_reviewer boolean := symphony_can('pharmacovigilance.validate');
  v_live     boolean := coalesce((select s.live from interaction_settings s where s.id), false);
  v_inter    boolean := v_live or v_reviewer;
begin
  if auth.uid() is null or p_drug_ids is null then return; end if;

  return query
  with d as (
    select x.id, x.dci from drugs x where x.id = any(p_drug_ids[1:40])
  ),
  comp as (
    select d.id as drug_id, c.component from d join dci_components c on c.dci = d.dci
  ),
  sub as (
    select comp.drug_id, m.substance_id, (m.status = 'validated') as ok
      from comp join component_substance_map m on m.component = comp.component
     where v_inter and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
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
    select distinct on (a.drug_id, b.drug_id) a.drug_id as da, b.drug_id as db, a.component
      from comp a join comp b on a.component = b.component and a.drug_id < b.drug_id
     where a.component not in ('sodium', 'glucose', 'eau')
     order by a.drug_id, b.drug_id, a.component
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
                           when 'precaution_emploi' then 3 else 4 end
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

-- La vérification complète ne s'arrête plus quand les interactions sont coupées
create or replace function public.prescription_check_ctx(p_drug_ids bigint[], p_client uuid default null)
returns table (kind text, drug_a bigint, drug_b bigint, substance_a text, substance_b text, level text,
               mechanism text, conduct text, source text, source_version text, reviewed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_reviewer boolean := symphony_can('pharmacovigilance.validate');
  v_live     boolean := coalesce((select s.live from interaction_settings s where s.id), false);
  v_ok_client boolean := p_client is not null and exists (select 1 from clients c where c.id = p_client and c.user_id = auth.uid());
  v_ctx      patient_clinical_context;
  v_conds    text[];
begin
  if auth.uid() is null or p_drug_ids is null then return; end if;

  return query select case when x.level = 'doublon' then 'doublon' else 'interaction' end, x.drug_a, x.drug_b, x.substance_a, x.substance_b,
                      x.level, x.mechanism, x.conduct, x.source, x.source_version, x.reviewed
                 from prescription_check(p_drug_ids) x;

  if not v_ok_client then return; end if;
  select * into v_ctx from patient_clinical_context where client_id = p_client;
  v_conds := _patient_conditions(p_client);

  if v_ctx.client_id is not null and jsonb_array_length(v_ctx.allergens) > 0 then
    return query
    select distinct 'allergie', d.id, null::bigint, a->>'label', c.component, 'contre_indication',
           'Allergie notée dans le dossier du patient : ' || (a->>'label') || '.',
           'Ne pas prescrire ce médicament. Choisir une molécule d''une autre famille.', 'Dossier du patient', null::text, true
      from drugs d
      join dci_components c on c.dci = d.dci
      join jsonb_array_elements(v_ctx.allergens) a on a->>'kind' = 'component' and a->>'key' = c.component
     where d.id = any(p_drug_ids[1:40]);

    return query
    select distinct on (d.id) 'allergie', d.id, null::bigint, a->>'label', d.dci, 'a_prendre_en_compte',
           'Même famille thérapeutique que ' || (a->>'label') || ', noté comme allergène dans le dossier du patient.',
           'Vérifier le risque d''allergie croisée avant de prescrire.', 'Dossier du patient', null::text, true
      from drugs d
      join jsonb_array_elements(v_ctx.allergens) a on a->>'kind' = 'component'
     where d.id = any(p_drug_ids[1:40]) and d.dci_code is not null
       and not exists (select 1 from dci_components c where c.dci = d.dci and c.component = a->>'key')
       and left(d.dci_code, 4) in (select distinct left(x.dci_code, 4) from drugs x join dci_components xc on xc.dci = x.dci
                                    where xc.component = a->>'key' and x.dci_code is not null)
     order by d.id;

    if v_live or v_reviewer then
      return query
      select distinct 'allergie', d.id, null::bigint, a->>'label', c.component, 'contre_indication',
             'Allergie notée dans le dossier du patient : ' || (a->>'label') || '. Ce médicament appartient à cette famille.',
             'Ne pas prescrire ce médicament. Choisir une molécule d''une autre famille.', 'Dossier du patient', null::text,
             bool_and(m.status = 'validated')
        from drugs d
        join dci_components c on c.dci = d.dci
        join component_substance_map m on m.component = c.component and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
        join interaction_class_members cm on cm.substance_id = m.substance_id
        join interaction_substances cl on cl.id = cm.class_id
        join jsonb_array_elements(v_ctx.allergens) a on a->>'kind' = 'class' and a->>'key' = cl.key
       where d.id = any(p_drug_ids[1:40])
         and not exists (select 1 from jsonb_array_elements(v_ctx.allergens) a2 where a2->>'kind' = 'component' and a2->>'key' = c.component)
       group by d.id, a->>'label', c.component;
    end if;
  end if;

  if (v_live or v_reviewer) and coalesce(array_length(v_conds, 1), 0) > 0 then
    return query
    select distinct on (d.id, r.condition) 'situation', d.id, null::bigint, s.label, r.condition, r.level,
           r.message, r.conduct, src.label, src.version_label, (m.status = 'validated' and r.status = 'validated')
      from drugs d
      join dci_components c on c.dci = d.dci
      join component_substance_map m on m.component = c.component and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
      join drug_condition_rules r on r.condition = any(v_conds) and (r.status = 'validated' or (v_reviewer and r.status = 'draft'))
       and (r.substance_id = m.substance_id or r.substance_id in (select cm.class_id from interaction_class_members cm where cm.substance_id = m.substance_id))
      join interaction_substances s on s.id = r.substance_id
      join interaction_sources src on src.id = r.source_id
     where d.id = any(p_drug_ids[1:40])
     order by d.id, r.condition,
              case r.level when 'contre_indication' then 1 when 'association_deconseillee' then 2 when 'precaution_emploi' then 3 else 4 end;
  end if;
end;
$$;

-- 2. Traitements en cours : ordonnances de ce médecin pour ce patient (90 jours)
create or replace function public.patient_current_treatments(p_client uuid, p_exclude uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]') from (
    select distinct on ((li->>'drug_id')::bigint)
           jsonb_build_object('drug_id', (li->>'drug_id')::bigint,
             'label', trim(concat_ws(' ', d.brand, d.dosage)), 'dci', d.dci,
             'date', coalesce(p.due_date, p.created_at::date), 'ordonnance_id', p.id,
             'posologie', coalesce(li->>'quantity', li->>'posologie')) x
      from proposals p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.line_items) = 'array' then p.line_items else '[]'::jsonb end) li
      join drugs d on d.id = (li->>'drug_id')::bigint
     where p.user_id = auth.uid() and p.client_id = p_client and p.project_type = 'ordonnance'
       and (p_exclude is null or p.id <> p_exclude)
       and coalesce(p.due_date, p.created_at::date) > current_date - 90
       and li ? 'drug_id' and (li->>'drug_id') ~ '^\d+$'
       and exists (select 1 from clients c where c.id = p_client and c.user_id = auth.uid())
     order by (li->>'drug_id')::bigint, coalesce(p.due_date, p.created_at::date) desc
  ) y
$$;

-- 3. Vérification de l'ordonnance en cours de rédaction
create or replace function public.prescription_review(p_drug_ids bigint[], p_client uuid default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hist jsonb := '[]'; hist_ids bigint[] := '{}'; new_ids bigint[]; all_ids bigint[]; alerts jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('alerts', '[]', 'history', '[]'); end if;
  new_ids := array(select distinct x from unnest(coalesce(p_drug_ids, '{}')) x where x is not null);
  if p_client is not null then
    hist := patient_current_treatments(p_client, p_exclude);
    hist_ids := array(select (h->>'drug_id')::bigint from jsonb_array_elements(hist) h where not ((h->>'drug_id')::bigint = any(new_ids)));
  end if;
  all_ids := new_ids || hist_ids;
  if cardinality(all_ids) = 0 then return jsonb_build_object('alerts', '[]', 'history', hist); end if;

  select coalesce(jsonb_agg(to_jsonb(k)), '[]') into alerts from (
    -- interactions, doublons, allergies, situations : au moins un médicament de la nouvelle ordonnance
    select c.kind, c.drug_a, c.drug_b, c.substance_a, c.substance_b, c.level, c.mechanism, c.conduct, c.source, c.source_version, c.reviewed
      from prescription_check_ctx(all_ids, p_client) c
     where (c.drug_a = any(new_ids) or c.drug_b = any(new_ids))
       and (c.kind not in ('allergie', 'situation') or c.drug_a = any(new_ids))
    union all
    -- nomenclature officielle : retiré, non renouvelé, réservé à l'hôpital
    select 'nomenclature', d.id, null::bigint, d.brand, d.status,
           case d.status when 'withdrawn' then 'association_deconseillee' when 'not_renewed' then 'precaution_emploi' else 'a_prendre_en_compte' end,
           case d.status
             when 'withdrawn' then 'Retiré de la nomenclature nationale' || coalesce(' le ' || to_char(d.withdrawn_at, 'DD/MM/YYYY'), '') || coalesce(' : ' || lower(d.withdrawal_reason), '') || '.'
             when 'not_renewed' then 'Enregistrement non renouvelé dans la nomenclature nationale : le médicament peut être introuvable en pharmacie.'
             else 'Réservé à l''usage hospitalier : introuvable en officine.' end,
           case d.status when 'active' then 'Prescrire une présentation disponible en officine si le patient doit l''acheter en pharmacie.'
                         else 'Choisir une présentation en vigueur.' end,
           'Nomenclature nationale', (select regexp_replace(label, '^Nomenclature nationale,\s*', '') from drug_catalog_versions order by id desc limit 1), true
      from drugs d
     where d.id = any(new_ids)
       and (d.status <> 'active' or (d.hospital and not d.pharmacy))
  ) k;
  return jsonb_build_object('alerts', alerts, 'history', hist);
end;
$$;

-- 4. Habitudes de prescription du médecin (12 mois) : fréquents et dernière posologie
create or replace function public.my_prescribing_habits()
returns jsonb language sql stable security definer set search_path = public as $$
  with li as (
    select (x->>'drug_id')::bigint as drug_id, coalesce(x->>'quantity', x->>'posologie') as pos,
           nullif(x->>'boites', '')::int as boites, p.created_at
      from proposals p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.line_items) = 'array' then p.line_items else '[]'::jsonb end) x
     where p.user_id = auth.uid() and p.project_type = 'ordonnance' and p.created_at > now() - interval '12 months'
       and x ? 'drug_id' and (x->>'drug_id') ~ '^\d+$'
  ),
  fav as (
    select drug_id, count(*) n from li group by drug_id order by count(*) desc, max(created_at) desc limit 10
  ),
  last_pos as (
    select distinct on (drug_id) drug_id, pos, boites from li where coalesce(pos, '') <> '' order by drug_id, created_at desc
  )
  select jsonb_build_object(
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'brand', d.brand, 'dci', d.dci, 'dci_code', d.dci_code, 'form', d.form,
        'dosage', d.dosage, 'list', d.list, 'pharmacy', d.pharmacy, 'hospital', d.hospital, 'product_type', d.product_type,
        'origin', d.origin, 'lab', d.lab, 'status', d.status, 'count', f.n) order by f.n desc)
        from fav f join drugs d on d.id = f.drug_id where d.status = 'active'), '[]'),
    'posology', coalesce((select jsonb_object_agg(drug_id, jsonb_build_object('pos', pos, 'boites', boites)) from last_pos), '{}'))
$$;

-- 5. Alternatives : tant que le référentiel n'est pas validé, seulement la même molécule (autre présentation)
create or replace function public.prescription_alternatives(p_drug_ids bigint[], p_replace bigint, p_client uuid default null, p_limit int default 5)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer boolean := symphony_can('pharmacovigilance.validate');
  t drugs; rest bigint[]; fam text; tclasses int[]; tcomps int; out jsonb := '[]'; cand record; issues jsonb; n int := 0;
begin
  if auth.uid() is null then return '[]'; end if;
  select * into t from drugs where id = p_replace;
  if t.id is null or t.dci_code is null then return '[]'; end if;
  fam := left(t.dci_code, 4);
  rest := array(select x from unnest(p_drug_ids) x where x <> p_replace);
  select count(*) into tcomps from dci_components where dci = t.dci;
  -- classes pharmacologiques du médicament remplacé (référentiel validé)
  tclasses := array(select distinct cm.class_id
                      from dci_components c
                      join component_substance_map m on m.component = c.component and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
                      join interaction_class_members cm on cm.substance_id = m.substance_id
                     where c.dci = t.dci);
  -- une présentation par molécule (ou par présentation si même molécule) ; les plus répandues d'abord
  for cand in
    select * from (
      select distinct on (case when cardinality(tclasses) = 0 then d.id::text else k.molkey end) d.*, k.molkey, k.ncomp,
             (select count(*) from drugs z where z.dci = d.dci and z.status = 'active') as brands
        from drugs d
        cross join lateral (select string_agg(component, '+' order by component) as molkey, count(*) as ncomp
                              from dci_components where dci = d.dci) k
       where d.status = 'active' and k.molkey is not null and d.id <> t.id
         and (
           -- référentiel validé : autre molécule de la même famille et d'une classe commune
           (cardinality(tclasses) > 0 and left(d.dci_code, 4) = fam and d.dci <> t.dci and k.ncomp <= greatest(tcomps, 1)
            and not exists (select 1 from dci_components a join dci_components b on a.component = b.component where a.dci = d.dci and b.dci = t.dci)
            and exists (
               select 1 from dci_components c
                 join component_substance_map m on m.component = c.component and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
                 join interaction_class_members cm on cm.substance_id = m.substance_id
                where c.dci = d.dci and cm.class_id = any(tclasses)))
           -- sinon : la même molécule, autre présentation en vigueur et disponible en officine
           or (cardinality(tclasses) = 0 and d.pharmacy and k.molkey = (select string_agg(component, '+' order by component) from dci_components where dci = t.dci))
         )
       order by case when cardinality(tclasses) = 0 then d.id::text else k.molkey end,
                (d.pharmacy) desc,
                (split_part(coalesce(d.form, ''), ' ', 1) = split_part(coalesce(t.form, ''), ' ', 1)) desc,
                (d.origin = 'F') desc, (d.product_type = 'GE') desc, d.brand) c
     order by c.pharmacy desc,
              (select count(*) from drugs z join dci_components zc on zc.dci = z.dci
                where z.status = 'active' and zc.component = split_part(c.molkey, '+', 1)) desc
     limit 40
  loop
    select coalesce(jsonb_agg(jsonb_build_object('level', k.level, 'kind', k.kind)), '[]') into issues
      from prescription_check_ctx(rest || cand.id, p_client) k
     where k.drug_a = cand.id or k.drug_b = cand.id;
    -- écartée : alerte grave, doublon, ou tout lien avec une allergie du patient
    if exists (select 1 from jsonb_array_elements(issues) i
                where i->>'level' in ('contre_indication', 'association_deconseillee') or i->>'kind' in ('doublon', 'allergie')) then
      continue;
    end if;
    out := out || jsonb_build_object('drug', jsonb_build_object('id', cand.id, 'brand', cand.brand, 'dci', cand.dci, 'dci_code', cand.dci_code,
             'form', cand.form, 'dosage', cand.dosage, 'list', cand.list, 'pharmacy', cand.pharmacy, 'hospital', cand.hospital,
             'origin', cand.origin, 'product_type', cand.product_type),
           'molecule', replace(cand.molkey, '+', ' + '), 'brands', cand.brands, 'minor', jsonb_array_length(issues),
           'same_molecule', cardinality(tclasses) = 0);
    n := n + 1;
    exit when n >= least(greatest(coalesce(p_limit, 5), 1), 8);
  end loop;
  return out;
end;
$$;

do $$ declare f text; begin
  foreach f in array array['patient_current_treatments(uuid,uuid)', 'prescription_review(bigint[],uuid,uuid)', 'my_prescribing_habits()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
