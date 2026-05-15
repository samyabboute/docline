-- ============================================================
-- DOCLINE — Agenda partagé Clinic : table clinic_doctors
-- Exécuter dans Supabase SQL Editor
-- ============================================================

-- Table de liaison : clinique ↔ médecins membres
create table if not exists public.clinic_doctors (
  id          uuid default uuid_generate_v4() primary key,
  clinic_id   uuid references public.profiles(id) on delete cascade not null,
  doctor_id   uuid references public.profiles(id) on delete cascade not null,
  color       text default '#3B1772',   -- couleur dans l'agenda partagé
  joined_at   timestamptz default now() not null,
  unique(clinic_id, doctor_id)
);

alter table public.clinic_doctors enable row level security;

-- Le propriétaire de la clinique gère ses médecins membres
create policy "clinic_owner_manage_doctors" on public.clinic_doctors
  for all using (auth.uid() = clinic_id)
  with check (auth.uid() = clinic_id);

-- Un médecin peut voir sa propre appartenance
create policy "doctor_view_own_membership" on public.clinic_doctors
  for select using (auth.uid() = doctor_id);

-- Index performance
create index if not exists idx_clinic_doctors_clinic on public.clinic_doctors(clinic_id);
create index if not exists idx_clinic_doctors_doctor on public.clinic_doctors(doctor_id);

-- ── Permettre au propriétaire de la clinique de voir les RDV des membres ──
-- (nouvelle policy sur appointments)
drop policy if exists "clinic_owner_view_member_appointments" on public.appointments;
create policy "clinic_owner_view_member_appointments" on public.appointments
  for select using (
    auth.uid() = doctor_id
    OR exists (
      select 1 from public.clinic_doctors cd
      where cd.clinic_id = auth.uid()
        and cd.doctor_id = appointments.doctor_id
    )
  );
