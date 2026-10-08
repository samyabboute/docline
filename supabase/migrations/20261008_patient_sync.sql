-- ============================================================
-- Synchronisation espace patient <-> application médecin (2026-10-08)
--
-- Avant : le dossier du médecin (clients) et le compte du patient
-- (patients) n'étaient reliés par rien.
-- Après :
--  * chaque réservation en ligne rattache (ou crée) le dossier du patient
--    chez le médecin : appointments.client_id ;
--  * chaque dossier médecin dont le téléphone correspond à un compte
--    patient vérifié est relié : clients.patient_id ;
--  * les résultats d'analyses déposés sur un dossier relié apparaissent
--    dans l'espace patient (correction de patient_lab_results) ;
--  * on sait qui a annulé un rendez-vous : appointments.cancelled_by.
-- Le compte patient appartient au titulaire du numéro : une famille qui
-- partage un téléphone partage un espace (les proches).
-- ============================================================

-- ── Colonnes ────────────────────────────────────────────────
alter table public.clients
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists source text;          -- 'online_booking' quand créé par une réservation
alter table public.clients
  add column if not exists phone9 text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9)) stored;
create index if not exists clients_user_phone9_idx on public.clients(user_id, phone9);
create index if not exists clients_patient_idx on public.clients(patient_id);

alter table public.appointments
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists cancelled_by text;
do $$ begin
  alter table public.appointments add constraint appointments_cancelled_by_chk
    check (cancelled_by is null or cancelled_by in ('patient','doctor','system'));
exception when duplicate_object then null; end $$;
create index if not exists appointments_client_idx on public.appointments(client_id);

-- ── Utilitaires ─────────────────────────────────────────────
create or replace function public._phone9(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;

create or replace function public._norm_name(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- ── Réservation -> dossier médecin (+ compte patient) ───────
create or replace function public.appointments_link_patient()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ph text := _phone9(new.patient_phone);
  nm text := _norm_name(new.patient_name);
  cid uuid;
  fn text; ln text;
begin
  if length(ph) <> 9 or new.doctor_id is null then return new; end if;

  if new.patient_id is null then
    select p.id into new.patient_id from patients p where _phone9(p.phone_e164) = ph limit 1;
  end if;

  if new.client_id is null then
    -- même médecin, même téléphone, même nom (une famille partage souvent un numéro)
    select c.id into cid from clients c
     where c.user_id = new.doctor_id and c.phone9 = ph
       and _norm_name(c.first_name || ' ' || c.last_name) = nm
     limit 1;
    if cid is null and nm <> '' then
      fn := split_part(trim(new.patient_name), ' ', 1);
      ln := trim(substr(trim(new.patient_name), length(fn) + 1));
      insert into clients (user_id, first_name, last_name, phone, email, client_type, patient_id, source, tags)
      values (new.doctor_id, fn, coalesce(ln, ''), new.patient_phone, new.patient_email, 'individual',
              new.patient_id, 'online_booking', array['RDV en ligne'])
      returning id into cid;
    end if;
    new.client_id := cid;
  end if;

  if new.client_id is not null and new.patient_id is not null then
    update clients set patient_id = new.patient_id
     where id = new.client_id and patient_id is null;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_link_patient on public.appointments;
create trigger appointments_link_patient before insert on public.appointments
  for each row execute function public.appointments_link_patient();

-- ── Qui a annulé ? ──────────────────────────────────────────
create or replace function public.appointments_cancelled_by()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' and new.cancelled_by is null then
    -- un médecin connecté annule depuis son agenda ; sinon c'est le patient (lien ou espace patient)
    new.cancelled_by := case when auth.uid() is not null then 'doctor' else 'patient' end;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_cancelled_by on public.appointments;
create trigger appointments_cancelled_by before update of status on public.appointments
  for each row execute function public.appointments_cancelled_by();

-- patient_cancel (espace patient) : marquer explicitement
create or replace function public.patient_cancel(p_session text, p_appt uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := _patient_from_session(p_session); ph text; n int;
begin
  if pid is null then return false; end if;
  select _phone9(phone_e164) into ph from patients where id = pid;
  update appointments a set status = 'cancelled', cancelled_by = 'patient', updated_at = now()
   where a.id = p_appt
     and a.status in ('pending','confirmed')
     and a.requested_date >= (now() at time zone 'Africa/Algiers')::date
     and (a.patient_id = pid or (length(ph) = 9 and _phone9(a.patient_phone) = ph));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ── Compte patient -> dossiers médecins ─────────────────────
-- À la création ou à la mise à jour d'un compte, on relie les dossiers
-- portant ce numéro et on complète uniquement les champs vides.
create or replace function public.patients_link_clients()
returns trigger language plpgsql security definer set search_path = public as $$
declare ph text := _phone9(new.phone_e164);
begin
  if length(ph) <> 9 then return new; end if;
  update clients c set
    patient_id     = new.id,
    email          = coalesce(c.email, new.email),
    date_naissance = case when _norm_name(c.first_name || ' ' || c.last_name) = _norm_name(new.full_name)
                          then coalesce(c.date_naissance, new.birth_date) else c.date_naissance end
   where c.phone9 = ph and (c.patient_id is null or c.patient_id = new.id);
  update appointments a set patient_id = new.id
   where a.patient_id is null and _phone9(a.patient_phone) = ph;
  return new;
end;
$$;
drop trigger if exists patients_link_clients on public.patients;
create trigger patients_link_clients after insert or update of phone_e164, full_name, email, birth_date, account_created_at
  on public.patients for each row execute function public.patients_link_clients();

-- ── Correction : résultats visibles dans l'espace patient ───
-- lab_results.patient_id pointe vers clients(id) (le dossier médecin).
create or replace function public.patient_lab_results(p_session text)
returns jsonb
language sql security definer set search_path = public as $$
  with me as (select _patient_from_session(p_session) as pid)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'title', l.title, 'access_code', l.access_code,
      'patient_name', l.patient_name,
      'created_at', l.created_at, 'expires_at', l.expires_at,
      'clinic', coalesce(nullif(d.full_name,''), d.clinic_name))
      order by l.created_at desc), '[]'::jsonb)
    from me
    join clients c on c.patient_id = me.pid
    join lab_results l on l.patient_id = c.id
    left join profiles d on d.id = l.clinic_id
   where me.pid is not null and l.expires_at > now();
$$;

-- ── Rattrapage des données existantes ───────────────────────
-- 1) dossiers <-> comptes patients existants
update clients c set patient_id = p.id
  from patients p
 where c.patient_id is null and length(c.phone9) = 9 and c.phone9 = _phone9(p.phone_e164);
-- 2) rendez-vous existants -> dossier du même médecin (même téléphone et même nom)
update appointments a set client_id = c.id
  from clients c
 where a.client_id is null and c.user_id = a.doctor_id
   and length(c.phone9) = 9 and c.phone9 = _phone9(a.patient_phone)
   and _norm_name(c.first_name || ' ' || c.last_name) = _norm_name(a.patient_name);
-- 3) rendez-vous existants -> compte patient
update appointments a set patient_id = p.id
  from patients p
 where a.patient_id is null and _phone9(a.patient_phone) = _phone9(p.phone_e164)
   and length(_phone9(p.phone_e164)) = 9;
-- 4) annulations passées : auteur inconnu
-- (laissé à null volontairement)

revoke all on function public.appointments_link_patient() from public, anon, authenticated;
revoke all on function public.patients_link_clients() from public, anon, authenticated;
