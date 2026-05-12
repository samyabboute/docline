-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v11 : Table staff (personnel de la clinique)
-- "Erreur de chargement" sur staff.html = table absente du projet
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.staff (
  id          uuid default uuid_generate_v4() primary key,
  clinic_id   uuid references public.profiles(id) on delete cascade not null,
  first_name  text not null,
  last_name   text not null,
  role        text not null default 'autre'
              check (role in ('secretaire','infirmier','medecin_assistant','technicien_labo','autre')),
  phone       text,
  email       text,
  notes       text,
  active      boolean default true not null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

alter table public.staff enable row level security;

drop policy if exists "clinic_own_staff" on public.staff;
create policy "clinic_own_staff" on public.staff
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);

create index if not exists idx_staff_clinic on public.staff(clinic_id, created_at desc);

-- Trigger updated_at
create or replace function public.handle_staff_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_updated_at_staff on public.staff;
create trigger set_updated_at_staff
  before update on public.staff
  for each row execute function public.handle_staff_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- DONE. Rechargez staff.html — "Erreur de chargement" disparaît.
-- ════════════════════════════════════════════════════════════════════
