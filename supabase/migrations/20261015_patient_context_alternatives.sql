-- ============================================================
-- Contre-indications liées au patient et alternatives (2026-10-15)
--
-- Étape 4 : contexte clinique structuré du patient (allergies, grossesse,
-- allaitement, fonction rénale et hépatique ; l'âge vient de la date de
-- naissance). Deux sortes d'alertes :
--  * allergie à une molécule notée dans le dossier : c'est une donnée saisie
--    par le médecin lui-même, l'alerte est donc toujours active ;
--  * règles « substance x situation » (grossesse, insuffisance rénale…) :
--    saisies et validées par la pharmacienne, actives seulement quand les
--    alertes sont mises en service, comme les interactions.
-- Étape 5 : alternatives de la même famille thérapeutique (code de la
-- nomenclature), disponibles en Algérie, sans alerte grave avec le reste
-- de l'ordonnance ni avec le contexte du patient.
-- ============================================================

-- 1. Contexte clinique du patient (un par fiche patient du médecin)
create table if not exists public.patient_clinical_context (
  client_id  uuid primary key references public.clients(id) on delete cascade,
  doctor_id  uuid not null references public.profiles(id) on delete cascade,
  allergens  jsonb not null default '[]',            -- [{key, label, kind: 'component'|'class'}]
  pregnancy  text not null default 'none' check (pregnancy in ('none', 'pregnant', 'breastfeeding')),
  renal      text not null default 'normal' check (renal in ('normal', 'moderate', 'severe')),
  hepatic    text not null default 'normal' check (hepatic in ('normal', 'impaired')),
  updated_at timestamptz not null default now()
);
alter table public.patient_clinical_context enable row level security;
drop policy if exists pcc_owner on public.patient_clinical_context;
create policy pcc_owner on public.patient_clinical_context for all to authenticated
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()))
  with check (doctor_id = auth.uid() and exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));

-- Situations du patient (âge calculé à partir de la date de naissance)
create or replace function public._patient_conditions(p_client uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when x.pregnancy = 'pregnant' then 'grossesse' end,
    case when x.pregnancy = 'breastfeeding' then 'allaitement' end,
    case when x.renal = 'moderate' then 'insuffisance_renale_moderee' end,
    case when x.renal = 'severe' then 'insuffisance_renale_severe' end,
    case when x.renal = 'severe' then 'insuffisance_renale_moderee' end,   -- une règle « modérée » vaut aussi en cas d'atteinte sévère
    case when x.hepatic = 'impaired' then 'insuffisance_hepatique' end,
    case when c.date_naissance is not null and age(c.date_naissance) < interval '15 years' then 'enfant' end,
    case when c.date_naissance is not null and age(c.date_naissance) >= interval '75 years' then 'sujet_age' end
  ], null)
  from clients c left join patient_clinical_context x on x.client_id = c.id
  where c.id = p_client and c.user_id = auth.uid()
$$;

-- 2. Règles « substance ou classe x situation » (validées par la pharmacienne)
create table if not exists public.drug_condition_rules (
  id           bigint generated always as identity primary key,
  substance_id int  not null references public.interaction_substances(id) on delete cascade,
  condition    text not null check (condition in ('grossesse', 'allaitement', 'insuffisance_renale_moderee', 'insuffisance_renale_severe',
                                                  'insuffisance_hepatique', 'enfant', 'sujet_age')),
  level        text not null check (level in ('contre_indication', 'association_deconseillee', 'precaution_emploi', 'a_prendre_en_compte')),
  message      text not null,
  conduct      text,
  source_id    int  not null references public.interaction_sources(id),
  status       text not null default 'draft' check (status in ('draft', 'validated', 'rejected')),
  created_by   uuid references auth.users(id),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (substance_id, condition, source_id)
);
alter table public.drug_condition_rules enable row level security;
drop policy if exists drug_condition_rules_staff_read on public.drug_condition_rules;
create policy drug_condition_rules_staff_read on public.drug_condition_rules for select to authenticated using (pv_can_view());
revoke insert, update, delete on public.drug_condition_rules from anon, authenticated;

-- 3. Recherche d'allergène pour le médecin : molécules de la nomenclature et classes du référentiel
create or replace function public.allergen_search(p_q text, p_limit int default 12)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with q as (select pv_fold(p_q) t)
  select coalesce(jsonb_agg(x order by x->>'rank', x->>'label'), '[]') from (
    select jsonb_build_object('key', s.key, 'label', s.label, 'kind', 'class', 'rank', case when s.key like q.t || '%' then '0' else '1' end) x
      from interaction_substances s, q
     where s.kind = 'class' and length(q.t) >= 2 and s.key like '%' || q.t || '%'
    union all
    select jsonb_build_object('key', c.component, 'label', initcap(c.component), 'kind', 'component', 'rank', case when c.component like q.t || '%' then '0' else '2' end)
      from (select distinct component from dci_components) c, q
     where length(q.t) >= 2 and c.component like '%' || q.t || '%'
    limit least(greatest(coalesce(p_limit, 12), 1), 30)
  ) y
$$;

-- 4. Vérification complète : interactions et doublons + allergies + situations du patient
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

  -- Interactions entre médicaments et doublons (soumis à la mise en service)
  return query select case when x.level = 'doublon' then 'doublon' else 'interaction' end, x.drug_a, x.drug_b, x.substance_a, x.substance_b,
                      x.level, x.mechanism, x.conduct, x.source, x.source_version, x.reviewed
                 from prescription_check(p_drug_ids) x;

  if not v_ok_client then return; end if;
  select * into v_ctx from patient_clinical_context where client_id = p_client;
  v_conds := _patient_conditions(p_client);

  -- Allergies notées dans le dossier : molécule exacte (toujours active)
  if v_ctx.client_id is not null and jsonb_array_length(v_ctx.allergens) > 0 then
    return query
    select distinct 'allergie', d.id, null::bigint, a->>'label', c.component, 'contre_indication',
           'Allergie notée dans le dossier du patient : ' || (a->>'label') || '.',
           'Ne pas prescrire ce médicament. Choisir une molécule d''une autre famille.', 'Dossier du patient', null::text, true
      from drugs d
      join dci_components c on c.dci = d.dci
      join jsonb_array_elements(v_ctx.allergens) a on a->>'kind' = 'component' and a->>'key' = c.component
     where d.id = any(p_drug_ids[1:30]);

    -- Même famille thérapeutique (code de la nomenclature) qu'une molécule notée comme allergène :
    -- simple signal factuel, le médecin juge du risque d'allergie croisée
    return query
    select distinct on (d.id) 'allergie', d.id, null::bigint, a->>'label', d.dci, 'a_prendre_en_compte',
           'Même famille thérapeutique que ' || (a->>'label') || ', noté comme allergène dans le dossier du patient.',
           'Vérifier le risque d''allergie croisée avant de prescrire.', 'Dossier du patient', null::text, true
      from drugs d
      join jsonb_array_elements(v_ctx.allergens) a on a->>'kind' = 'component'
     where d.id = any(p_drug_ids[1:30]) and d.dci_code is not null
       and not exists (select 1 from dci_components c where c.dci = d.dci and c.component = a->>'key')
       and left(d.dci_code, 4) in (select distinct left(x.dci_code, 4) from drugs x join dci_components xc on xc.dci = x.dci
                                    where xc.component = a->>'key' and x.dci_code is not null)
     order by d.id;

    -- Allergie à une classe (pénicillines, AINS…) : passe par le référentiel validé
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
       where d.id = any(p_drug_ids[1:30])
         and not exists (select 1 from jsonb_array_elements(v_ctx.allergens) a2 where a2->>'kind' = 'component' and a2->>'key' = c.component)
       group by d.id, a->>'label', c.component;
    end if;
  end if;

  -- Situations du patient (grossesse, rein, foie, âge) : règles validées, après mise en service
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
     where d.id = any(p_drug_ids[1:30])
     order by d.id, r.condition,
              case r.level when 'contre_indication' then 1 when 'association_deconseillee' then 2 when 'precaution_emploi' then 3 else 4 end;
  end if;
end;
$$;

-- 5. Alternatives : même famille thérapeutique (code nomenclature « 01 A »), disponibles
--    en officine, sans alerte grave avec le reste de l'ordonnance et le patient
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
  -- une présentation par molécule ; les molécules les plus répandues en Algérie d'abord
  for cand in
    select * from (
      select distinct on (k.molkey) d.*, k.molkey, k.ncomp,
             (select count(*) from drugs z where z.dci = d.dci and z.status = 'active') as brands
        from drugs d
        cross join lateral (select string_agg(component, '+' order by component) as molkey, count(*) as ncomp
                              from dci_components where dci = d.dci) k
       where d.status = 'active' and left(d.dci_code, 4) = fam and d.dci <> t.dci and k.molkey is not null
         and k.ncomp <= greatest(tcomps, 1)
         and not exists (select 1 from dci_components a join dci_components b on a.component = b.component where a.dci = d.dci and b.dci = t.dci)
         and (cardinality(tclasses) = 0 or exists (
               select 1 from dci_components c
                 join component_substance_map m on m.component = c.component and (m.status = 'validated' or (v_reviewer and m.status = 'proposed'))
                 join interaction_class_members cm on cm.substance_id = m.substance_id
                where c.dci = d.dci and cm.class_id = any(tclasses)))
       order by k.molkey,
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
           'molecule', replace(cand.molkey, '+', ' + '), 'brands', cand.brands, 'minor', jsonb_array_length(issues));
    n := n + 1;
    exit when n >= least(greatest(coalesce(p_limit, 5), 1), 8);
  end loop;
  return out;
end;
$$;

-- 6. Règles de situation : écran de la pharmacienne
create or replace function public.pv_condition_rules(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not pv_can_view() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id, r.condition, r.level, r.message, r.conduct, r.status, s.label as substance, s.kind,
           src.label as source, src.version_label as source_version, r.reviewed_at,
           (select u.email from auth.users u where u.id = r.reviewed_by) as reviewer
      from drug_condition_rules r join interaction_substances s on s.id = r.substance_id join interaction_sources src on src.id = r.source_id
     where p_status is null or r.status = p_status
     order by case r.status when 'draft' then 0 when 'validated' then 1 else 2 end, s.label, r.condition
     limit 300) x), '[]');
end;
$$;

create or replace function public.pv_add_condition_rule(p_substance int, p_condition text, p_level text, p_message text, p_conduct text, p_source_id int)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_message, ''))) < 5 then raise exception 'MESSAGE_REQUIRED'; end if;
  if not exists (select 1 from interaction_sources where id = p_source_id) then raise exception 'SOURCE_REQUIRED'; end if;
  insert into drug_condition_rules (substance_id, condition, level, message, conduct, source_id, status, created_by)
  values (p_substance, p_condition, p_level, trim(p_message), nullif(trim(p_conduct), ''), p_source_id, 'draft', auth.uid())
  on conflict (substance_id, condition, source_id) do update
    set level = excluded.level, message = excluded.message, conduct = excluded.conduct, status = 'draft', reviewed_by = null, reviewed_at = null
  returning id into v_id;
  perform pv_log('condition_rule_saved', v_id::text, jsonb_build_object('substance', p_substance, 'condition', p_condition, 'level', p_level));
  return v_id;
end;
$$;

create or replace function public.pv_review_condition_rule(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('validated', 'rejected', 'draft') then raise exception 'BAD_STATUS'; end if;
  update drug_condition_rules set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pv_log('condition_rule', p_id::text, jsonb_build_object('status', p_status));
end;
$$;

do $$ declare f text; begin
  foreach f in array array['_patient_conditions(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
  foreach f in array array['allergen_search(text,int)', 'prescription_check_ctx(bigint[],uuid)', 'prescription_alternatives(bigint[],bigint,uuid,int)',
                           'pv_condition_rules(text)', 'pv_add_condition_rule(int,text,text,text,text,int)', 'pv_review_condition_rule(bigint,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
