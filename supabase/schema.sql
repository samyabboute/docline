-- ============================================================
-- PROSPEO MEDICALCRM — Schéma de base de données v3.0
-- Adapté pour les médecins et cliniques d'Algérie
-- Exécuter UNE SEULE FOIS dans Supabase SQL Editor → New Query → Run
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── PROFILES (médecins / cliniques) ─────────────────────────
create table public.profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  email           text not null,
  first_name      text,
  last_name       text,
  clinic_name     text,                          -- Nom du cabinet / clinique
  speciality      text,                          -- Spécialité médicale
  phone           text,
  wilaya          text,                          -- Wilaya algérienne
  address         text,
  avatar_url      text,
  locale          text default 'fr' check (locale in ('fr','ar','en')),
  timezone        text default 'Africa/Algiers',
  onboarded_at    timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

-- ── SUBSCRIPTIONS ────────────────────────────────────────────
-- Source unique de vérité pour le plan. JAMAIS modifié depuis le frontend.
-- Seule la fonction Edge stripe-webhook écrit dans cette table.
create table public.subscriptions (
  id                      uuid default uuid_generate_v4() primary key,
  user_id                 uuid references public.profiles(id) on delete cascade not null unique,
  plan                    text not null default 'free' check (plan in ('free','pro','clinic')),
  status                  text not null default 'active' check (status in ('active','trialing','past_due','canceled','paused')),
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  stripe_price_id         text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean default false,
  trial_end               timestamptz,
  created_at              timestamptz default now() not null,
  updated_at              timestamptz default now() not null
);

-- ── LEADS (pipeline patients) ────────────────────────────────
create table public.leads (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  first_name      text not null,
  last_name       text not null,
  date_naissance  date,
  groupe_sanguin  text,
  email           text,
  phone           text,
  wilaya          text,
  insurance_type  text default 'individual' check (insurance_type in ('company','freelancer','individual')),
  insurance_num   text,                          -- N° CNAS / CASNOS
  stage           text not null default 'new' check (stage in ('new','contacted','qualified','proposal','won','lost')),
  deal_value      numeric(12,2) default 0,       -- Honoraires (DA)
  expected_close  date,
  notes           text,
  antecedents     text,                          -- Antécédents médicaux
  tags            text[],
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

-- ── CLIENTS (dossiers patients) ──────────────────────────────
create table public.clients (
  id                    uuid default uuid_generate_v4() primary key,
  user_id               uuid references public.profiles(id) on delete cascade not null,
  first_name            text not null,
  last_name             text not null,
  date_naissance        date,
  groupe_sanguin        text,
  email                 text,
  phone                 text,
  address               text,
  city                  text,                    -- Wilaya
  country               text default 'DZ',
  insurance_type        text default 'individual' check (insurance_type in ('company','freelancer','individual')),
  insurance_num         text,                    -- N° CNAS / CASNOS (réutilise vat_number en BDD)
  vat_number            text,                    -- alias insurance_num (compat. legacy)
  medecin_traitant      text,                    -- Médecin traitant référent
  notes                 text,                    -- Antécédents / Allergies
  tags                  text[],
  converted_from_lead   uuid references public.leads(id) on delete set null,
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null
);

-- ── ACTIVITIES ───────────────────────────────────────────────
create table public.activities (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  lead_id     uuid references public.leads(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  type        text not null check (type in ('note','call','email','meeting','task')),
  title       text,
  body        text not null,
  happened_at timestamptz default now() not null,
  created_at  timestamptz default now() not null,
  constraint activity_has_target check (lead_id is not null or client_id is not null)
);

-- ── EVENTS (Agenda & RDV) ────────────────────────────────────
create table public.events (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  lead_id     uuid references public.leads(id) on delete set null,
  client_id   uuid references public.clients(id) on delete set null,
  title       text not null,
  type        text not null default 'meeting' check (type in ('meeting','call','task','deadline')),
  start_at    timestamptz not null,
  end_at      timestamptz,
  location    text,
  notes       text,
  completed   boolean default false,
  created_at  timestamptz default now() not null
);

-- ── INVOICES (Facturation en DA) ─────────────────────────────
create table public.invoices (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  client_id       uuid references public.clients(id) on delete set null,
  proposal_id     uuid,
  invoice_number  text not null,
  type            text not null default 'invoice' check (type in ('invoice','quote','credit')),
  status          text not null default 'draft' check (status in ('draft','sent','paid','overdue','canceled')),
  issue_date      date not null default current_date,
  due_date        date,
  client_name     text not null,
  client_email    text,
  client_address  text,
  client_vat      text,                          -- N° CNAS/CASNOS du patient
  line_items      jsonb not null default '[]',
  subtotal        numeric(12,2) not null default 0,
  vat_rate        numeric(5,2) not null default 0,  -- 0% par défaut (médecins exonérés)
  vat_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  currency        text default 'DZD',
  notes           text,
  paid_at         timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  unique(user_id, invoice_number)
);

-- ── AUDIT LOG ────────────────────────────────────────────────
create table public.audit_log (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  event       text not null,
  metadata    jsonb default '{}',
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz default now() not null
);

-- ── AUTO-UPDATE TIMESTAMPS ───────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger set_updated_at before update on public.profiles      for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.subscriptions  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.leads          for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.clients        for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.invoices       for each row execute function public.handle_updated_at();

-- ── NEW USER TRIGGER ─────────────────────────────────────────
-- Crée automatiquement un profil + abonnement gratuit à chaque inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name, clinic_name)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    coalesce(new.raw_user_meta_data->>'clinic_name',''));
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
-- SÉCURITÉ NIVEAU LIGNE (RLS)
-- Chaque utilisateur est isolé. Appliqué au niveau BDD.
-- ══════════════════════════════════════════════════════════════
alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.leads         enable row level security;
alter table public.clients       enable row level security;
alter table public.activities    enable row level security;
alter table public.events        enable row level security;
alter table public.invoices      enable row level security;
alter table public.audit_log     enable row level security;

create policy "users_own_profile_select" on public.profiles for select using (auth.uid() = id);
create policy "users_own_profile_update" on public.profiles for update using (auth.uid() = id);
create policy "users_own_subscription_select" on public.subscriptions for select using (auth.uid() = user_id);
create policy "users_own_leads"      on public.leads      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users_own_clients"    on public.clients    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users_own_activities" on public.activities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users_own_events"     on public.events     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users_own_invoices"   on public.invoices   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── INDEX DE PERFORMANCE ─────────────────────────────────────
create index idx_leads_user_id      on public.leads(user_id);
create index idx_leads_stage        on public.leads(user_id, stage);
create index idx_leads_created      on public.leads(created_at desc);
create index idx_clients_user_id    on public.clients(user_id);
create index idx_activities_lead    on public.activities(lead_id);
create index idx_activities_client  on public.activities(client_id);
create index idx_activities_user    on public.activities(user_id, happened_at desc);
create index idx_events_user_date   on public.events(user_id, start_at);
create index idx_invoices_user      on public.invoices(user_id, status);
create index idx_subs_stripe        on public.subscriptions(stripe_customer_id);
create index idx_subs_user          on public.subscriptions(user_id);
create index idx_audit_user         on public.audit_log(user_id, created_at desc);

-- ── FONCTION LIMITE PATIENTS ─────────────────────────────────
create or replace function public.check_lead_limit(p_user_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_plan    text;
  v_count   int;
  v_limit   int;
begin
  select plan into v_plan from public.subscriptions where user_id = p_user_id;
  select count(*) into v_count from public.leads where user_id = p_user_id;
  v_limit := case v_plan
    when 'pro'    then 999999
    when 'clinic' then 999999
    else 30
  end;
  return jsonb_build_object(
    'allowed', v_count < v_limit,
    'count',   v_count,
    'limit',   v_limit,
    'plan',    coalesce(v_plan,'free')
  );
end; $$;

-- ── FEEDBACK ─────────────────────────────────────────────────
create table public.feedback (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  rating       smallint not null check (rating between 1 and 5),
  rating_label text,
  comment      text,
  login_count  integer,
  page         text default 'dashboard',
  created_at   timestamptz default now() not null
);
alter table public.feedback enable row level security;
create policy "users_insert_own_feedback" on public.feedback for insert with check (auth.uid() = user_id);
create policy "users_read_own_feedback"   on public.feedback for select using (auth.uid() = user_id);
create index idx_feedback_user   on public.feedback(user_id, created_at desc);
create index idx_feedback_rating on public.feedback(rating, created_at desc);

-- ── CONSULTATIONS RÉCURRENTES ────────────────────────────────
-- Pro : suivi chronique automatisé (diabète, HTA, etc.)
create table public.recurring_invoices (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  client_id       uuid references public.clients(id) on delete cascade,
  title           text not null,
  description     text,
  amount_ht       numeric(12,2) not null default 0,  -- Honoraires (DA)
  tva_rate        numeric(5,2) not null default 0,   -- 0% (médecins exonérés)
  currency        text default 'DZD',
  frequency       text not null check (frequency in ('monthly','quarterly','yearly')),
  day_of_month    integer default 1 check (day_of_month between 1 and 28),
  next_date       date not null,
  auto_send       boolean default false,
  is_active       boolean default true,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
alter table public.recurring_invoices enable row level security;
create policy "users_own_recurring" on public.recurring_invoices
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── TOKENS PORTAIL CLIENT ────────────────────────────────────
create table public.client_portal_tokens (
  id          uuid default uuid_generate_v4() primary key,
  invoice_id  uuid references public.invoices(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  views       integer default 0,
  expires_at  timestamptz default (now() + interval '1 year'),
  created_at  timestamptz default now() not null
);
alter table public.client_portal_tokens enable row level security;
create policy "users_own_tokens"  on public.client_portal_tokens using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "public_read_token" on public.client_portal_tokens for select using (expires_at > now());

-- ── RAPPELS DE PAIEMENT ──────────────────────────────────────
create table public.payment_reminders (
  id          uuid default uuid_generate_v4() primary key,
  invoice_id  uuid references public.invoices(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  type        text not null check (type in ('before_due','on_due','overdue_7','overdue_14')),
  sent_at     timestamptz default now() not null,
  success     boolean default true
);
alter table public.payment_reminders enable row level security;
create policy "users_own_reminders" on public.payment_reminders using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index idx_recurring_user    on public.recurring_invoices(user_id, next_date);
create index idx_portal_token      on public.client_portal_tokens(token);
create index idx_reminders_invoice on public.payment_reminders(invoice_id);

-- ── ORDONNANCES ──────────────────────────────────────────────
create table if not exists public.proposals (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.profiles(id) on delete cascade not null,
  client_name      text not null,
  client_email     text not null,
  client_company   text,                   -- Médecin traitant / clinique
  client_phone     text,
  project_title    text not null,          -- Titre de l'ordonnance
  project_type     text default 'consultation',
  description      text,
  contract_terms   text,                   -- Instructions médicales
  line_items       jsonb default '[]'::jsonb,  -- Médicaments & prescriptions
  amount_ht        numeric(12,2) default 0,
  tva_rate         numeric(5,2)  default 0,    -- 0% (médecins exonérés)
  amount_ttc       numeric(12,2) default 0,
  currency         text default 'DZD',
  payment_type     text default 'full',
  due_date         date,
  valid_until      date,
  status           text default 'draft'
    check (status in ('draft','ready','sent','signed','paid','declined')),
  share_token      text unique not null,
  signature_data   text,
  signed_at        timestamptz,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

alter table public.proposals enable row level security;
create policy "users_own_proposals"          on public.proposals using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "public_read_proposal_by_token" on public.proposals for select using (share_token is not null AND status NOT IN ('draft'));
create policy "public_sign_proposal"          on public.proposals for update
  using  (share_token is not null AND status IN ('ready','sent'))
  with check (status = 'signed');

create index if not exists idx_proposals_user   on public.proposals(user_id, created_at desc);
create index if not exists idx_proposals_token  on public.proposals(share_token);
create index if not exists idx_proposals_status on public.proposals(user_id, status);

alter table public.invoices
  add constraint invoices_proposal_id_fkey
  foreign key (proposal_id) references public.proposals(id) on delete set null;

create index if not exists idx_invoices_proposal on public.invoices(proposal_id);

-- ── FILE D'ATTENTE (QR Code) ─────────────────────────────────
-- Fonctionnalité exclusive : patients rejoignent via QR Code
create table public.queue_entries (
  id           uuid default uuid_generate_v4() primary key,
  clinic_id    uuid references public.profiles(id) on delete cascade not null,
  number       integer not null,
  patient_name text,
  status       text not null default 'waiting' check (status in ('waiting','current','done','skipped')),
  queue_date   date not null default current_date,
  created_at   timestamptz default now() not null,
  unique(clinic_id, number, queue_date)
);

alter table public.queue_entries enable row level security;

-- Le médecin peut tout faire sur sa file
create policy "clinic_own_queue" on public.queue_entries
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);

-- Les patients peuvent insérer (rejoindre la file) sans être authentifiés
create policy "public_join_queue" on public.queue_entries
  for insert with check (true);

-- Les patients peuvent voir leur numéro (lecture publique de la file du jour)
create policy "public_read_queue" on public.queue_entries
  for select using (queue_date = current_date);

create index idx_queue_clinic_date on public.queue_entries(clinic_id, queue_date, number);
create index idx_queue_status      on public.queue_entries(clinic_id, queue_date, status);

-- ── PERSONNEL (Gestion du personnel clinique) ─────────────────────
create table public.staff (
  id         uuid default uuid_generate_v4() primary key,
  clinic_id  uuid references public.profiles(id) on delete cascade not null,
  first_name text not null,
  last_name  text not null,
  role       text not null default 'autre'
    check (role in ('secretaire','infirmier','medecin_assistant','technicien_labo','autre')),
  phone      text,
  email      text,
  notes      text,
  active     boolean default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table public.staff enable row level security;
create policy "clinic_own_staff" on public.staff
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
create index idx_staff_clinic on public.staff(clinic_id, active);
create trigger set_updated_at before update on public.staff
  for each row execute function public.handle_updated_at();

-- ── SALLES DE CONSULTATION ────────────────────────────────────────
create table public.clinic_rooms (
  id          uuid default uuid_generate_v4() primary key,
  clinic_id   uuid references public.profiles(id) on delete cascade not null,
  name        text not null,          -- "Salle 1", "Cabinet A", "Radiologie", etc.
  description text,
  active      boolean default true,
  sort_order  integer default 0,
  created_at  timestamptz default now() not null
);
alter table public.clinic_rooms enable row level security;
create policy "clinic_own_rooms" on public.clinic_rooms
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
create index idx_rooms_clinic on public.clinic_rooms(clinic_id, active, sort_order);

-- Ajoute la colonne salle assignée sur queue_entries
alter table public.queue_entries
  add column if not exists room text;  -- Nom de la salle (ex: "Salle 2")

-- ── RÉSULTATS DE LABORATOIRE (accès 7 jours) ─────────────────────
-- Médecin dépose les résultats → patient accède via code unique 6 chars
create table public.lab_results (
  id           uuid default uuid_generate_v4() primary key,
  clinic_id    uuid references public.profiles(id) on delete cascade not null,
  patient_id   uuid references public.clients(id) on delete set null,
  patient_name text not null,
  title        text not null,            -- "Analyse de sang", "Radio thoracique"
  description  text,                     -- Observations, instructions
  file_url     text,                     -- URL Supabase Storage (PDF/image)
  access_code  text unique not null,     -- Code 6 chars ex. "K3MX7A"
  expires_at   timestamptz not null default (now() + interval '7 days'),
  viewed_at    timestamptz,              -- Horodatage première consultation
  view_count   integer not null default 0,
  created_at   timestamptz default now() not null
);
alter table public.lab_results enable row level security;
-- Le médecin gère entièrement ses résultats
create policy "clinic_own_lab_results" on public.lab_results
  for all using (auth.uid() = clinic_id) with check (auth.uid() = clinic_id);
-- Accès public lecture si non expiré (le frontend vérifie le access_code exact)
create policy "public_read_lab_results" on public.lab_results
  for select using (expires_at > now());
-- Mise à jour du compteur de vues (unauthenticated)
create policy "public_update_view_count" on public.lab_results
  for update using (expires_at > now())
  with check (expires_at > now());
create index idx_lab_clinic  on public.lab_results(clinic_id, created_at desc);
create index idx_lab_code    on public.lab_results(access_code);
create index idx_lab_expires on public.lab_results(expires_at);

-- ── CONSULTATIONS ─────────────────────────────────────────────────
-- Suivi de chaque consultation médicale d'un patient
create table public.consultations (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  client_id       uuid references public.clients(id) on delete set null,
  patient_name    text not null,
  consult_date    date not null default current_date,
  motif           text,                  -- Raison de la consultation
  diagnostic      text,                  -- Diagnostic posé
  prescription    text,                  -- Traitement prescrit (texte libre)
  notes           text,                  -- Notes cliniques
  follow_up_date  date,                  -- Prochain RDV
  follow_up_notes text,                  -- Instructions de suivi
  is_chronic      boolean default false, -- Pathologie chronique (HTA, diabète…)
  chronic_label   text,                  -- "HTA", "Diabète type 2"…
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
alter table public.consultations enable row level security;
create policy "users_own_consultations" on public.consultations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_consult_user    on public.consultations(user_id, consult_date desc);
create index idx_consult_client  on public.consultations(client_id);
create index idx_consult_chronic on public.consultations(user_id, is_chronic, follow_up_date);
create trigger set_updated_at before update on public.consultations
  for each row execute function public.handle_updated_at();
