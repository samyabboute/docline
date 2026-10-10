-- P1-7 (2026-10-10) : les justificatifs de paiement ne sont plus publics.
-- Lecture : le médecin qui l'a envoyé et l'équipe autorisée (payments.view), par URL signée.
update storage.buckets set public = false where id = 'payment-proofs';
drop policy if exists "Public read payment proofs" on storage.objects;
drop policy if exists payment_proofs_owner_read on storage.objects;
create policy payment_proofs_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists payment_proofs_staff_read on storage.objects;
create policy payment_proofs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.symphony_can('payments.view'));
