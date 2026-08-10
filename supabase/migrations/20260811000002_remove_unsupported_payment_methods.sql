-- Neither outlet accepts Card or a vague Other payment category. Production
-- was audited before this migration was written: bills and expenses were empty
-- for both values. Refuse to rewrite history if another environment acquired
-- an unsupported row.
do $$
begin
  if exists (select 1 from public.bills where payment_method in ('card', 'other'))
     or exists (select 1 from public.expenses where payment_method in ('card', 'other')) then
    raise exception 'cannot remove unsupported payment methods while card or other rows exist';
  end if;
end
$$;

-- PostgreSQL cannot drop one enum value. Move the two columns through text,
-- replace the type, then restore the typed boundary and the one policy whose
-- expression depends on that type. The transaction is atomic.
drop policy expenses_insert on public.expenses;

alter table public.bills
  alter column payment_method type text using payment_method::text;
alter table public.expenses
  alter column payment_method type text using payment_method::text;

drop type public.payment_method;
create type public.payment_method as enum ('cash', 'upi', 'swiggy', 'zomato');

alter table public.bills
  alter column payment_method type public.payment_method
  using payment_method::text::public.payment_method;
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
