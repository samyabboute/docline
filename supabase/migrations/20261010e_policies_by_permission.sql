-- ============================================================
-- P1-6 (2026-10-10) : plus aucune règle d'accès fondée sur une
-- adresse email écrite en dur ou sur l'ancienne table admin_roles.
-- Chaque règle s'appuie sur une permission Symphony.
-- ============================================================

-- Les membres créés au QG ont un identifiant propre : on les reconnaît à leur email
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from symphony_staff
                  where lower(email) = lower(auth.email()) and is_active
                    and (is_admin or role = 'super_admin'))
$$;
alter function public.is_admin() owner to postgres;

-- Lectures déjà couvertes par profiles_staff_read / subs_staff_read
drop policy if exists admin_read_all_profiles on public.profiles;
drop policy if exists admin_read_all_subscriptions on public.subscriptions;

-- Avis des médecins
drop policy if exists feedback_read_policy on public.feedback;
create policy feedback_read_policy on public.feedback for select to authenticated
  using (auth.uid() = user_id or symphony_is_staff());
drop policy if exists feedback_insert_policy on public.feedback;
create policy feedback_insert_policy on public.feedback for insert to authenticated
  with check (auth.uid() = user_id);

-- Publicité
drop policy if exists admin_write_display_videos on public.display_videos;
create policy admin_write_display_videos on public.display_videos for all to authenticated
  using (symphony_can('ads.manage')) with check (symphony_can('ads.manage'));
drop policy if exists admin_write_ad_campaigns on public.ad_campaigns;
create policy admin_write_ad_campaigns on public.ad_campaigns for all to authenticated
  using (symphony_can('ads.manage')) with check (symphony_can('ads.manage'));
drop policy if exists "admins can manage marketing offers" on public.marketing_offers;
create policy "admins can manage marketing offers" on public.marketing_offers for all to authenticated
  using (symphony_can('ads.manage') or symphony_can('featured.manage'))
  with check (symphony_can('ads.manage') or symphony_can('featured.manage'));

-- Réglages, codes promo, maintenance
drop policy if exists "admins can write app_settings" on public.app_settings;
create policy "admins can write app_settings" on public.app_settings for all to authenticated
  using (symphony_can('settings.manage')) with check (symphony_can('settings.manage'));
drop policy if exists "admins can write promo_codes" on public.promo_codes;
create policy "admins can write promo_codes" on public.promo_codes for all to authenticated
  using (symphony_can('settings.manage')) with check (symphony_can('settings.manage'));
drop policy if exists maintenance_notify_admin on public.maintenance_notify;
create policy maintenance_notify_admin on public.maintenance_notify for all to authenticated
  using (symphony_can('settings.manage')) with check (symphony_can('settings.manage'));

-- Données sensibles : accès réservé au niveau « users.sensitive »
drop policy if exists "admin read all appointments" on public.appointments;
create policy "admin read all appointments" on public.appointments for select to authenticated
  using (symphony_can('users.sensitive'));
drop policy if exists "admins can log password resets" on public.admin_password_resets;
create policy "admins can log password resets" on public.admin_password_resets for all to authenticated
  using (symphony_can('users.sensitive')) with check (symphony_can('users.sensitive'));
drop policy if exists "manage deletion requests" on public.account_deletion_requests;
-- le médecin garde l'accès à sa propre demande de suppression
create policy "manage deletion requests" on public.account_deletion_requests for all to authenticated
  using (user_id = auth.uid() or symphony_can('users.sensitive'))
  with check (user_id = auth.uid() or symphony_can('users.sensitive'));

-- KYC et emails
drop policy if exists user_metadata_kyc_admin on public.user_metadata;
create policy user_metadata_kyc_admin on public.user_metadata for all to authenticated
  using (symphony_can('kyc.decide')) with check (symphony_can('kyc.decide'));
drop policy if exists email_logs_admin on public.email_logs;
create policy email_logs_admin on public.email_logs for select to authenticated
  using (symphony_can('marketing.view') or symphony_can('settings.manage'));

-- Ancienne table d'agents (remplacée par symphony_staff)
drop policy if exists symphony_agents_admin_policy on public.symphony_agents;
create policy symphony_agents_admin_policy on public.symphony_agents for select to authenticated
  using (symphony_can('team.manage'));
