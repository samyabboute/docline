-- ============================================================
-- DOCLINE — Patch v7 : Disponibilités médecin + slots configurables
-- Exécuter APRÈS patch_v6.sql
-- ============================================================
-- Objectif : permettre au médecin de définir ses créneaux
-- (planning hebdo récurrent + jours off ponctuels), pour que
-- find-doctor.html ne génère plus des slots aléatoires mais
-- les vrais créneaux du médecin.
-- ============================================================

-- ── 1. Planning hebdomadaire récurrent ───────────────────────
create table if not exists public.doctor_availability (
  id                    uuid default uuid_generate_v4() primary key,
  doctor_id             uuid references public.profiles(id) on delete cascade not null,
  day_of_week           smallint not null check (day_of_week between 0 and 6),
  -- 0 = Lundi, 1 = Mardi, …, 6 = Dimanche (cohérent avec getDay()-1 conversion)
  start_time            time not null,
  end_time              time not null,
  slot_duration_minutes smallint not null default 30
                        check (slot_duration_minutes in (15,20,30,45,60)),
  is_active             boolean default true not null,
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null,
  constraint chk_time_range check (end_time > start_time),
  constraint uniq_doctor_day unique (doctor_id, day_of_week)
);

alter table public.doctor_availability enable row level security;

-- Médecin gère son propre planning
drop policy if exists "doctor_own_availability" on public.doctor_availability;
create policy "doctor_own_availability" on public.doctor_availability
  for all using (auth.uid() = doctor_id) with check (auth.uid() = doctor_id);

-- N'importe qui (patient anonyme inclus) peut LIRE les dispos
-- des médecins publics (pour afficher les vrais slots)
drop policy if exists "anon_read_availability" on public.doctor_availability;
create policy "anon_read_availability" on public.doctor_availability
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = doctor_id and p.is_public = true and p.accepts_rdv = true
    )
  );

create index if not exists idx_doctor_availability_doctor
  on public.doctor_availability(doctor_id, day_of_week)
  where is_active = true;

-- ── 2. Overrides ponctuels (jours off, horaires modifiés) ────
create table if not exists public.doctor_availability_overrides (
  id            uuid default uuid_generate_v4() primary key,
  doctor_id     uuid references public.profiles(id) on delete cascade not null,
  override_date date not null,
  is_off        boolean default true not null,
  -- Si is_off = false, custom_start/end remplacent le planning du jour
  custom_start  time,
  custom_end    time,
  reason        text,
  created_at    timestamptz default now() not null,
  constraint uniq_doctor_override unique (doctor_id, override_date),
  constraint chk_custom_times check (
    is_off = true or (custom_start is not null and custom_end is not null and custom_end > custom_start)
  )
);

alter table public.doctor_availability_overrides enable row level security;

drop policy if exists "doctor_own_overrides" on public.doctor_availability_overrides;
create policy "doctor_own_overrides" on public.doctor_availability_overrides
  for all using (auth.uid() = doctor_id) with check (auth.uid() = doctor_id);

drop policy if exists "anon_read_overrides" on public.doctor_availability_overrides;
create policy "anon_read_overrides" on public.doctor_availability_overrides
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = doctor_id and p.is_public = true and p.accepts_rdv = true
    )
  );

create index if not exists idx_doctor_overrides_lookup
  on public.doctor_availability_overrides(doctor_id, override_date);

-- ── 3. Trigger updated_at ────────────────────────────────────
drop trigger if exists set_updated_at_doctor_availability on public.doctor_availability;
create trigger set_updated_at_doctor_availability
  before update on public.doctor_availability
  for each row execute function public.handle_updated_at();

-- ── 4. Index supplémentaire sur appointments pour slot lookup ─
-- Pour vérifier rapidement si un slot est déjà pris
create index if not exists idx_appointments_slot_lookup
  on public.appointments(doctor_id, requested_date, requested_time)
  where status in ('pending','confirmed');

-- ── Vérification ─────────────────────────────────────────────
select count(*) as doctor_availability_rows from public.doctor_availability;
select count(*) as doctor_overrides_rows from public.doctor_availability_overrides;
