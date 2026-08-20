-- A supplier's own statement, ingested one order at a time.
--
-- The dedup key already exists: manual_ledger_expenses is unique on
-- (outlet_id, source_system, source_ref), added by #42 so a re-run updates in
-- place. A Hyperpure order sets source_ref to the order number, so one purchase
-- can only ever hold one row however many times a statement is read, whichever
-- statement it appears in, and whoever supplied it. That is the structural
-- double-count fix, and it is a key rather than a tolerance match: two genuine
-- purchases of similar size on nearby days are ordinary and must both stand.
--
-- Two things are new here. A shared-cost marker, because both kitchens draw on
-- one Hyperpure inventory: a purchase is booked once, against the outlet the
-- goods were delivered to, and marked shared so it does not read as that one
-- kitchen's alone and can be reallocated later without reading the supplier
-- again. And a statement ingest that dates each order by its invoice date — the
-- day the goods arrived and the day the statement itself filters on — falling
-- back to the books' opening date where the invoice precedes it, so a cost
-- settled from an in-period payout is recorded rather than lost to a period the
-- ledger does not cover.

alter table public.manual_ledger_expenses
  add column shared_cost boolean not null default false;

comment on column public.manual_ledger_expenses.shared_cost is
  'A cost booked once against its delivery outlet but drawn on by more than one kitchen from a single inventory, so it does not read as that outlet''s alone and can be reallocated without re-reading the supplier.';

-- One expense per order, summed and credited-note-adjusted by the parser before
-- it arrives, dated by invoice date with the opening-date fallback.
--
-- The parser does the arithmetic — summing an order's invoices, subtracting its
-- credit notes, dropping customer detail — so this function books a settled
-- figure per order and nothing more. It writes with the service role and so
-- bypasses RLS, which is why it validates the outlet against the credential's
-- permitted set exactly as ingest_aggregator_cycle does.
create or replace function public.ingest_supply_statement(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $ingest$
declare
  v_outlet uuid;
  v_source_system text;
  v_books_open date;
  v_written int := 0;
  v_order record;
  v_business_date date;
begin
  if coalesce((p_payload ->> 'contract_version')::int, 0) <> 1 then
    raise exception 'unsupported contract version %',
      coalesce(p_payload ->> 'contract_version', 'none')
      using errcode = '22023';
  end if;

  v_outlet := (p_payload ->> 'outlet_id')::uuid;
  v_source_system := p_payload ->> 'source_system';

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write supply costs for outlet %', v_outlet
      using errcode = '42501';
  end if;

  -- A reserved category owns these rows, and only its own origin may write them.
  -- Refusing an unknown source here rather than letting the reserved-category
  -- trigger drop the row keeps the failure legible: a statement from a supplier
  -- the ledger does not recognise is a mistake to report, not a row to swallow.
  if public.expense_category_reserved_owner(p_payload ->> 'category')
       is distinct from v_source_system then
    raise exception 'the category % is not owned by the source %',
      p_payload ->> 'category', v_source_system
      using errcode = '22023';
  end if;

  -- The books' opening for this outlet: the earliest day the ledger already
  -- holds, whether a recorded day or an expense. An order invoiced before it is
  -- dated to it, so money that left an in-period payout lands inside the period
  -- the ledger covers rather than in one it does not.
  select least(
           (select min(business_date) from public.manual_ledger_days
             where outlet_id = v_outlet),
           (select min(business_date) from public.manual_ledger_expenses
             where outlet_id = v_outlet))
    into v_books_open;

  for v_order in
    select o ->> 'order_ref' as order_ref,
           (o ->> 'invoice_date')::date as invoice_date,
           (o ->> 'amount_paise')::bigint as amount_paise,
           coalesce(nullif(o ->> 'description', ''), p_payload ->> 'category') as description,
           coalesce((o ->> 'shared_cost')::boolean, false) as shared_cost
      from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
  loop
    if v_order.order_ref is null or length(btrim(v_order.order_ref)) = 0 then
      raise exception 'a supply order carries no reference and cannot be deduplicated'
        using errcode = '22023';
    end if;

    v_business_date := greatest(v_order.invoice_date, coalesce(v_books_open, v_order.invoice_date));

    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description,
       source_system, source_ref, shared_cost, recorded_by)
    values (v_outlet, v_business_date, p_payload ->> 'category', false,
            v_order.amount_paise, v_order.description,
            v_source_system, v_order.order_ref, v_order.shared_cost, null)
    on conflict (outlet_id, source_system, source_ref) where source_system is not null
    do update set amount_paise = excluded.amount_paise,
                  business_date = excluded.business_date,
                  description = excluded.description,
                  category = excluded.category,
                  shared_cost = excluded.shared_cost
    where public.manual_ledger_expenses.voided_at is null;

    v_written := v_written + 1;
  end loop;

  return jsonb_build_object(
    'outcome', 'ok',
    'orders_written', v_written);
end;
$ingest$;
