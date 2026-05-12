-- ============================================================
-- PROSPEO — Migration paiement DZ v1.0
-- Exécuter dans Supabase SQL Editor → New Query → Run
-- À exécuter APRÈS schema.sql et missing_tables.sql
-- ============================================================

-- ── 1. MISE À JOUR TABLE SUBSCRIPTIONS ───────────────────────
-- Ajouter les colonnes manquantes utilisées par activate-plan

alter table public.subscriptions
  add column if not exists billing       text default 'monthly' check (billing in ('monthly','yearly')),
  add column if not exists activated_by  text,           -- 'admin:email' ou 'webhook:slickpay'
  add column if not exists started_at    timestamptz,
  add column if not exists expires_at    timestamptz;    -- null = pas d'expiration (legacy Stripe)

-- Mettre à jour la contrainte 'plan' pour inclure 'enterprise'
-- (l'ancien 'clinic' est renommé 'enterprise' dans le nouveau système DZ)
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('free','pro','enterprise','clinic'));   -- 'clinic' conservé pour rétro-compatibilité

-- Mettre à jour la contrainte 'status' pour inclure 'suspended'
-- Nécessaire pour la fonctionnalité de suspension de compte admin
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('active','cancelled','past_due','suspended','expired'));

-- ── 2. TABLE PAYMENT REQUESTS ────────────────────────────────
-- Demandes de paiement virement / cash / EDAHABIA (Slick-Pay)

create table if not exists public.payment_requests (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  user_email   text not null,
  plan         text not null check (plan in ('pro','enterprise')),
  billing      text not null default 'monthly' check (billing in ('monthly','yearly')),
  amount       integer not null,                         -- Montant en DZD (centimes)
  method       text not null check (method in ('edahabia','virement','cash')),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  slickpay_id  text,                                     -- UUID retourné par l'API Slick-Pay
  proof_url    text,                                     -- Photo du reçu virement / cash (optionnel)
  notes        text,                                     -- Notes admin
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);

-- RLS : l'utilisateur voit ses propres demandes. L'admin (service_role) voit tout.
alter table public.payment_requests enable row level security;

create policy "users_view_own_requests" on public.payment_requests
  for select using (auth.uid() = user_id);

create policy "users_insert_own_requests" on public.payment_requests
  for insert with check (auth.uid() = user_id);

create policy "service_role_all_requests" on public.payment_requests
  for all using (auth.role() = 'service_role');

create index if not exists idx_payment_req_user    on public.payment_requests(user_id, created_at desc);
create index if not exists idx_payment_req_status  on public.payment_requests(status, created_at desc);
create index if not exists idx_payment_req_slick   on public.payment_requests(slickpay_id) where slickpay_id is not null;

-- Auto-update updated_at
create trigger set_updated_at_payment_requests
  before update on public.payment_requests
  for each row execute function public.handle_updated_at();

-- ── 3. INDEX SUPPLÉMENTAIRE SUBSCRIPTIONS ────────────────────
create index if not exists idx_subscriptions_expires on public.subscriptions(expires_at)
  where status = 'active';
