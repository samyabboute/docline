-- ════════════════════════════════════════════════════════════════════
-- Docline — patch_v14 : Display Videos (broadcast pub salle d'attente)
-- Géré par l'admin Docline → affiché sur TOUS les écrans de toutes les cliniques
-- ════════════════════════════════════════════════════════════════════

-- ── 1. TABLE display_videos ───────────────────────────────────────
create table if not exists public.display_videos (
  id          uuid default uuid_generate_v4() primary key,
  slot        smallint not null check (slot between 1 and 3) unique, -- slot 1, 2, 3
  title       text     not null default '',        -- label admin (ex: "Pub Sanofi 30s")
  video_url   text     not null default '',        -- URL directe MP4/WebM (Supabase Storage ou CDN)
  duration_s  smallint not null default 30,        -- durée approximative en secondes
  active      boolean  not null default true,
  updated_at  timestamptz default now() not null
);

-- Initialiser les 3 slots vides
insert into public.display_videos (slot, title, video_url, duration_s, active)
values
  (1, '', '', 30, false),
  (2, '', '', 30, false),
  (3, '', '', 30, false)
on conflict (slot) do nothing;

-- ── 2. RLS ───────────────────────────────────────────────────────
alter table public.display_videos enable row level security;

-- Lecture publique (tous les écrans queue-display sans auth)
drop policy if exists "public_read_display_videos" on public.display_videos;
create policy "public_read_display_videos" on public.display_videos
  for select using (true);

-- Écriture réservée aux admins (via admin_roles)
drop policy if exists "admin_write_display_videos" on public.display_videos;
create policy "admin_write_display_videos" on public.display_videos
  for all using (
    exists (
      select 1 from public.admin_roles
      where email = (auth.jwt() ->> 'email')
    )
    or (auth.jwt() ->> 'email') = 'samyabboute5@gmail.com'
    or (auth.jwt() ->> 'email') = 'contact@docline.health'
  );

-- ── 3. Trigger updated_at ─────────────────────────────────────────
create or replace function public.handle_display_videos_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_updated_at_display_videos on public.display_videos;
create trigger set_updated_at_display_videos
  before update on public.display_videos
  for each row execute function public.handle_display_videos_updated_at();

-- ── 4. Storage bucket pour les fichiers vidéo ────────────────────
-- À exécuter dans le dashboard Supabase → Storage → New Bucket
-- Nom: "display-videos", Public: OUI
-- (Le SQL pour storage n'est pas toujours disponible selon la version Supabase)
-- Sinon utiliser l'interface Storage du dashboard.

-- ════════════════════════════════════════════════════════════════════
-- DONE. Après exécution :
-- 1. Créer le bucket "display-videos" dans Supabase Storage (public)
-- 2. L'admin peut ajouter des vidéos depuis admin-settings.html
-- 3. Tous les écrans queue-display.html chargeront automatiquement les vidéos
-- ════════════════════════════════════════════════════════════════════
