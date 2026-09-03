-- What the receipt says.
--
-- Two claims, and neither can be made anywhere else.
--
-- **The grouping agrees.** A menu discount is stored on each line it reduced,
-- so the row a person reads is a sum over lines -- and it is summed twice, by
-- `groupMenuDiscounts()` for the counter's draft and by
-- `public.bill_public_discount_rows()` for the customer's receipt. Neither can
-- be the other: a draft has no rows in the database, and the receipt must
-- perform no arithmetic on the page. `src/domain/discount-row-cases.json` is
-- the one table both are held to, run through the function in
-- `src/domain/discount-rows.test.ts` and through the database here.
--
-- **Every figure is the stored one.** A receipt that computes, disagreeing with
-- a bill that stored, is the worst bug available here -- so each figure the
-- receipt returns is compared against the column it came from rather than
-- against a number this file worked out.
--
-- The case block below is generated from that JSON, and
-- `scripts/check-discount-row-cases.mjs` fails the lint when it drifts. Do not
-- edit it by hand: change the JSON and paste what the check prints.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.kalyani() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------
-- The shared case table.

create table pg_temp.discount_row_cases (
  case_name text,
  line_no integer,
  item_name text,
  unit_price_paise bigint,
  quantity integer,
  discount_paise bigint,
  discount_percent_bp integer,
  category_name text
);

create table pg_temp.discount_row_expected (
  case_name text,
  row_no integer,
  basis text,
  value_bp integer,
  value_paise bigint,
  categories text[],
  amount_paise bigint
);

insert into pg_temp.discount_row_cases
  (case_name, line_no, item_name, unit_price_paise, quantity, discount_paise,
   discount_percent_bp, category_name) values
-- BEGIN GENERATED DISCOUNT ROW LINES
  ('one percentage over one category', 0, 'Classic Chicken Shawarma', 13900, 1, 2085, 1500, 'Shawarma'),
  ('one percentage over one category', 1, 'Cold Coffee', 9900, 1, 0, null, 'Drinks'),
  ('one percentage over two categories combines into one row', 0, 'Classic Chicken Shawarma', 13900, 1, 1390, 1000, 'Shawarma'),
  ('one percentage over two categories combines into one row', 1, 'Cold Coffee', 9900, 2, 1980, 1000, 'Drinks'),
  ('two different percentages get a row each', 0, 'Classic Chicken Shawarma', 13900, 1, 2085, 1500, 'Shawarma'),
  ('two different percentages get a row each', 1, 'Cold Coffee', 9900, 1, 990, 1000, 'Drinks'),
  ('a rupee discount groups by its per-unit amount, not its line total', 0, 'Classic Chicken Shawarma', 13900, 3, 6000, null, 'Shawarma'),
  ('a rupee discount groups by its per-unit amount, not its line total', 1, 'Cold Coffee', 9900, 1, 2000, null, 'Drinks'),
  ('a percentage and a rupee discount are never one row', 0, 'Classic Chicken Shawarma', 13900, 1, 2000, null, 'Shawarma'),
  ('a percentage and a rupee discount are never one row', 1, 'Cold Coffee', 9900, 1, 990, 1000, 'Drinks'),
  ('a fractional percentage keeps its basis points and its exact paise', 0, 'Classic Chicken Shawarma', 13900, 1, 1043, 750, 'Shawarma'),
  ('a line with no category still carries its reduction', 0, 'Classic Chicken Shawarma', 13900, 1, 1390, 1000, null),
  ('an undiscounted bill has no rows at all', 0, 'Classic Chicken Shawarma', 13900, 1, 0, null, 'Shawarma');
-- END GENERATED DISCOUNT ROW LINES

insert into pg_temp.discount_row_expected
  (case_name, row_no, basis, value_bp, value_paise, categories, amount_paise) values
-- BEGIN GENERATED DISCOUNT ROW EXPECTATIONS
  ('one percentage over one category', 0, 'percent', 1500, null, array['Shawarma']::text[], 2085),
  ('one percentage over two categories combines into one row', 0, 'percent', 1000, null, array['Shawarma', 'Drinks']::text[], 3370),
  ('two different percentages get a row each', 0, 'percent', 1000, null, array['Drinks']::text[], 990),
  ('two different percentages get a row each', 1, 'percent', 1500, null, array['Shawarma']::text[], 2085),
  ('a rupee discount groups by its per-unit amount, not its line total', 0, 'amount', null, 2000, array['Shawarma', 'Drinks']::text[], 8000),
  ('a percentage and a rupee discount are never one row', 0, 'amount', null, 2000, array['Shawarma']::text[], 2000),
  ('a percentage and a rupee discount are never one row', 1, 'percent', 1000, null, array['Drinks']::text[], 990),
  ('a fractional percentage keeps its basis points and its exact paise', 0, 'percent', 750, null, array['Shawarma']::text[], 1043),
  ('a line with no category still carries its reduction', 0, 'percent', 1000, null, array[]::text[], 1390);
-- END GENERATED DISCOUNT ROW EXPECTATIONS

-- ---------------------------------------------------------------------------
-- Ring each case as a real bill and read its receipt back.
--
-- Written as rows in one transaction, because the deferred guards -- payments
-- equalling the total, discount parts equalling the whole -- are satisfied only
-- once every statement of the write has been made. That is also why this cannot
-- be a REST test: over PostgREST each statement is its own transaction.

create function pg_temp.ring_case(p_case text, p_bill_discount bigint default 0)
returns uuid language plpgsql as $$
declare
  v_bill uuid := gen_random_uuid();
  v_subtotal bigint;
  v_line_discount bigint;
  v_discount bigint;
  v_net bigint;
  v_total bigint;
  v_rounding bigint;
begin
  select
    coalesce(sum(unit_price_paise * quantity), 0),
    coalesce(sum(discount_paise), 0)
    into v_subtotal, v_line_discount
    from pg_temp.discount_row_cases where case_name = p_case;

  v_discount := v_line_discount + p_bill_discount;
  v_net := v_subtotal - v_discount;
  -- The floor and the round-up exactly as `billTotals()` defines them: never
  -- below one rupee, always a whole rupee, and the rounding is what carried it
  -- there. Computed here so the fixture is a bill the database accepts; every
  -- assertion below still reads the stored column back rather than this.
  v_total := greatest(100, ceil(v_net::numeric / 100)::bigint * 100);
  v_rounding := v_total - v_net;

  perform set_config('app.billing_command', '1', true);

  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise, payment_method, created_at)
  values (
    v_bill, pg_temp.kalyani(), 0, current_date,
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    v_subtotal, v_discount, 0, v_rounding, v_total, 'cash', now());

  insert into public.bill_items (
    id, bill_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise, discount_percent_bp, category_name)
  select
    gen_random_uuid(), v_bill, item_name, unit_price_paise, quantity,
    unit_price_paise * quantity, discount_paise, discount_percent_bp,
    category_name
  from pg_temp.discount_row_cases where case_name = p_case order by line_no;

  if p_bill_discount > 0 then
    insert into public.bill_discounts (bill_id, outlet_id, basis, value_paise, amount_paise)
    values (v_bill, pg_temp.kalyani(), 'amount', p_bill_discount, p_bill_discount);
  end if;

  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
  values (v_bill, pg_temp.kalyani(), 'cash', v_total);

  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.billing_command', '0', true);
  return v_bill;
end;
$$;

-- The menu rows the database produces for one case, shaped to compare against
-- the expectation table row for row.
--
-- **Category order inside a row is deliberately not part of the shared rule.**
-- The counter lists them in the order its draft's lines carried them; the
-- receipt has no such order to preserve, because a settled bill's lines are
-- listed by name, not by the sequence somebody tapped them in months ago. There
-- is no single order both can implement, and which of two category names comes
-- first in a subtext is not a fact about money. So both sides are compared with
-- categories sorted, and everything that *is* a fact about money -- which
-- categories, at which value, for how many paise, in how many rows -- is
-- compared exactly.
create function pg_temp.sorted_categories(p_row jsonb) returns jsonb language sql as $$
  select p_row || jsonb_build_object(
    'categories',
    coalesce((select jsonb_agg(c order by c)
                from jsonb_array_elements_text(p_row -> 'categories') as c),
             '[]'::jsonb))
$$;

create function pg_temp.menu_rows(p_bill uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(pg_temp.sorted_categories(row) order by ordinality), '[]'::jsonb)
    from jsonb_array_elements(public.bill_public_discount_rows(p_bill))
      with ordinality as t(row, ordinality)
   where row ->> 'source' = 'menu'
$$;

create function pg_temp.expected_rows(p_case text) returns jsonb language sql as $$
  select coalesce(
    jsonb_agg(pg_temp.sorted_categories(jsonb_build_object(
      'source', 'menu',
      'basis', basis,
      'value_bp', value_bp,
      'value_paise', value_paise,
      'categories', to_jsonb(categories),
      'amount_paise', amount_paise)) order by row_no),
    '[]'::jsonb)
  from pg_temp.discount_row_expected where case_name = p_case
$$;

do $$
declare
  r record;
  v_bill uuid;
  v_got jsonb;
  v_want jsonb;
begin
  for r in select distinct case_name from pg_temp.discount_row_cases order by 1 loop
    v_bill := pg_temp.ring_case(r.case_name);
    v_got := pg_temp.menu_rows(v_bill);
    v_want := pg_temp.expected_rows(r.case_name);
    if v_got is distinct from v_want then
      raise exception
        'case "%": the database grouped % but the shared table expects %',
        r.case_name, v_got, v_want;
    end if;
  end loop;
end;
$$;

select pass('the database groups every shared case exactly as groupMenuDiscounts() does');

-- ---------------------------------------------------------------------------
-- Every figure is the stored one.
--
-- Read back column by column, so a receipt that recomputed anything -- even
-- correctly, even once -- would still have to agree with what the bill holds.

do $$
declare
  v_bill uuid;
  v_token text;
  v_receipt jsonb;
  b record;
begin
  v_bill := pg_temp.ring_case('one percentage over two categories combines into one row', 5000);
  select token into v_token from public.bill_public_links where bill_id = v_bill;
  v_receipt := public.bill_public_receipt(v_token);

  select * into b from public.bills where id = v_bill;

  if v_receipt -> 'totals' is distinct from jsonb_build_object(
       'subtotal_paise', b.subtotal_paise,
       'discount_paise', b.discount_paise,
       'tax_paise', b.tax_paise,
       'rounding_paise', b.rounding_paise,
       'total_paise', b.total_paise)
  then
    raise exception 'the receipt totals are not the stored columns: % vs bill %',
      v_receipt -> 'totals', to_jsonb(b);
  end if;

  -- Each line, at the list price it snapshotted.
  if v_receipt -> 'lines' is distinct from (
       select jsonb_agg(jsonb_build_object(
                'item_name', i.item_name,
                'quantity', i.quantity,
                'unit_price_paise', i.unit_price_paise,
                'line_total_paise', i.line_total_paise)
              order by i.item_name)
         from public.bill_items i where i.bill_id = v_bill)
  then
    raise exception 'the receipt lines are not the stored lines';
  end if;

  -- The printed rows add up to the discount the bill stored. If they did not,
  -- the page would be disagreeing with the money while looking plausible.
  if (select sum((row ->> 'amount_paise')::bigint)
        from jsonb_array_elements(v_receipt -> 'discount_rows') as row)
     is distinct from b.discount_paise
  then
    raise exception 'the printed discount rows do not sum to the stored discount';
  end if;
end;
$$;

select pass('every figure the receipt prints is the column it came from');

-- ---------------------------------------------------------------------------
-- The one rupee floor.
--
-- A fully discounted meal is a one rupee bill, and the receipt must render that
-- as the honest set of figures it is rather than as a rendering fault: the
-- giveaway, the rounding that carried it to a rupee, and a one rupee total.

do $$
declare
  v_bill uuid := gen_random_uuid();
  v_token text;
  v_receipt jsonb;
begin
  perform set_config('app.billing_command', '1', true);

  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise, payment_method, created_at)
  values (
    v_bill, pg_temp.kalyani(), 0, current_date,
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    13900, 13900, 0, 100, 100, 'cash', now());

  insert into public.bill_items (
    id, bill_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise, discount_percent_bp, category_name)
  values (
    gen_random_uuid(), v_bill, 'Classic Chicken Shawarma', 13900, 1, 13900,
    13900, 10000, 'Shawarma');

  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
  values (v_bill, pg_temp.kalyani(), 'cash', 100);

  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.billing_command', '0', true);

  select token into v_token from public.bill_public_links where bill_id = v_bill;
  v_receipt := public.bill_public_receipt(v_token);

  if (v_receipt -> 'totals' ->> 'total_paise')::bigint <> 100 then
    raise exception 'a fully discounted bill did not read as one rupee';
  end if;
  if (v_receipt -> 'totals' ->> 'discount_paise')::bigint <> 13900 then
    raise exception 'the giveaway is not shown in full';
  end if;
  if (v_receipt -> 'totals' ->> 'rounding_paise')::bigint <> 100 then
    raise exception 'the rounding that carried it to a rupee is not shown';
  end if;
  if (v_receipt -> 'discount_rows' -> 0 ->> 'amount_paise')::bigint <> 13900 then
    raise exception 'the discount row does not carry the whole giveaway';
  end if;
end;
$$;

select pass('a fully discounted meal reads as a giveaway, a round-up and a one rupee total');

-- ---------------------------------------------------------------------------
-- Cancelled, and corrected, both from a live read.
--
-- Nothing is stored as a file, and this is the second reason: a bill voided an
-- hour after the link was sent must say so rather than presenting a
-- valid-looking receipt.

do $$
declare
  v_bill uuid;
  v_token text;
  v_receipt jsonb;
begin
  v_bill := pg_temp.ring_case('one percentage over one category');
  select token into v_token from public.bill_public_links where bill_id = v_bill;

  if public.bill_public_receipt(v_token) ->> 'status' <> 'settled' then
    raise exception 'a settled bill did not read settled before the void';
  end if;

  update public.bills
     set status = 'void',
         voided_at = now(),
         voided_by = '10000000-0000-4000-a000-000000000002',
         void_reason = 'Rung twice by mistake'
   where id = v_bill;

  v_receipt := public.bill_public_receipt(v_token);

  -- The same link, unchanged and unrevoked, now reporting the cancellation.
  if v_receipt is null then
    raise exception 'a voided bill refused its own link instead of reporting the cancellation';
  end if;
  if v_receipt ->> 'status' <> 'void' then
    raise exception 'a voided bill did not read as cancelled: %', v_receipt ->> 'status';
  end if;
  if v_receipt ->> 'void_reason' is null then
    raise exception 'the cancellation carries no reason';
  end if;
end;
$$;

select pass('a bill voided after its link was sent reads as cancelled, on the same link');

do $$
declare
  v_bill uuid;
  v_token text;
  v_before jsonb;
  v_after jsonb;
  v_total bigint;
  v_command uuid := gen_random_uuid();
  v_correction uuid := gen_random_uuid();
begin
  v_bill := pg_temp.ring_case('two different percentages get a row each');
  select token into v_token from public.bill_public_links where bill_id = v_bill;
  select total_paise into v_total from public.bills where id = v_bill;

  v_before := public.bill_public_receipt(v_token) -> 'payments';

  -- The correction, written the way the database writes one: a **new revision
  -- appended**, never a rewrite. `bill_payments` is immutable, which is the
  -- point -- the original split survives, and a receipt reading that table
  -- directly would serve a customer the allocation that was corrected away.
  perform set_config('app.billing_command', '1', true);

  insert into public.billing_commands (
    id, outlet_id, device_id, shift_id, actor_id, command_type, schema_version,
    payload_hash, client_created_at, result_category)
  values (
    v_command, pg_temp.kalyani(),
    '10000000-0000-4000-a000-000000000004',
    '90000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-00000000000a',
    'correct_bill_payment', 1, repeat('0', 64), now(), 'accepted');

  insert into public.bill_payment_corrections (
    id, command_id, bill_id, outlet_id, device_id, shift_id, actor_id, revision,
    client_created_at)
  values (
    v_correction, v_command, v_bill, pg_temp.kalyani(),
    '10000000-0000-4000-a000-000000000004',
    '90000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-00000000000a', 1, now());

  insert into public.bill_payment_correction_allocations (
    correction_id, outlet_id, method, amount_paise)
  values (v_correction, pg_temp.kalyani(), 'cash', v_total - 500),
         (v_correction, pg_temp.kalyani(), 'upi', 500);

  perform set_config('app.billing_command', '0', true);

  v_after := public.bill_public_receipt(v_token) -> 'payments';

  if v_after = v_before then
    raise exception 'the receipt served the old tender split after a correction';
  end if;
  if jsonb_array_length(v_after) <> 2 then
    raise exception 'the corrected split is not both allocations: %', v_after;
  end if;
  if (select sum((p ->> 'amount_paise')::bigint)
        from jsonb_array_elements(v_after) as p) <> v_total
  then
    raise exception 'the corrected allocations do not sum to the bill total';
  end if;
end;
$$;

select pass('a corrected tender split is served as the corrected one, on the same link');

-- ---------------------------------------------------------------------------
-- Nothing resembling a tax invoice, across every case rather than one.

do $$
declare
  r record;
  v_bill uuid;
  v_receipt text;
begin
  for r in select distinct case_name from pg_temp.discount_row_cases order by 1 loop
    v_bill := pg_temp.ring_case(r.case_name);
    select public.bill_public_receipt(token)::text into v_receipt
      from public.bill_public_links where bill_id = v_bill;

    if v_receipt ilike '%gstin%' or v_receipt ilike '%invoice%'
       or v_receipt ilike '%hsn%' or v_receipt ilike '%cgst%'
    then
      raise exception 'case "%" produced something resembling a tax invoice', r.case_name;
    end if;
    -- Every bill is recorded `no_tax`, and the receipt says nothing else.
    if (select (public.bill_public_receipt(token) -> 'totals' ->> 'tax_paise')::bigint
          from public.bill_public_links where bill_id = v_bill) <> 0
    then
      raise exception 'case "%" reported a tax figure', r.case_name;
    end if;
  end loop;
end;
$$;

select pass('no case produces a GSTIN, a tax breakup or a nonzero tax line');

select * from finish();
rollback;
