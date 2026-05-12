-- ============================================================
-- PROSPEO — Migration RDV (Rendez-vous) v1.0
-- Exécuter APRÈS payment_tables.sql
-- ============================================================

-- ── 1. ENRICHISSEMENT PROFIL MÉDECIN ────────────────────────
alter table public.profiles
  add column if not exists specialty        text,
  add column if not exists wilaya           text,
  add column if not exists city             text,
  add column if not exists address          text,
  add column if not exists phone_public     text,
  add column if not exists bio              text,
  add column if not exists consultation_price integer default 0,
  add column if not exists accepts_rdv      boolean default false,
  add column if not exists is_public        boolean default false,
  add column if not exists avatar_url       text,
  add column if not exists languages        text[] default array['Arabe'];

-- Index pour la recherche publique
create index if not exists idx_profiles_public_specialty
  on public.profiles(specialty) where is_public = true;

create index if not exists idx_profiles_public_wilaya
  on public.profiles(wilaya) where is_public = true;

-- ── 2. TABLE APPOINTMENTS ─────────────────────────────────────
create table if not exists public.appointments (
  id             uuid default uuid_generate_v4() primary key,
  doctor_id      uuid references public.profiles(id) on delete cascade not null,
  patient_name   text not null,
  patient_phone  text not null,
  patient_email  text,
  requested_date date not null,
  requested_time text,                          -- ex: '09:00', '14:30'
  status         text default 'pending'
    check (status in ('pending','confirmed','cancelled','completed')),
  notes          text,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null
);

-- RLS
alter table public.appointments enable row level security;

-- Les médecins voient leurs propres RDV
create policy "doctors_view_own_appointments" on public.appointments
  for select using (auth.uid() = doctor_id);

-- N'importe qui peut prendre RDV (patients sans compte)
create policy "anyone_can_book" on public.appointments
  for insert with check (true);

-- Les médecins peuvent confirmer/annuler leurs RDV
create policy "doctors_update_own_appointments" on public.appointments
  for update using (auth.uid() = doctor_id);

-- Service role accès total
create policy "service_role_all_appointments" on public.appointments
  for all using (auth.role() = 'service_role');

-- Index
create index if not exists idx_appointments_doctor
  on public.appointments(doctor_id, requested_date);

create index if not exists idx_appointments_status
  on public.appointments(status, created_at desc);

-- Auto-update updated_at
create trigger set_updated_at_appointments
  before update on public.appointments
  for each row execute function public.handle_updated_at();

-- ── 3. RLS PROFILS PUBLICS ───────────────────────────────────
-- Permet aux patients (non connectés) de voir les profils publics
create policy "anon_read_public_profiles" on public.profiles
  for select using (is_public = true or auth.uid() = id);
