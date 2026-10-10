-- Essai gratuit : 30 jours (décision du 10/10/2026), aligné sur les textes marketing.
create or replace function public.subscriptions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.role() = 'service_role'
     or symphony_can('payments.decide') or symphony_can('doctors.edit') then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'SUBSCRIPTION_READ_ONLY' using errcode = '42501';
  end if;
  new.status := 'active';
  new.paid_at := null;
  new.activated_by := null;
  new.invoice_notes := null;
  if coalesce(new.plan, 'free') = 'free' then
    new.plan := 'free';
    new.payment_status := null;
    new.expires_at := null;
    new.trial_end_date := null;
  else
    new.payment_status := 'pending';
    new.trial_end_date := now() + interval '30 days';
    new.expires_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;
alter function public.subscriptions_guard() owner to postgres;
