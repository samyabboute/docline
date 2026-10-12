-- ============================================================
-- Interactions : validation groupée des correspondances exactes (2026-10-13)
-- Une molécule de la nomenclature dont le nom est identique à une substance
-- du référentiel (score 1) peut être validée en une fois par la pharmacienne.
-- Chaque ligne garde l'identité de la validatrice ; l'action est journalisée.
-- ============================================================
create or replace function public.pv_validate_exact_mappings()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not symphony_can('pharmacovigilance.validate') then raise exception 'FORBIDDEN'; end if;
  update component_substance_map
     set status = 'validated', reviewed_by = auth.uid(), reviewed_at = now()
   where status = 'proposed' and origin = 'auto' and score >= 1;
  get diagnostics n = row_count;
  perform pv_log('mapping_bulk_exact', null, jsonb_build_object('validated', n));
  return n;
end;
$$;

create or replace function public.pv_exact_pending()
returns int language sql stable security definer set search_path = public as $$
  select case when pv_can_view() then (select count(*)::int from component_substance_map where status = 'proposed' and origin = 'auto' and score >= 1) end
$$;

revoke all on function public.pv_validate_exact_mappings() from public, anon;
revoke all on function public.pv_exact_pending() from public, anon;
grant execute on function public.pv_validate_exact_mappings() to authenticated;
grant execute on function public.pv_exact_pending() to authenticated;
alter function public.pv_validate_exact_mappings() owner to postgres;
alter function public.pv_exact_pending() owner to postgres;
