-- Demandes de paiement (2026-10-11)
--  - l'équipe ne pouvait pas les lire : la liste de la page Médecins restait vide
--    et « Rejeter » ne modifiait rien
--  - un médecin pouvait créer une demande déjà « approuvée »
drop policy if exists payment_requests_staff_read on public.payment_requests;
create policy payment_requests_staff_read on public.payment_requests for select to authenticated
  using (symphony_can('payments.view'));
drop policy if exists payment_requests_staff_decide on public.payment_requests;
create policy payment_requests_staff_decide on public.payment_requests for update to authenticated
  using (symphony_can('payments.decide')) with check (symphony_can('payments.decide'));
drop policy if exists users_insert_own_requests on public.payment_requests;
create policy users_insert_own_requests on public.payment_requests for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending');
