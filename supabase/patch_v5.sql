-- ============================================================
-- DOCLINE — Patch v5 : Table calendar_tasks pour l'Agenda médecin
-- Exécuter dans Supabase SQL Editor (après patch_v4.sql)
-- ============================================================

-- ── 1. Créer la table calendar_tasks (agenda du médecin) ──────
create table if not exists public.calendar_tasks (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  title        text not null,
  type         text not null default 'task'
               check (type in ('consultation','suivi','rappel','reunion','task')),
  priority     text not null default 'medium'
               check (priority in ('low','medium','high')),
  due_date     date,
  event_date   date,
  patient_name text,
  notes        text,
  completed    boolean default false not null,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);

-- ── 2. RLS ───────────────────────────────────────────────────
alter table public.calendar_tasks enable row level security;

drop policy if exists "users_own_calendar_tasks" on public.calendar_tasks;
create policy "users_own_calendar_tasks" on public.calendar_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 3. Index ─────────────────────────────────────────────────
create index if not exists idx_cal_tasks_user_date
  on public.calendar_tasks(user_id, due_date);

-- ── 4. Trigger updated_at ────────────────────────────────────
create or replace function public.handle_calendar_tasks_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_updated_at_calendar_tasks on public.calendar_tasks;
create trigger set_updated_at_calendar_tasks
  before update on public.calendar_tasks
  for each row execute function public.handle_calendar_tasks_updated_at();

-- ── 5. Ajouter 'cib' aux méthodes de paiement acceptées ──────
-- La contrainte existante n'incluait pas 'cib' (CIB = Carte Interbancaire)
alter table public.payment_requests
  drop constraint if exists payment_requests_method_check;

alter table public.payment_requests
  add constraint payment_requests_method_check
  check (method in ('cib','edahabia','virement','cash'));

-- ── Vérification ─────────────────────────────────────────────
select count(*) as calendar_tasks from public.calendar_tasks;
select count(*) as payment_requests from public.payment_requests;
