-- the-ledger-reads-fast-and-keeps-its-place: the two server reads the ledger
-- now makes in place of many client ones.
--
-- The fixture is the ledger spec's own worked example, placed in March 2026 so
-- nothing else in the seed reaches it: ₹2,000 anchored at 04:00 on 1 March
-- exactly (which also pins the anchor boundary), then on 2 March a ₹1,000 cash
-- sale, a ₹300 cash expense, a 22:00 count of ₹2,700 with ₹1,250 collected —
-- ₹1,450 left — and a ₹2,054 cash sale at 23:00, so the drawer closes at ₹3,504.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end $$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set MANAGER_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Bills, each with its allocations. The last is a split with a discount, so the
-- per-bill sums and the discount are both read.
create temp table fixture_bills (
  business_day date, at_time timestamptz, subtotal bigint, discount bigint,
  cash bigint, upi bigint
) on commit drop;
insert into fixture_bills values
  ('2026-02-28', '2026-02-28 20:00:00+05:30', 10000, 0, 10000, 0),
  ('2026-03-02', '2026-03-02 12:00:00+05:30', 100000, 0, 100000, 0),
  ('2026-03-02', '2026-03-02 23:00:00+05:30', 205400, 0, 205400, 0),
  ('2026-03-03', '2026-03-03 13:00:00+05:30', 15000, 1100, 10000, 3900);

with inserted as (
  insert into public.bills
    (id, outlet_id, business_date, biller_profile_id, counter_device_id,
     subtotal_paise, discount_paise, total_paise, payment_method, status, created_at)
  select gen_random_uuid(), :'KAL', business_day, :'BILLER_KAL'::uuid,
    '10000000-0000-4000-a000-000000000004'::uuid,
    subtotal, discount, subtotal - discount, 'cash', 'settled', at_time
  from fixture_bills
  returning id, outlet_id, paid_at, created_at
)
insert into public.bill_payments (bill_id, outlet_id, method, amount_paise, created_at)
select i.id, i.outlet_id, m.method::public.payment_method, m.amount, i.paid_at
  from inserted i
  join fixture_bills f on f.at_time = i.created_at
  cross join lateral (values ('cash', f.cash), ('upi', f.upi)) as m(method, amount)
 where m.amount > 0;

insert into public.expenses
  (outlet_id, business_date, is_cash, amount_paise, category, description, occurred_at, recorded_by)
values
  (:'KAL', '2026-03-02', true, 30000, 'Gas', null, '2026-03-02 18:10:00+05:30', :'OWNER'),
  (:'KAL', '2026-03-02', false, 5000, 'Gas', 'Cylinder x2', '2026-03-02 09:00:00+05:30', :'OWNER');

insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin, as_of_at)
values
  (:'KAL', 'zomato', '2026-03-02', 100000, 20000, 80000, 'settled', 'settlement',
   '2026-03-09 11:00:00+05:30'),
  (:'KAL', 'swiggy', '2026-03-02', 60000, null, null, 'provisional', 'daily_reader',
   '2026-03-03 23:00:00+05:30');

-- The counts, through the command, because no client writes the table.
select pg_temp.impersonate(:'OWNER');
select lives_ok($$select public.record_drawer_observation(
  '00000000-0000-4000-a000-000000000001', '2026-03-01 04:00:00+05:30', 200000,
  p_away_reason => 'fixture')$$, 'the anchor is recorded at the cutover exactly');
select lives_ok($$select public.record_drawer_observation(
  '00000000-0000-4000-a000-000000000001', '2026-03-02 22:00:00+05:30', 270000,
  p_away_reason => 'fixture', p_cash_out_paise => 125000)$$,
  'the evening count is recorded with its collection');

-- ── The balance at an instant ────────────────────────────────────────────────
select is(ledger_drawer_balance_at(:'KAL', '2026-03-01 03:59:59+05:30'), null::bigint,
  'before the first observation there is no balance to state');
select is(ledger_drawer_balance_at(:'KAL', '2026-03-01 04:00:00+05:30'), 200000::bigint,
  'an observation at the instant is the balance at it');
select is(ledger_drawer_balance_at(:'KAL', '2026-03-02 04:00:00+05:30'), 200000::bigint,
  'the opening of 2 March is the anchor, nothing having moved since');
select is(ledger_drawer_balance_at(:'KAL', '2026-03-02 22:00:00+05:30'), 145000::bigint,
  'at the count the drawer holds what was left, ₹1,450');
select is(ledger_drawer_balance_at(:'KAL', '2026-03-03 04:00:00+05:30'), 350400::bigint,
  'the close is ₹3,504: the collection is taken once, and trade after the count adds to what was left');
select is(ledger_drawer_balance_at(:'KPA', '2026-03-03 04:00:00+05:30'), null::bigint,
  'the other outlet has no drawer in this fixture');

-- ── The month's inputs ───────────────────────────────────────────────────────
select is(jsonb_array_length(ledger_month_inputs(:'KAL', '2026-03-17')), 31,
  'one element per date, from any date inside the month');
select is(jsonb_array_length(ledger_month_inputs(:'KAL', '2026-04-01')), 30, 'a thirty-day month');
select is(jsonb_array_length(ledger_month_inputs(:'KAL', '2026-02-01')), 28, 'February');
select is(jsonb_array_length(ledger_month_inputs(:'KAL', '2028-02-01')), 29, 'a leap February');

select is(ledger_month_inputs(:'KAL', '2026-03-01')->0,
  '{"businessDate":"2026-03-01","cashPaise":0,"upiPaise":0,"discountPaise":0,
    "channels":[],"expenses":[],"drawerState":"counted"}'::jsonb,
  'an anchor at 04:00 exactly counts its own date, which otherwise holds nothing');

select is(ledger_month_inputs(:'KAL', '2026-03-01')->1,
  jsonb_build_object(
    'businessDate', '2026-03-02', 'cashPaise', 305400, 'upiPaise', 0, 'discountPaise', 0,
    'channels', jsonb_build_array(
      jsonb_build_object('channel', 'swiggy', 'grossPaise', 60000, 'commissionPaise', null,
        'netPaise', null, 'asOfAt', '2026-03-03 23:00:00+05:30'::timestamptz),
      jsonb_build_object('channel', 'zomato', 'grossPaise', 100000, 'commissionPaise', 20000,
        'netPaise', 80000, 'asOfAt', '2026-03-09 11:00:00+05:30'::timestamptz)),
    'expenses', jsonb_build_array(
      jsonb_build_object('businessDate', '2026-03-02', 'category', 'Gas', 'note', 'Cylinder x2',
        'amountPaise', 5000, 'isCash', false),
      jsonb_build_object('businessDate', '2026-03-02', 'category', 'Gas', 'note', null,
        'amountPaise', 30000, 'isCash', true)),
    'drawerState', 'counted'),
  'the worked day: both cash sales, channels by name with an unstated commission left null, expenses in instant order with a note only where it says more');

select is(ledger_month_inputs(:'KAL', '2026-03-01')->2,
  '{"businessDate":"2026-03-03","cashPaise":10000,"upiPaise":3900,"discountPaise":1100,
    "channels":[],"expenses":[],"drawerState":"carried"}'::jsonb,
  'a split bill counts each method, its discount is reported, and an uncounted date after the anchor is carried');

select is(ledger_month_inputs(:'KAL', '2026-02-01')->27->>'drawerState', 'not-tracked-yet',
  'the date whose close is the anchor instant is before the drawer was tracked');
select is((ledger_month_inputs(:'KAL', '2026-02-01')->27->>'cashPaise')::bigint, 10000::bigint,
  'and its sale is still reported');
select is(ledger_month_inputs(:'KPA', '2026-03-01')->1->>'drawerState', 'not-tracked-yet',
  'nothing of one outlet reaches the other');
select is((ledger_month_inputs(:'KPA', '2026-03-01')->1->>'cashPaise')::bigint, 0::bigint,
  'not even its takings');

-- ── Who may ask ──────────────────────────────────────────────────────────────
select pg_temp.impersonate(:'MANAGER_KAL');
select lives_ok(format('select ledger_month_inputs(%L, %L)', :'KAL', '2026-03-01'),
  'a Franchise Admin reads the month at their own outlet');
select lives_ok(format('select ledger_drawer_balance_at(%L, now())', :'KAL'),
  'and the balance');
select throws_ok(format('select ledger_month_inputs(%L, %L)', :'KPA', '2026-03-01'),
  '42501', 'may not read the ledger at this outlet',
  'another outlet''s month is refused, not answered empty');
select throws_ok(format('select ledger_drawer_balance_at(%L, now())', :'KPA'),
  '42501', 'may not read the ledger at this outlet', 'and so is its balance');

select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok(format('select ledger_month_inputs(%L, %L)', :'KAL', '2026-03-01'),
  '42501', 'may not read the ledger at this outlet', 'a Biller is refused at their own outlet');
select throws_ok(format('select ledger_drawer_balance_at(%L, now())', :'KAL'),
  '42501', 'may not read the ledger at this outlet', 'the balance too');

select pg_temp.impersonate(:'EMPLOYEE_KAL');
select throws_ok(format('select ledger_month_inputs(%L, %L)', :'KAL', '2026-03-01'),
  '42501', 'may not read the ledger at this outlet', 'an Employee is refused at their own outlet');
select throws_ok(format('select ledger_drawer_balance_at(%L, now())', :'KAL'),
  '42501', 'may not read the ledger at this outlet', 'the balance too');

select pg_temp.impersonate(:'OWNER');
select lives_ok(format('select ledger_month_inputs(%L, %L)', :'KPA', '2026-03-01'),
  'the owner reads every outlet');

reset role;
select * from finish();
rollback;
