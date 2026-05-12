-- ============================================================
-- PROSPEO — Tables manquantes v1.0
-- Exécuter dans Supabase SQL Editor → New query → Run
-- Après avoir exécuté schema.sql
-- ============================================================

-- ── FILE D'ATTENTE ────────────────────────────────────────────
create table if not exists public.queue_entries (
  id            uuid default uuid_generate_v4() primary key,
  clinic_id     uuid references public.profiles(id) on delete cascade not null,
  number        integer not null,
  patient_name  text not null,
  status        text not null default 'waiting' check (status in ('waiting','current','done','skipped')),
  priority      text not null default 'normale' check (priority in ('normale','urgente','critique')),
  queue_date    date not null default current_date,
  room          text,
  notes         text,
  created_at    timestamptz default now() not null
);
alter table public.queue_entries enable row level security;
create policy "clinic_own_queue" on public.queue_entries
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
create index if not exists idx_queue_clinic_date on public.queue_entries(clinic_id, queue_date, status);

-- ── SALLES DE CONSULTATION ────────────────────────────────────
create table if not exists public.clinic_rooms (
  id         uuid default uuid_generate_v4() primary key,
  clinic_id  uuid references public.profiles(id) on delete cascade not null,
  name       text not null,
  active     boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now() not null
);
alter table public.clinic_rooms enable row level security;
create policy "clinic_own_rooms" on public.clinic_rooms
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
create index if not exists idx_rooms_clinic on public.clinic_rooms(clinic_id, sort_order);

-- ── PERSONNEL ─────────────────────────────────────────────────
create table if not exists public.staff (
  id          uuid default uuid_generate_v4() primary key,
  clinic_id   uuid references public.profiles(id) on delete cascade not null,
  first_name  text not null,
  last_name   text not null,
  role        text not null default 'autre' check (role in ('secretaire','infirmier','medecin_assistant','technicien_labo','autre')),
  phone       text,
  email       text,
  notes       text,
  active      boolean default true,
  created_at  timestamptz default now() not null
);
alter table public.staff enable row level security;
create policy "clinic_own_staff" on public.staff
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
create index if not exists idx_staff_clinic on public.staff(clinic_id, created_at desc);

-- ── RÉSULTATS DE LABORATOIRE ──────────────────────────────────
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
create policy "clinic_own_lab" on public.lab_results
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
-- Résultats publics : un patient peut lire son résultat via son code d'accès
create policy "public_view_lab_by_code" on public.lab_results
  for select using (
    expires_at > now()
  );
create index if not exists idx_lab_clinic on public.lab_results(clinic_id, created_at desc);
create index if not exists idx_lab_code on public.lab_results(access_code);

-- ── CONSULTATIONS ─────────────────────────────────────────────
create table if not exists public.consultations (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  client_id       uuid references public.clients(id) on delete set null,
  patient_name    text not null,
  consult_date    date not null default current_date,
  motif           text,
  diagnostic      text,
  prescription    text,
  notes           text,
  is_chronic      boolean default false,
  chronic_label   text,
  follow_up_date  date,
  follow_up_notes text,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
alter table public.consultations enable row level security;
create policy "users_own_consultations" on public.consultations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_consultations_user on public.consultations(user_id, consult_date desc);
create trigger set_updated_at_consultations before update on public.consultations
  for each row execute function public.handle_updated_at();

-- ── ORDONNANCES ───────────────────────────────────────────────
create table if not exists public.proposals (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.profiles(id) on delete cascade not null,
  client_name   text not null,
  client_email  text,
  project_title text,
  project_type  text,
  description   text,
  line_items    jsonb not null default '[]',
  status        text not null default 'draft' check (status in ('draft','ready','sent','signed')),
  due_date      date,
  share_token   text unique,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);
alter table public.proposals enable row level security;
create policy "users_own_proposals" on public.proposals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Patients peuvent signer leur ordonnance via share_token (lecture seule sur statut)
create policy "public_sign_proposal" on public.proposals
  for update using (status in ('ready','sent')) with check (status = 'signed');
create index if not exists idx_proposals_user on public.proposals(user_id, created_at desc);
create trigger set_updated_at_proposals before update on public.proposals
  for each row execute function public.handle_updated_at();
