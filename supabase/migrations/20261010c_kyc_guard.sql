-- ============================================================
-- KYC et colonnes sensibles du profil (2026-10-10)
--  P0 : un médecin pouvait modifier sa propre ligne sans restriction,
--  donc s'auto-approuver (kyc_status = 'approved'), se mettre en
--  vedette ou se réactiver après une suspension.
--  P1 : la décision KYC et l'identité du vérificateur étaient écrites
--  par le navigateur ; le journal échouait en silence pour l'équipe.
-- ============================================================

create or replace function public._is_privileged_writer()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null or coalesce(auth.role(), '') = 'service_role'
      or symphony_can('doctors.edit') or symphony_can('kyc.decide') or symphony_can('featured.manage')
$$;

-- Le médecin garde la main sur sa fiche, jamais sur les champs de contrôle
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if _is_privileged_writer() then return new; end if;

  if tg_op = 'INSERT' then
    new.kyc_status := 'not_submitted';
    new.kyc_reviewed_at := null; new.kyc_reviewer_id := null; new.kyc_reject_reason := null;
    new.kyc_document_url := null; new.kyc_document_type := null; new.kyc_order_number := null; new.kyc_submitted_at := null;
    new.featured := false; new.is_active := true; new.is_public := false;
    new.trial_ends_at := null; new.trial_granted_by := null; new.trial_granted_months := null;
    new.payment_deadline := null; new.extension_count := 0;
    return new;
  end if;

  -- Soumission d'un dossier : seule transition KYC permise au médecin
  if new.kyc_status is distinct from old.kyc_status then
    if new.kyc_status = 'pending_review' and coalesce(old.kyc_status, 'not_submitted') in ('not_submitted', 'rejected', 'pending_review') then
      new.kyc_reject_reason := null;
    else
      new.kyc_status := old.kyc_status;
    end if;
  end if;
  if new.kyc_status is distinct from 'pending_review' or old.kyc_status = 'approved' then
    new.kyc_document_url := old.kyc_document_url; new.kyc_document_type := old.kyc_document_type;
    new.kyc_order_number := old.kyc_order_number; new.kyc_submitted_at := old.kyc_submitted_at;
  end if;
  new.kyc_reviewed_at := old.kyc_reviewed_at; new.kyc_reviewer_id := old.kyc_reviewer_id;
  if new.kyc_status is not distinct from old.kyc_status then new.kyc_reject_reason := old.kyc_reject_reason; end if;
  new.featured := old.featured; new.is_active := old.is_active;
  new.trial_ends_at := old.trial_ends_at; new.trial_granted_by := old.trial_granted_by; new.trial_granted_months := old.trial_granted_months;
  new.payment_deadline := old.payment_deadline; new.extension_count := old.extension_count;
  -- visible dans l'annuaire seulement après vérification
  if coalesce(new.is_public, false) and new.kyc_status is distinct from 'approved' then new.is_public := false; end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.kyc_audit_log drop constraint if exists kyc_audit_log_action_check;
alter table public.kyc_audit_log add constraint kyc_audit_log_action_check check (action in
  ('submitted','approved','rejected','not_submitted','set_plan','activated','deactivated','approve_payment','reject_payment'));

-- Journal KYC tenu par le serveur à chaque changement d'état
create or replace function public.profiles_kyc_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kyc_status is distinct from old.kyc_status
     or (new.kyc_status = 'pending_review' and new.kyc_document_url is distinct from old.kyc_document_url) then
    insert into kyc_audit_log(doctor_id, action, reviewer_id, document_url, note)
    values (new.id,
            case new.kyc_status when 'pending_review' then 'submitted' else new.kyc_status end,
            case when new.kyc_status in ('approved','rejected') then auth.uid() end,
            case when new.kyc_status = 'pending_review' then new.kyc_document_url end,
            case when new.kyc_status = 'rejected' then new.kyc_reject_reason
                 else nullif(current_setting('docline.kyc_note', true), '') end);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_kyc_log on public.profiles;
create trigger profiles_kyc_log after update on public.profiles
  for each row execute function public.profiles_kyc_log();

-- Décision KYC : vérificateur = utilisateur connecté, motif obligatoire pour un refus
create or replace function public.kyc_decide(p_doctor uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p profiles; reason text := nullif(trim(p_reason), '');
begin
  if not symphony_can('kyc.decide') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'DECISION_INVALID'; end if;
  select * into p from profiles where id = p_doctor for update;
  if p.id is null then raise exception 'DOCTOR_NOT_FOUND'; end if;
  if p_decision = 'rejected' and coalesce(length(reason), 0) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_decision = 'approved' then
    if p.kyc_status = 'approved' then raise exception 'ALREADY_APPROVED'; end if;
    if p.kyc_document_url is null then raise exception 'NO_DOCUMENT'; end if;
  end if;
  if p_decision = 'rejected' and p.kyc_status = 'rejected' then raise exception 'ALREADY_REJECTED'; end if;
  perform set_config('docline.kyc_note', coalesce(reason, ''), true);
  update profiles set kyc_status = p_decision, kyc_reviewed_at = now(), kyc_reviewer_id = auth.uid(),
         kyc_reject_reason = case when p_decision = 'rejected' then reason end
   where id = p_doctor;
  return jsonb_build_object('status', p_decision, 'reviewer', _staff_name(symphony_current_staff()), 'reviewed_at', now());
end;
$$;

-- Lecture du journal pour l'équipe : pas d'écriture depuis le navigateur
drop policy if exists "admin manage kyc_audit_log" on public.kyc_audit_log;
drop policy if exists kyc_log_staff_read on public.kyc_audit_log;
create policy kyc_log_staff_read on public.kyc_audit_log for select to authenticated using (symphony_can('kyc.view'));

do $$ declare f text; begin
  foreach f in array array['_is_privileged_writer()','profiles_guard()','profiles_kyc_log()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.kyc_decide(uuid,text,text) from public, anon;
grant execute on function public.kyc_decide(uuid,text,text) to authenticated;
alter function public._is_privileged_writer() owner to postgres;
alter function public.profiles_guard() owner to postgres;
alter function public.profiles_kyc_log() owner to postgres;
alter function public.kyc_decide(uuid,text,text) owner to postgres;
