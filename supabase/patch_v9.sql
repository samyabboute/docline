-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v9 : Table consultations (si non créée)
-- "Erreur de chargement" sur consultations.html = table manquante
-- ════════════════════════════════════════════════════════════════════

-- Table consultations
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

drop policy if exists "users_own_consultations" on public.consultations;
create policy "users_own_consultations" on public.consultations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_consultations_user
  on public.consultations (user_id, consult_date desc);

-- Trigger updated_at (si la fonction handle_updated_at existe)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'handle_updated_at') then
    if not exists (
      select 1 from pg_trigger where tgname = 'set_updated_at_consultations'
    ) then
      create trigger set_updated_at_consultations
        before update on public.consultations
        for each row execute function public.handle_updated_at();
    end if;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- DONE. Rechargez consultations.html — "Erreur de chargement" disparaît.
-- ════════════════════════════════════════════════════════════════════
