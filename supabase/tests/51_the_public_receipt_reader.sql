-- The public receipt reader: one token in, one receipt out, and no door.
--
-- This is the first unauthenticated reader in the system, so what is asserted
-- here is mostly what it *cannot* do. It takes a token and nothing that could
-- name another bill. It refuses unknown, malformed, revoked and switched-off in
-- one and the same way, so a caller learns nothing from which refusal they got.
-- It never returns a customer's name or their whole phone number, and that
-- omission is the function's own projection rather than a page choosing not to
-- render them: since #58 it returns the last four digits and gold at this
-- outlet, and only for a bill with a customer attached. And
-- `anon` gains no grant on anything, token or no token -- the credential is the
-- service role, held by the Worker, server-side.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- A bill is filed under the outlet's business date, never `current_date`: that is
-- the UTC calendar date, which trails the Kolkata trading day from the 04:00 IST
-- cutover to UTC midnight, and the database refuses a bill whose date and
-- timestamp disagree.
--
-- The cutover is read once, here, while the session is still privileged: a test
-- impersonating another outlet's tablet cannot see Kalyani's row, and a helper
-- that looked it up on every call would quietly return null.
do $do$ begin
  execute format(
    'create function pg_temp.business_today() returns date language sql stable as %L',
    format('select public.app_business_date(now(), %L::time)',
      (select business_day_cutover from public.outlets
        where id = '00000000-0000-4000-a000-000000000001')));
end $do$;

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

create function pg_temp.as_service()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

create function pg_temp.kalyani() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------
-- A bill worth reading: two lines, a menu discount over one category, a bill
-- discount, a round-up, and a split tender. Everything the receipt must say
-- appears on exactly one bill so a single call proves the whole projection.
--
--   two lines           139.00 + 99.00      = 238.00
--   menu 15% on line 1  -20.85
--   bill discount ~50   -50.00
--   net                                       167.15
--   round up            +0.85                = 168.00

create function pg_temp.a_readable_bill() returns uuid language plpgsql as $$
declare
  v_bill uuid := gen_random_uuid();
begin
  perform set_config('app.billing_command', '1', true);

  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, customer_id, customer_name, customer_phone,
    subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise,
    payment_method, created_at, ordered_at, paid_at, payment_business_date)
  values (
    v_bill, pg_temp.kalyani(), 0, pg_temp.business_today(),
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    '80000000-0000-4000-a000-000000000001',
    'Ravi Placeholder', '+919000000042',
    23800, 7085, 0, 85, 16800, null,
    -- A command-written bill is dated by ordered_at, so every clock on it is
    -- stamped with the one instant its business date was built from.
    (pg_temp.business_today() + time '13:05') at time zone 'Asia/Kolkata',
    (pg_temp.business_today() + time '13:05') at time zone 'Asia/Kolkata',
    (pg_temp.business_today() + time '13:05') at time zone 'Asia/Kolkata',
    pg_temp.business_today());

  insert into public.bill_items (
    id, bill_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise, discount_percent_bp, category_name)
  values
    (gen_random_uuid(), v_bill, 'Classic Chicken Shawarma', 13900, 1, 13900,
     2085, 1500, 'Shawarma'),
    (gen_random_uuid(), v_bill, 'Cold Coffee', 9900, 1, 9900, 0, null, 'Drinks');

  insert into public.bill_discounts (bill_id, outlet_id, basis, value_paise, amount_paise)
  values (v_bill, pg_temp.kalyani(), 'amount', 5000, 5000);

  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
  values (v_bill, pg_temp.kalyani(), 'cash', 10000),
         (v_bill, pg_temp.kalyani(), 'upi', 6800);

  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.billing_command', '0', true);
  return v_bill;
end;
$$;

create function pg_temp.token_of(p_bill uuid) returns text language sql as
  $$ select token from public.bill_public_links where bill_id = p_bill $$;

select pg_temp.as_service();

create temporary table t (bill uuid, token text);
insert into t select b, pg_temp.token_of(b) from pg_temp.a_readable_bill() b;

create function pg_temp.receipt() returns jsonb language sql as
  $$ select public.bill_public_receipt((select token from t)) $$;

-- ---------------------------------------------------------------------------
-- One token in, one receipt out.

select isnt(pg_temp.receipt(), null, 'a valid token returns a receipt');

select is(
  pg_temp.receipt() -> 'outlet' ->> 'name',
  (select name from public.outlets where id = pg_temp.kalyani()),
  'the receipt names the outlet the bill was rung at');

select is(
  (pg_temp.receipt() ->> 'business_date')::date,
  pg_temp.business_today(),
  'the receipt carries the business date the bill stored');

select isnt(pg_temp.receipt() ->> 'sold_at', null,
  'the receipt carries the time of sale');

select is(
  (pg_temp.receipt() ->> 'bill_number')::bigint,
  (select bill_number from public.bills where id = (select bill from t)),
  'the receipt carries the bill number the database assigned');

select is(pg_temp.receipt() ->> 'status', 'settled',
  'a settled bill reads settled');

-- ---------------------------------------------------------------------------
-- It names no customer. Not the customer, and not anybody else either.
--
-- Asserted over the whole serialised receipt rather than field by field,
-- because the risk is a field nobody thought to check.

select is(
  (select count(*) from jsonb_each_text(pg_temp.receipt())
    where key in ('customer_name', 'customer_phone', 'customer_id')),
  0::bigint,
  'no customer field appears at the top level of the receipt');

select ok(
  pg_temp.receipt()::text not like '%Ravi Placeholder%',
  'the customer name appears nowhere in the receipt, at any depth');

select ok(
  pg_temp.receipt()::text not like '%9000000042%',
  'the customer phone appears nowhere in the receipt, in any form');

select ok(
  pg_temp.receipt()::text not like '%80000000-0000-4000-a000-000000000001%',
  'the customer identifier appears nowhere in the receipt');

-- Nor the biller, the manager or the till: the receipt identifies no person at
-- all, on either side of the counter.
select ok(
  pg_temp.receipt()::text not like '%10000000-0000-4000-a000-00000000000a%'
  and pg_temp.receipt()::text not like '%Synthetic Biller%'
  and pg_temp.receipt()::text not like '%10000000-0000-4000-a000-000000000004%',
  'the receipt identifies neither the biller nor the till');

-- ---------------------------------------------------------------------------
-- What it says of its customer: the last four digits, and gold at this outlet.
-- Never the name, never the rest of the number (the-receipt-says-its-yours, #58).
--
-- Both facts appear only on a bill with a customer attached. Every bill rung
-- before #56 has a typed name and sometimes a typed phone, and no customer, so
-- the condition is the link and not a date.

select is(pg_temp.receipt() ->> 'phone_last4', '0042',
  'a bill with a customer carries the last four digits of the number it recorded');

select ok(
  pg_temp.receipt()::text not like '%900000%'
  and pg_temp.receipt()::text not like '%+91%',
  'no other digit of the number, and not its country code, appears anywhere');

-- The landing Worker refuses a payload carrying any of these keys, whatever the
-- value. None may appear, or every receipt and counter pop-up is refused.
select is(
  (select count(*) from jsonb_each(pg_temp.receipt())
    where key in ('customer', 'customer_name', 'customer_phone', 'customer_id',
                  'biller_name', 'biller_profile_id')),
  0::bigint,
  'no key the landing tripwire refuses appears in the receipt');

select is((pg_temp.receipt() ->> 'gold_at_outlet')::boolean, false,
  'a customer who is not gold here is not marked gold');

-- One more bill, shaped by its arguments: a line, a cash tender, and whatever
-- customer facts and service the case needs.
create function pg_temp.a_bill(
  p_customer uuid, p_name text, p_phone text,
  p_service public.service_type default null, p_table smallint default null)
returns uuid language plpgsql as $$
declare
  v_bill uuid := gen_random_uuid();
  v_at timestamptz := (pg_temp.business_today() + time '13:05') at time zone 'Asia/Kolkata';
begin
  perform set_config('app.billing_command', '1', true);
  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, customer_id, customer_name, customer_phone,
    subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise,
    payment_method, created_at, ordered_at, paid_at, payment_business_date,
    service_type, table_number)
  values (
    v_bill, pg_temp.kalyani(), 0, pg_temp.business_today(),
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    p_customer, p_name, p_phone,
    9900, 0, 0, 0, 9900, 'cash', v_at, v_at, v_at, pg_temp.business_today(),
    p_service, p_table);
  insert into public.bill_items (
    id, bill_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise, discount_percent_bp, category_name)
  values (gen_random_uuid(), v_bill, 'Cold Coffee', 9900, 1, 9900, 0, null, 'Drinks');
  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
  values (v_bill, pg_temp.kalyani(), 'cash', 9900);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.billing_command', '0', true);
  return v_bill;
end;
$$;

create function pg_temp.receipt_of(p_bill uuid) returns jsonb language sql as
  $$ select public.bill_public_receipt(pg_temp.token_of(p_bill)) $$;

-- The pre-#56 shape: a typed name and a typed phone, and no customer.
create temporary table legacy as
  select pg_temp.a_bill(null, 'As', '9000000077') as bill;

select is(pg_temp.receipt_of((select bill from legacy)) ->> 'phone_last4', null,
  'a bill with a typed phone and no customer shows no digits');

select is((pg_temp.receipt_of((select bill from legacy)) ->> 'gold_at_outlet')::boolean, false,
  'a bill with no customer is never marked gold');

select ok(
  pg_temp.receipt_of((select bill from legacy))::text not like '%0077%'
  and pg_temp.receipt_of((select bill from legacy))::text not like '%"As"%',
  'neither the typed name nor any digit of the typed phone reaches the payload');

-- A skipped sale: no customer facts at all.
create temporary table skipped as select pg_temp.a_bill(null, null, null) as bill;

select is(pg_temp.receipt_of((select bill from skipped)) ->> 'phone_last4', null,
  'a skipped bill shows no digits');

-- Gold is the bill's own snapshot, at the bill's own outlet.
update public.outlets set gold_enabled = true where id = pg_temp.kalyani();

insert into public.customers (id, phone, name)
values ('80000000-0000-4000-a000-0000000005a1', '+919000005801', 'Gold Placeholder'),
       ('80000000-0000-4000-a000-0000000005a2', '+919000005802', 'Elsewhere Placeholder');

insert into public.customer_memberships
  (customer_id, outlet_id, granted_at, granted_by, expires_at)
values
  ('80000000-0000-4000-a000-0000000005a1', pg_temp.kalyani(),
   now() - interval '1 day', '10000000-0000-4000-a000-000000000001',
   now() + interval '30 days'),
  -- Gold, but at the other outlet.
  ('80000000-0000-4000-a000-0000000005a2', '00000000-0000-4000-a000-000000000002',
   now() - interval '1 day', '10000000-0000-4000-a000-000000000001',
   now() + interval '30 days');

create temporary table golden as
  select pg_temp.a_bill('80000000-0000-4000-a000-0000000005a1',
                        'Gold Placeholder', '+919000005801') as bill;
create temporary table elsewhere as
  select pg_temp.a_bill('80000000-0000-4000-a000-0000000005a2',
                        'Elsewhere Placeholder', '+919000005802') as bill;

select is((pg_temp.receipt_of((select bill from golden)) ->> 'gold_at_outlet')::boolean, true,
  'a bill rung while its customer was gold here is marked gold');

select is(pg_temp.receipt_of((select bill from golden)) ->> 'phone_last4', '5801',
  'a gold member''s receipt carries their last four digits too');

select ok(
  pg_temp.receipt_of((select bill from golden))::text not like '%Gold Placeholder%',
  'a gold member''s name appears nowhere in the receipt');

select is((pg_temp.receipt_of((select bill from elsewhere)) ->> 'gold_at_outlet')::boolean, false,
  'a customer gold only at another outlet is not marked gold here');

update public.customer_memberships
   set revoked_at = now(), revoked_by = '10000000-0000-4000-a000-000000000001'
 where customer_id = '80000000-0000-4000-a000-0000000005a1';

select is((pg_temp.receipt_of((select bill from golden)) ->> 'gold_at_outlet')::boolean, true,
  'revoking gold afterwards does not rewrite the receipt');

-- ---------------------------------------------------------------------------
-- Dine-in or takeaway, as the bill stored it (#60), and never the table: a table
-- is a label for the length of a meal, like the order number [owner, 2026-09-30].

create temporary table served as
  select pg_temp.a_bill(null, null, null, 'dine_in', 4::smallint) as table_bill,
         pg_temp.a_bill(null, null, null, 'dine_in', null) as dine_bill,
         pg_temp.a_bill(null, null, null, 'takeaway', null) as takeaway_bill;

select is(
  pg_temp.receipt_of((select table_bill from served)) -> 'service_type', '"dine_in"'::jsonb,
  'a dine-in bill says dine-in');

select ok(
  not (pg_temp.receipt_of((select table_bill from served)) ? 'table_number'),
  'a dine-in bill at a table does not carry its table');

select ok(
  pg_temp.receipt_of((select table_bill from served))::text not like '%"table%',
  'no table appears anywhere in the receipt');

select is(
  pg_temp.receipt_of((select dine_bill from served)) -> 'service_type', '"dine_in"'::jsonb,
  'a dine-in bill with no table says dine-in too');

select is(
  pg_temp.receipt_of((select takeaway_bill from served)) ->> 'service_type', 'takeaway',
  'a takeaway bill says takeaway');

select is(
  pg_temp.receipt_of((select bill from skipped)) -> 'service_type', 'null'::jsonb,
  'a bill that recorded neither says nothing about service');

-- ---------------------------------------------------------------------------
-- What was charged, exactly as it was stored.

select is(
  jsonb_array_length(pg_temp.receipt() -> 'lines'), 2,
  'both lines are returned');

select is(
  pg_temp.receipt() -> 'lines' -> 0 -> 'unit_price_paise',
  to_jsonb(13900),
  'a discounted line reports the list price it snapshotted, not a reduced one');

select is(
  pg_temp.receipt() -> 'totals',
  jsonb_build_object(
    'subtotal_paise', 23800,
    'discount_paise', 7085,
    'tax_paise', 0,
    'rounding_paise', 85,
    'total_paise', 16800),
  'every total is the stored column, unrecomputed');

-- The discount rows the page prints, grouped by the database so the page does
-- no arithmetic of its own. A menu row per value with the categories it
-- covered, then a row per bill-level discount.
select is(
  pg_temp.receipt() -> 'discount_rows',
  jsonb_build_array(
    jsonb_build_object(
      'source', 'menu', 'basis', 'percent', 'value_bp', 1500, 'value_paise', null,
      'categories', jsonb_build_array('Shawarma'),
      'amount_paise', 2085),
    jsonb_build_object(
      'source', 'bill', 'basis', 'amount', 'value_bp', null, 'value_paise', 5000,
      'categories', jsonb_build_array(),
      'amount_paise', 5000)),
  'each discount is its own row naming its basis, its value and what it covered');

-- The identity the receipt reproduces rather than recomputes. If the rows it
-- prints did not add up to the discount the bill stored, the page would be
-- disagreeing with the money.
select is(
  (select sum((row ->> 'amount_paise')::bigint)
     from jsonb_array_elements(pg_temp.receipt() -> 'discount_rows') as row),
  7085::numeric,
  'the printed discount rows sum to the discount the bill stored');

select is(
  pg_temp.receipt() -> 'payments',
  jsonb_build_array(
    jsonb_build_object('method', 'cash', 'amount_paise', 10000),
    jsonb_build_object('method', 'upi', 'amount_paise', 6800)),
  'a split tender is returned as both allocations with their amounts');

-- No tax line, no GSTIN, nothing resembling a tax invoice while every bill is
-- recorded no_tax.
select ok(
  pg_temp.receipt()::text not ilike '%gstin%'
  and pg_temp.receipt()::text not ilike '%invoice%',
  'the receipt carries nothing resembling a tax invoice');

-- ---------------------------------------------------------------------------
-- Every refusal is identical.
--
-- Four causes, one answer, so a caller cannot learn from the refusal whether a
-- bill exists, whether a token was ever valid, or whether the endpoint is off.

select is(public.bill_public_receipt('nosuchtoken'), null,
  'an invented token is refused');

select is(public.bill_public_receipt(''), null,
  'an empty token is refused');

select is(public.bill_public_receipt('not a token at all!!'), null,
  'a malformed token is refused');

select is(public.bill_public_receipt(null), null,
  'a null token is refused');

do $$
begin
  perform public.revoke_bill_public_link((select bill from t));
end;
$$;

select is(public.bill_public_receipt((select token from t)), null,
  'a revoked token is refused, identically to one that never existed');

-- Reissuing brings the receipt back for a customer who still needs one.
do $$
declare v_fresh text;
begin
  v_fresh := public.reissue_bill_public_link((select bill from t));
  update t set token = v_fresh;
end;
$$;

select isnt(pg_temp.receipt(), null,
  'a reissued token serves the receipt again');

-- ---------------------------------------------------------------------------
-- The kill switch, at the database, with no deploy.

update public.public_receipt_settings set enabled = false;

select is(pg_temp.receipt(), null,
  'a valid token is refused while the endpoint is switched off');

select is(public.bill_public_receipt('nosuchtoken'), null,
  'and indistinguishably from an invented one');

update public.public_receipt_settings set enabled = true;

select isnt(pg_temp.receipt(), null,
  'switching it back on restores every link at once');

-- ---------------------------------------------------------------------------
-- The reader cannot be widened.
--
-- The catalog is the assertion, because an argument that does not exist cannot
-- be passed. The function takes a token and two opaque observability values
-- that name no bill; there is no outlet, id, number, date, range or limit.

select is(
  (select string_agg(unnest, ', ' order by ordinality)
     from unnest(
       (select proargnames from pg_proc
         where oid = 'public.bill_public_receipt(text, text, text)'::regprocedure))
     with ordinality),
  'p_token, p_client_address, p_user_agent',
  'the reader takes a token and two observability values, and nothing that selects');

select is(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bill_public_receipt'),
  1::bigint,
  'there is exactly one public receipt reader, with no wider overload beside it');

-- Passing an address and a user agent cannot change which bill comes back.
select is(
  public.bill_public_receipt((select token from t), '203.0.113.9', 'curl/8'),
  pg_temp.receipt(),
  'the observability values cannot alter the receipt returned');

-- ---------------------------------------------------------------------------
-- The access record.
--
-- Written only when the token resolves. A flood of invalid tokens must not be
-- turnable into a flood of inserts -- that is an amplification the edge is
-- supposed to absorb, and a write here would hand it a lever.

truncate public.bill_public_link_views;

select is(
  (select count(*) from public.bill_public_link_views),
  0::bigint,
  'the access record starts empty for this case');

select lives_ok($$
  select public.bill_public_receipt('nosuchtoken', '203.0.113.9', 'curl/8')
  $$,
  'a request that resolves to nothing is answered');

select is(
  (select count(*) from public.bill_public_link_views),
  0::bigint,
  'and wrote nothing: an invalid token is not an insert');

select lives_ok($$
  select public.bill_public_receipt((select token from t), '203.0.113.9', 'curl/8')
  $$,
  'a request that resolves is answered');

select is(
  (select count(*) from public.bill_public_link_views),
  1::bigint,
  'and recorded exactly one access');

select is(
  (select user_agent from public.bill_public_link_views),
  'curl/8',
  'the access records the user agent it was given');

select ok(
  (select client_address_digest from public.bill_public_link_views) is not null,
  'the access records a representation of the client address');

select ok(
  (select client_address_digest from public.bill_public_link_views)
    not like '%203.0.113.9%',
  'and it is not the address itself');

-- Non-reversible, and not reversible by trying every address either: the digest
-- is salted with a value held in the settings row, so the same address digests
-- differently on another installation.
select isnt(
  (select client_address_digest from public.bill_public_link_views),
  encode(extensions.digest('203.0.113.9', 'sha256'), 'hex'),
  'the digest is salted, so it is not a bare hash of the address');

-- The same address twice digests the same, or the record could not show a
-- harvesting attempt at all.
do $$
begin
  perform public.bill_public_receipt((select token from t), '203.0.113.9', 'curl/8');
end;
$$;

select is(
  (select count(distinct client_address_digest) from public.bill_public_link_views),
  1::bigint,
  'the same address digests identically, so repeated access is visible as one client');

-- A view row cannot identify the customer, and the column list is the teeth.
-- The same treatment `customer_lookup_attempts` gets in `01_schema_coverage.sql`:
-- a catalog fact, so a later migration adding a column has to argue with this
-- line rather than slip past whichever test somebody remembered to write.
select is(
  coalesce(
    (select string_agg(a.attname, ', ' order by a.attname)
       from pg_attribute a
      where a.attrelid = 'public.bill_public_link_views'::regclass
        and a.attnum > 0 and not a.attisdropped
        and a.attname not in (
          'id', 'token', 'viewed_at', 'client_address_digest', 'user_agent')),
    ''),
  '',
  'an access row carries nothing beyond the token, the time, a digest and a user agent');

-- It records the token, not the bill, so a view row does not even name the sale.
select is(
  (select count(*) from pg_attribute a
    where a.attrelid = 'public.bill_public_link_views'::regclass
      and a.attname in ('bill_id', 'customer_id', 'customer_phone')
      and not a.attisdropped),
  0::bigint,
  'an access row names no bill and no customer');

-- ---------------------------------------------------------------------------
-- No grant for anon, anywhere, token or no token.
--
-- `01_schema_coverage.sql` sweeps the whole schema for this; these are the
-- five tables a leaked token would be aimed at, named explicitly so the claim
-- reads here too.

select ok(
  not has_table_privilege('anon', 'public.bills', 'SELECT')
  and not has_table_privilege('anon', 'public.bill_items', 'SELECT')
  and not has_table_privilege('anon', 'public.bill_payments', 'SELECT')
  and not has_table_privilege('anon', 'public.bill_discounts', 'SELECT')
  and not has_table_privilege('anon', 'public.bill_public_links', 'SELECT'),
  'the anonymous role holds no read on a bill, its lines, payments, discounts or links');

select ok(
  not has_function_privilege('anon', 'public.bill_public_receipt(text, text, text)', 'EXECUTE'),
  'the anonymous role cannot even call the reader: the Worker holds the service role');

select ok(
  not has_function_privilege('authenticated', 'public.bill_public_receipt(text, text, text)', 'EXECUTE'),
  'nor can a signed-in session, which reads bills through its own policies');

select ok(
  has_function_privilege('service_role', 'public.bill_public_receipt(text, text, text)', 'EXECUTE'),
  'the service role can, which is the one credential the Worker holds');

-- The settings row and the access record answer to nobody but the server.
select ok(
  not has_table_privilege('authenticated', 'public.public_receipt_settings', 'SELECT')
  and not has_table_privilege('anon', 'public.public_receipt_settings', 'SELECT'),
  'the kill switch and its salt are readable by no client session');

-- ---------------------------------------------------------------------------
-- Isolation for the access record: refused outright, to all three roles.
--
-- Stronger than the cross-outlet zero the matrix asserts elsewhere. Nothing in
-- the app shows a franchise admin who opened a receipt, so no role holds a
-- privilege on the record at all and there is no outlet question to answer.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($$select count(*) from public.bill_public_link_views$$,
  '42501', null, 'a franchise admin is refused the access record outright');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($$select count(*) from public.bill_public_link_views$$,
  '42501', null, 'a biller is refused the access record outright');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($$select count(*) from public.bill_public_link_views$$,
  '42501', null, 'an employee is refused the access record outright');

select pg_temp.as_service();
set local role anon;
select throws_ok($$select count(*) from public.bill_public_link_views$$,
  '42501', null, 'and the anonymous role is refused it too');
reset role;

select * from finish();
rollback;
