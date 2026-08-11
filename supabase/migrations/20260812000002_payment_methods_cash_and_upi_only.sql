-- Billing V1 accepts customer tender at the counter only as Cash or UPI.
-- Production was audited before this migration was written: bills,
-- bill_payments and expenses contained no Swiggy or Zomato values. Refuse to
-- reinterpret history if another environment acquired one in the meantime.
create or replace function public.assert_payment_method_narrowing_safe(
  p_has_aggregator_history boolean
)
returns void language plpgsql set search_path = '' as $$
begin
  if p_has_aggregator_history then
    raise exception 'cannot remove aggregator payment methods while swiggy or zomato rows exist';
  end if;
end
$$;

select public.assert_payment_method_narrowing_safe(
  exists (select 1 from public.bills where payment_method::text in ('swiggy', 'zomato'))
  or exists (select 1 from public.bill_payments where method::text in ('swiggy', 'zomato'))
  or exists (select 1 from public.expenses where payment_method::text in ('swiggy', 'zomato'))
);

revoke all on function public.assert_payment_method_narrowing_safe(boolean)
  from public, anon, authenticated;

-- PostgreSQL cannot remove enum values in place. Move every dependent column
-- through text, replace the type, then restore the typed database boundary and
-- the policy whose expression depends on it. Migrations are transactional, so
-- a failure leaves the old type intact.
drop policy expenses_insert on public.expenses;

alter table public.bills
  alter column payment_method type text using payment_method::text;
alter table public.bill_payments
  alter column method type text using method::text;
alter table public.expenses
  alter column payment_method type text using payment_method::text;

drop type public.payment_method;
create type public.payment_method as enum ('cash', 'upi');

alter table public.bills
  alter column payment_method type public.payment_method
  using payment_method::text::public.payment_method;
alter table public.bill_payments
  alter column method type public.payment_method
  using method::text::public.payment_method;
alter table public.expenses
  alter column payment_method type public.payment_method
  using payment_method::text::public.payment_method;

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.app_account_active()
    and recorded_by = auth.uid()
    and (
      outlet_id in (select public.app_outlets_for('franchise_admin'))
      or ((select public.app_is_owner()) and payment_method <> 'cash')
    )
  );
