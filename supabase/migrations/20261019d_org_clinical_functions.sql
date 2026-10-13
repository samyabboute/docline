-- Aide à la prescription et file d'attente utilisables par l'équipe autorisée
-- (permission « dossier médical » pour la prescription, « file d'attente » pour les réglages).
-- Les contrôles « patient de ce médecin » deviennent « patient d'un médecin pour lequel j'ai ce droit ».

-- 1. Fonctions existantes : même code, contrôle d'accès élargi aux membres autorisés
do $$
declare f text; def text;
begin
  foreach f in array array['public._patient_conditions(uuid)', 'public.prescription_check_ctx(bigint[], uuid)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('c.user_id = auth.uid()' in def) = 0 then raise exception 'pattern absent dans %', f; end if;
    def := replace(def, 'c.user_id = auth.uid()', 'member_can(c.user_id, ''medical.view'')');
    execute def;
  end loop;
end $$;

-- 2. Traitements en cours : ordonnances du médecin du patient (90 jours)
create or replace function public.patient_current_treatments(p_client uuid, p_exclude uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]') from (
    select distinct on ((li->>'drug_id')::bigint)
           jsonb_build_object('drug_id', (li->>'drug_id')::bigint,
             'label', trim(concat_ws(' ', d.brand, d.dosage)), 'dci', d.dci,
             'date', coalesce(p.due_date, p.created_at::date), 'ordonnance_id', p.id,
             'posologie', coalesce(li->>'quantity', li->>'posologie')) x
      from clients c
      join proposals p on p.user_id = c.user_id and p.client_id = c.id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.line_items) = 'array' then p.line_items else '[]'::jsonb end) li
      join drugs d on d.id = (li->>'drug_id')::bigint
     where c.id = p_client and member_can(c.user_id, 'medical.view')
       and p.project_type = 'ordonnance'
       and (p_exclude is null or p.id <> p_exclude)
       and coalesce(p.due_date, p.created_at::date) > current_date - 90
       and li ? 'drug_id' and (li->>'drug_id') ~ '^\d+$'
     order by (li->>'drug_id')::bigint, coalesce(p.due_date, p.created_at::date) desc
  ) y
$$;

-- 3. Habitudes de prescription : celles du médecin pour lequel on rédige
drop function if exists public.my_prescribing_habits();
create or replace function public.my_prescribing_habits(p_doctor uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with doc as (select coalesce(p_doctor, auth.uid()) as id),
  li as (
    select (x->>'drug_id')::bigint as drug_id, coalesce(x->>'quantity', x->>'posologie') as pos,
           nullif(x->>'boites', '')::int as boites, p.created_at
      from proposals p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.line_items) = 'array' then p.line_items else '[]'::jsonb end) x
     where p.user_id = (select id from doc) and member_can((select id from doc), 'medical.view')
       and p.project_type = 'ordonnance' and p.created_at > now() - interval '12 months'
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

-- 4. Réglages de la file : par le cabinet ou un membre autorisé
drop function if exists public.queue_settings_save(text, time, time, int, int, boolean, text);
create or replace function public.queue_settings_save(p_status text, p_open_from time, p_open_until time,
  p_last_entry_min int, p_max_per_day int, p_show_name boolean, p_message text, p_clinic uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_clinic uuid := coalesce(p_clinic, auth.uid());
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = v_clinic) or not member_can(v_clinic, 'queue.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status not in ('open','paused','closed') then raise exception 'STATUS_INVALID'; end if;
  if p_open_from is not null and p_open_until is not null and p_open_until <= p_open_from then raise exception 'HOURS_INVALID'; end if;
  insert into queue_settings(clinic_id, status, open_from, open_until, last_entry_min, max_per_day, show_name, message, updated_at)
  values (v_clinic, p_status, p_open_from, p_open_until, coalesce(p_last_entry_min, 15), nullif(p_max_per_day, 0),
          coalesce(p_show_name, true), nullif(trim(p_message), ''), now())
  on conflict (clinic_id) do update set status = excluded.status, open_from = excluded.open_from, open_until = excluded.open_until,
     last_entry_min = excluded.last_entry_min, max_per_day = excluded.max_per_day, show_name = excluded.show_name,
     message = excluded.message, updated_at = now();
  return queue_status(v_clinic, null);
end;
$$;

do $$ declare f text; begin
  foreach f in array array['patient_current_treatments(uuid,uuid)', 'my_prescribing_habits(uuid)',
                           'queue_settings_save(text,time,time,int,int,boolean,text,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $$;
