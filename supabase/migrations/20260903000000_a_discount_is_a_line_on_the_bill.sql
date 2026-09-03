-- A discount is a line on the bill: the arithmetic half.
--
-- `discount_paise` has existed on `orders` and `bills` since the first billing
-- migration and has only ever held nought, because exposing it decided a
-- pricing and authority question the business had not decided. It has now been
-- decided, and this migration makes the arithmetic able to carry the answer.
--
-- What changes is the identity every order and bill is held to:
--
--     total = subtotal - discount + tax            (before)
--     total = subtotal - discount + tax + rounding (after)
--
-- The rounding term exists because a percentage of an odd subtotal produces
-- paise, and nobody at this counter can be handed 65 of them. The bill is
-- carried up to the next whole rupee, always away from the customer, and the
-- difference is stored rather than derived so that a bill explains itself
-- without anybody re-running the arithmetic that produced it.
--
-- The same identity is enforced in two other places, and all three move
-- together or bills start being refused at the counter:
--   * `public.billing_validate_totals`, rewritten below
--   * `billTotals()` in `src/domain/billing.ts`
-- `supabase/tests/47_bill_discount_arithmetic.sql` asserts the first two agree,
-- and `src/domain/billing-totals-agree.test.ts` carries the shared cases.

-- ---------------------------------------------------------------------------
-- Refuse to proceed against data the new identity cannot describe. Every
-- existing row carries no rounding, so every existing row must already satisfy
-- `total = subtotal - discount + tax` exactly. Counts only: no identifiers,
-- names or amounts may appear in migration diagnostics.

-- The whole-rupee and ₹1-floor constraints below are strictly narrower than
-- what `orders` and `bills` were held to before, so they are asserted here
-- too. Prices have been round rupees to date and every total should already
-- satisfy both, but "should" is what a migration exists to check.

do $$
declare
  v_orders bigint;
  v_bills bigint;
  v_order_shape bigint;
  v_bill_shape bigint;
begin
  select count(*) into v_orders from public.orders
   where total_paise <> subtotal_paise - discount_paise + tax_paise;
  select count(*) into v_bills from public.bills
   where total_paise <> subtotal_paise - discount_paise + tax_paise;

  select count(*) into v_order_shape from public.orders
   where total_paise % 100 <> 0 or total_paise < 100 or discount_paise > subtotal_paise;
  select count(*) into v_bill_shape from public.bills
   where total_paise % 100 <> 0 or total_paise < 100 or discount_paise > subtotal_paise;

  if v_orders <> 0 or v_bills <> 0 or v_order_shape <> 0 or v_bill_shape <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'discount migration refused: identity failures orders=%s bills=%s, '
        || 'shape failures orders=%s bills=%s',
        v_orders, v_bills, v_order_shape, v_bill_shape);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rounding term.
--
-- Bounded at 100 rather than 99 because of one case: an order discounted in
-- full nets nought, and the rounding is what carries it to the ₹1 floor. That
-- floor is the reason a free meal is expressible at all — `bill_payments`
-- requires at least one allocation above nought, so a ₹0 bill could not be
-- settled without a zero-tender path nobody wants.

alter table public.orders
  add column rounding_paise bigint not null default 0
    check (rounding_paise >= 0 and rounding_paise <= 100);

alter table public.bills
  add column rounding_paise bigint not null default 0
    check (rounding_paise >= 0 and rounding_paise <= 100);

alter table public.orders drop constraint orders_total_arithmetic;
alter table public.orders
  add constraint orders_total_arithmetic
    check (total_paise = subtotal_paise - discount_paise + tax_paise + rounding_paise);

alter table public.bills drop constraint bills_total_arithmetic;
alter table public.bills
  add constraint bills_total_arithmetic
    check (total_paise = subtotal_paise - discount_paise + tax_paise + rounding_paise);

-- A discount may reach the whole order — a hundred percent is allowed, and it
-- records the whole giveaway rather than being trimmed to leave a rupee behind,
-- so the month's "given away" figure stays exactly true.
alter table public.orders
  add constraint orders_discount_within_subtotal
    check (discount_paise <= subtotal_paise);
alter table public.bills
  add constraint bills_discount_within_subtotal
    check (discount_paise <= subtotal_paise);

-- Every total a customer is asked for is a whole rupee, and at least one.
alter table public.orders
  add constraint orders_total_whole_rupees
    check (total_paise % 100 = 0 and total_paise >= 100);
alter table public.bills
  add constraint bills_total_whole_rupees
    check (total_paise % 100 = 0 and total_paise >= 100);

-- ---------------------------------------------------------------------------
-- What a line remembers about its own discount.
--
-- `line_total_paise` stays gross, so `subtotal = sum(line_total)` still holds
-- and the existing per-line arithmetic constraint is untouched. The discount
-- sits beside the price rather than inside it, which is what lets a bill
-- settled months ago still say what it gave away and why.
--
-- `discount_percent_bp` is null when the discount was given in rupees; the
-- per-unit amount is then `discount_paise / quantity`. `category_name` is
-- snapshotted for the same reason `item_name` is: a settled bill is never
-- described by joining the live menu.

alter table public.order_items
  add column discount_paise bigint not null default 0 check (discount_paise >= 0),
  add column discount_percent_bp integer check (discount_percent_bp > 0),
  add column category_name text,
  add constraint order_items_discount_within_line
    check (discount_paise <= line_total_paise);

alter table public.bill_items
  add column discount_paise bigint not null default 0 check (discount_paise >= 0),
  add column discount_percent_bp integer check (discount_percent_bp > 0),
  add column category_name text,
  add constraint bill_items_discount_within_line
    check (discount_paise <= line_total_paise);

-- **Historical lines are left null, deliberately.**
--
-- The first version of this migration backfilled `category_name` from the live
-- menu. Production refused it, and was right to: `billing_order_item_guard`
-- admits no write to `order_items` outside a billing command and admits none at
-- all to a line whose order is no longer open, and `bill_items_immutable`
-- refuses every update to a bill line unconditionally. Those guards are the
-- append-only contract working exactly as designed.
--
-- Working around them would have been possible and pointless. A line's
-- `category_name` is read in one place — naming the categories a menu discount
-- covered — and that reader skips any line whose discount is nought. Every line
-- written before this change carries no discount, so a backfilled category
-- could never be displayed. The backfill was risk with no reader.
--
-- Worth recording for the next backfill written here: **`db:reset` applies
-- migrations to empty tables and seeds afterwards**, so a statement that
-- touches existing rows matches nothing locally and passes every gate. Only
-- production has the rows. CI's `migrate` job is the first place such a
-- statement is genuinely exercised.

-- ---------------------------------------------------------------------------
-- The totals validator, rewritten around the same identity.
--
-- `roundingPaise` is read with a default of nought when the key is absent,
-- because a till that went offline before this release and reconnects after it
-- is still holding payloads written without it. Refusing those would lose a
-- day's takings to a deployment, which is precisely what the offline contract
-- exists to prevent.

create or replace function public.billing_validate_totals(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_rounding bigint;
  v_total bigint;
  v_line_sum bigint;
begin
  v_subtotal := (p_payload ->> 'subtotalPaise')::bigint;
  v_discount := (p_payload ->> 'discountPaise')::bigint;
  v_tax := (p_payload ->> 'taxPaise')::bigint;
  v_rounding := coalesce((p_payload ->> 'roundingPaise')::bigint, 0);
  v_total := (p_payload ->> 'totalPaise')::bigint;
  select coalesce(sum((line ->> 'lineTotalPaise')::bigint), 0)
    into v_line_sum
    from jsonb_array_elements(p_payload -> 'lines') line;

  return v_subtotal >= 0 and v_discount >= 0 and v_tax = 0
    and v_rounding >= 0 and v_rounding <= 100
    and v_discount <= v_subtotal
    and v_total >= 100 and v_total % 100 = 0
    and p_payload ->> 'pricingMode' = 'no_tax'
    and v_subtotal = v_line_sum
    and v_total = v_subtotal - v_discount + v_tax + v_rounding;
exception when others then
  return false;
end;
$$;

comment on function public.billing_validate_totals(jsonb) is
  'One half of the bill identity total = subtotal - discount + tax + rounding. '
  'The other halves are the check constraints on orders and bills, and '
  'billTotals() in src/domain/billing.ts. Change one and change all three.';
