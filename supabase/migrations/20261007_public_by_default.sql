-- ════════════════════════════════════════════════════════════════════
-- Profils médecins visibles par défaut, au choix du médecin
--   • visible automatiquement quand le KYC est approuvé (ou quand un médecin
--     approuvé complète spécialité + wilaya), si le compte est actif ;
--   • le médecin peut se masquer : ce choix est mémorisé (public_opt_out)
--     et n'est jamais écrasé par une validation ultérieure ;
--   • masqué automatiquement si le KYC n'est plus approuvé.
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists public_opt_out boolean not null default false;

create or replace function public.profiles_auto_visibility()
returns trigger language plpgsql set search_path = public as $$
declare
  was_ready boolean := false;
  is_ready  boolean;
begin
  is_ready := new.kyc_status = 'approved'
          and coalesce(new.is_active, true)
          and coalesce(trim(new.specialty), '') <> ''
          and coalesce(trim(new.wilaya), '') <> '';

  if tg_op = 'UPDATE' then
    was_ready := old.kyc_status = 'approved'
             and coalesce(old.is_active, true)
             and coalesce(trim(old.specialty), '') <> ''
             and coalesce(trim(old.wilaya), '') <> '';
  end if;

  -- Le médecin vient de devenir « prêt » (KYC approuvé, profil complet, compte actif)
  if is_ready and not was_ready and not new.public_opt_out then
    new.is_public := true;
  end if;

  -- KYC plus approuvé : le profil ne doit plus apparaître aux patients
  if new.kyc_status is distinct from 'approved' then
    new.is_public := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_auto_visibility on public.profiles;
create trigger trg_profiles_auto_visibility
  before insert or update on public.profiles
  for each row execute function public.profiles_auto_visibility();

revoke all on function public.profiles_auto_visibility() from public, anon, authenticated;

-- Rattrapage : médecins déjà prêts et qui n'ont jamais demandé à être masqués
update public.profiles
   set is_public = true
 where kyc_status = 'approved'
   and coalesce(is_active, true)
   and coalesce(trim(specialty), '') <> ''
   and coalesce(trim(wilaya), '') <> ''
   and not public_opt_out
   and not is_public;
