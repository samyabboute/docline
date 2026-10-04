-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v15 : Régie Publicitaire (ad_campaigns)
-- Remplace display_videos (3 slots fixes) par un système de campagnes
-- ciblées par wilaya / ville / national avec durée en jours
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Table ad_campaigns ────────────────────────────────────────
create table if not exists public.ad_campaigns (
  id             uuid        default uuid_generate_v4() primary key,
  title          text        not null default '',
  video_url      text        not null default '',
  clip_duration_s smallint   not null default 30,
  active         boolean     not null default true,

  -- Ciblage
  target_scope   text        not null default 'national'
                             check (target_scope in ('national','wilaya','city')),
  target_wilayas text[]      not null default '{}',
  target_cities  text[]      not null default '{}',

  -- Planification
  starts_at      date,
  ends_at        date,

  -- Métadonnées
  views_count    integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── 2. RLS ──────────────────────────────────────────────────────
alter table public.ad_campaigns enable row level security;

-- Lecture publique (queue-display sans auth)
drop policy if exists "public_read_ad_campaigns" on public.ad_campaigns;
create policy "public_read_ad_campaigns" on public.ad_campaigns
  for select using (true);

-- Écriture admin uniquement
drop policy if exists "admin_write_ad_campaigns" on public.ad_campaigns;
create policy "admin_write_ad_campaigns" on public.ad_campaigns
  for all using (
    exists (select 1 from public.admin_roles where email = (auth.jwt() ->> 'email'))
    or (auth.jwt() ->> 'email') = 'samyabboute5@gmail.com'
    or (auth.jwt() ->> 'email') = 'contact@docline.health'
  );

-- ── 3. Trigger updated_at ───────────────────────────────────────
create or replace function public.handle_ad_campaigns_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_updated_at_ad_campaigns on public.ad_campaigns;
create trigger set_updated_at_ad_campaigns
  before update on public.ad_campaigns
  for each row execute function public.handle_ad_campaigns_updated_at();

-- ── 4. Storage bucket ───────────────────────────────────────────
-- Créer manuellement dans Supabase Dashboard → Storage
-- Nom: "ad-videos", Public: OUI
-- (même bucket que "display-videos" ou nouveau selon préférence)

-- ════════════════════════════════════════════════════════════════════
-- DONE. Après exécution :
-- 1. Créer/réutiliser le bucket "ad-videos" dans Supabase Storage (public)
-- 2. Gérer les campagnes depuis admin-ads.html
-- 3. queue-display.html filtre automatiquement par wilaya/ville du cabinet
-- ════════════════════════════════════════════════════════════════════
