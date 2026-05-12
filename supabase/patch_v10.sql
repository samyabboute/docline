-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v10 : Table lab_results (si non créée)
-- "Erreur de chargement" sur labo.html = table manquante
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.lab_results (
  id            uuid default uuid_generate_v4() primary key,
  clinic_id     uuid references public.profiles(id) on delete cascade not null,
  patient_name  text not null,
  title         text not null,
  description   text,
  file_url      text,
  access_code   text not null,
  view_count    integer default 0,
  expires_at    timestamptz,
  created_at    timestamptz default now() not null,
  unique(access_code)
);

alter table public.lab_results enable row level security;

drop policy if exists "clinic_own_lab_results" on public.lab_results;
create policy "clinic_own_lab_results" on public.lab_results
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);

-- Résultats publics : lisibles via access_code (lien patient, 7j)
drop policy if exists "public_view_lab_by_code" on public.lab_results;
create policy "public_view_lab_by_code" on public.lab_results
  for select using (expires_at > now());

-- Incrémentation du compteur de vues (sans authentification)
drop policy if exists "public_update_view_count" on public.lab_results;
create policy "public_update_view_count" on public.lab_results
  for update using (expires_at > now())
  with check (expires_at > now());

create index if not exists idx_lab_clinic  on public.lab_results(clinic_id, created_at desc);
create index if not exists idx_lab_code    on public.lab_results(access_code);
create index if not exists idx_lab_expires on public.lab_results(expires_at);

-- ════════════════════════════════════════════════════════════════════
-- DONE. Rechargez labo.html — "Erreur de chargement" disparaît.
-- ════════════════════════════════════════════════════════════════════
