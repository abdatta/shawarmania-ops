-- An outlet's fixed costs, what each month of them costs, and the payments that
-- pay them (fixed-costs-are-spread-over-the-month, #79).
--
-- Three things are held here. The month's cost against the shared case table,
-- so SQL and `monthCost()` cannot drift. The pay function: a payment is an
-- expense on the day it counts in, written once however often it is retried,
-- with the answer recomputed and a choice the server would not offer refused.
-- And isolation, table by table and read by read: salaries are the owner's and
-- the manager's to see, so a policy a clause too wide passes every functional
-- test and fails only here.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

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

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.today(p_outlet uuid)
returns date language sql stable as $$
  select public.app_business_date(now(), o.business_day_cutover)
    from public.outlets o where o.id = p_outlet
$$;

create function pg_temp.this_month()
returns date language sql stable as $$
  select date_trunc('month', pg_temp.today('00000000-0000-4000-a000-000000000001')::timestamp)::date
$$;

create function pg_temp.last_month()
returns date language sql stable as $$
  select (pg_temp.this_month() - interval '1 month')::date
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set DEACTIVATED_FA_KAL '10000000-0000-4000-a000-000000000008'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

\set PAY_LATE 'f0000000-0000-4000-a000-000000000001'
\set PAY_CASH 'f0000000-0000-4000-a000-000000000002'
\set PAY_RAISE 'f0000000-0000-4000-a000-000000000003'
\set PAY_REFUSED 'f0000000-0000-4000-a000-000000000004'
\set PAY_BILLER 'f0000000-0000-4000-a000-000000000005'
\set PAY_FOREIGN 'f0000000-0000-4000-a000-000000000006'
\set LOOKALIKE 'f0000000-0000-4000-a000-000000000007'
\set KPA_EXPENSE 'f0000000-0000-4000-a000-000000000008'

-- ---------------------------------------------------------------------------
-- 1. What a month costs, held to src/domain/fixed-cost-cases.json. The block
--    is generated: `npm run lint:fixed-costs` prints it when it drifts.

create temp table month_cases (
  name text, starts_on date, stops_on date, amounts jsonb, settlements jsonb,
  month date, cost_paise bigint
) on commit drop;

insert into month_cases values
-- BEGIN GENERATED FIXED COST CASES
  ('a whole month carries over', '2026-10-01'::date, null::date,
   '[{"fromMonth":"2026-10-01","amountPaise":1000000}]'::jsonb,
   '[]'::jsonb,
   '2026-11-01'::date, 1000000::bigint),
  ('joining on the 20th of a 30-day month costs 11 of its days, rounded down', '2026-11-20'::date, null::date,
   '[{"fromMonth":"2026-11-01","amountPaise":1000000}]'::jsonb,
   '[]'::jsonb,
   '2026-11-01'::date, 366666::bigint),
  ('leaving on the 12th of a 31-day month costs 12 of its days', '2026-10-01'::date, '2026-12-12'::date,
   '[{"fromMonth":"2026-10-01","amountPaise":3100000}]'::jsonb,
   '[]'::jsonb,
   '2026-12-01'::date, 1200000::bigint),
  ('a month after the stop costs nothing', '2026-10-01'::date, '2026-12-12'::date,
   '[{"fromMonth":"2026-10-01","amountPaise":3100000}]'::jsonb,
   '[]'::jsonb,
   '2027-01-01'::date, 0::bigint),
  ('a raise applies from its month, not before', '2026-10-01'::date, null::date,
   '[{"fromMonth":"2026-10-01","amountPaise":1000000},{"fromMonth":"2026-12-01","amountPaise":1200000}]'::jsonb,
   '[]'::jsonb,
   '2026-11-01'::date, 1000000::bigint),
  ('the latest unvoided settlement is the month''s cost', '2026-10-01'::date, null::date,
   '[{"fromMonth":"2026-10-01","amountPaise":1000000}]'::jsonb,
   '[{"month":"2026-10-01","amountPaise":800000,"voided":false},{"month":"2026-10-01","amountPaise":900000,"voided":true}]'::jsonb,
   '2026-10-01'::date, 800000::bigint)
-- END GENERATED FIXED COST CASES
;

create temp table month_results (name text, expected bigint, got bigint) on commit drop;

do $$
declare
  v_case record;
  v_id uuid;
  v_row jsonb;
  v_n integer;
  v_got bigint;
begin
  for v_case in select * from month_cases loop
    -- Each case in a subtransaction, rolled back once read: the rows are
    -- scaffolding, and nothing in these tables can be deleted.
    begin
    insert into public.fixed_costs (outlet_id, name, category, starts_on, stops_on, created_by)
    values ('00000000-0000-4000-a000-000000000001', v_case.name, 'salary',
            v_case.starts_on, v_case.stops_on, '10000000-0000-4000-a000-000000000001')
    returning id into v_id;
    v_n := 0;
    for v_row in select * from jsonb_array_elements(v_case.amounts) loop
      v_n := v_n + 1;
      insert into public.fixed_cost_amounts
        (fixed_cost_id, outlet_id, from_month, amount_paise, created_by, created_at)
      values (v_id, '00000000-0000-4000-a000-000000000001', (v_row->>'fromMonth')::date,
              (v_row->>'amountPaise')::bigint, '10000000-0000-4000-a000-000000000001',
              now() + make_interval(secs => v_n));
    end loop;
    for v_row in select * from jsonb_array_elements(v_case.settlements) loop
      v_n := v_n + 1;
      insert into public.fixed_cost_settlements
        (fixed_cost_id, outlet_id, month, amount_paise, created_by, created_at,
         voided_at, voided_by)
      values (v_id, '00000000-0000-4000-a000-000000000001', (v_row->>'month')::date,
              (v_row->>'amountPaise')::bigint, '10000000-0000-4000-a000-000000000001',
              now() + make_interval(secs => v_n),
              case when (v_row->>'voided')::boolean then now() end,
              case when (v_row->>'voided')::boolean
                   then '10000000-0000-4000-a000-000000000001'::uuid end);
    end loop;
    v_got := public.fixed_cost_month_cost(v_id, v_case.month);
    raise exception 'read' using errcode = 'XFC01';
    exception when sqlstate 'XFC01' then null;
    end;
    insert into month_results values (v_case.name, v_case.cost_paise, v_got);
  end loop;
end $$;

select is(
  (select count(*) from month_results where got is distinct from expected),
  0::bigint,
  'fixed_cost_month_cost agrees with every shared case: ' ||
  coalesce((select string_agg(name || ' (' || got || ' not ' || expected || ')', '; ')
              from month_results where got is distinct from expected), 'all agree'));
select ok((select count(*) from month_results) > 0, 'the case table is not empty');

-- ---------------------------------------------------------------------------
-- 2. Adding and paying, as the owner.

select pg_temp.impersonate(:'OWNER'::uuid);

select lives_ok(
  format($q$select public.create_fixed_cost(%L, 'Nayan', 'salary', 1200000, %L, null)$q$,
         :'KAL', pg_temp.last_month()),
  'the owner adds a salary that started last month');

select pg_temp.unimpersonate();
create temp table nayan as
  select id from public.fixed_costs where name = 'Nayan' and outlet_id = :'KAL';
grant select on nayan to authenticated;
select pg_temp.impersonate(:'OWNER'::uuid);

select is(
  public.fixed_cost_month_cost((select id from nayan), pg_temp.this_month()),
  1200000::bigint, 'a month after the one it started in costs the amount in full');

-- Paid today, counted on the last day of last month: last month's P&L carries it.
select lives_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 1200000, %L, %L, false, null, null)$q$,
         :'PAY_LATE', (select id from nayan), pg_temp.today(:'KAL'),
         (pg_temp.this_month() - 1)),
  'last month''s salary is paid today and counted in last month');
select is(
  (select business_date from public.expenses where id = :'PAY_LATE'),
  (pg_temp.this_month() - 1),
  'its expense sits on the last day of last month');
select is(
  (select coalesce(sum(amount_paise), 0)::bigint from public.effective_expenses
    where outlet_id = :'KAL' and id = :'PAY_LATE'
      and business_date between pg_temp.last_month() and pg_temp.this_month() - 1),
  1200000::bigint,
  'so last month''s recorded expenses include it');
select is(
  (select paid_on from public.fixed_cost_payments where expense_id = :'PAY_LATE'),
  pg_temp.today(:'KAL'),
  'and the link keeps the day it was paid');
select is(
  (select category || ' · ' || description from public.expenses where id = :'PAY_LATE'),
  'Salary · Nayan',
  'the expense reads as the Expenses form writes one: the category and the name');

-- A retried tap.
select is(
  public.record_fixed_cost_payment(:'PAY_LATE', (select id from nayan), 1200000,
    pg_temp.today(:'KAL'), (pg_temp.this_month() - 1), false, null, null),
  (select id from public.fixed_cost_payments where expense_id = :'PAY_LATE'),
  'a retried payment returns the link it already wrote');
select is(
  (select count(*) from public.expenses where id = :'PAY_LATE'), 1::bigint,
  'and writes no second expense');

-- Cash: whatever month it is said to count in, it shows on the day it was paid,
-- and the drawer's expected cash follows it.
select pg_temp.unimpersonate();
create temp table drawer_before (paise bigint) on commit drop;
grant insert, select on drawer_before to authenticated;
select pg_temp.impersonate(:'OWNER'::uuid);
insert into drawer_before
select public.drawer_cash_expenses_paise(:'KAL', now() - interval '1 minute',
                                         now() + interval '1 minute');
select lives_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 200000, %L, %L, true, 'advance', null)$q$,
         :'PAY_CASH', (select id from nayan), pg_temp.today(:'KAL'),
         (pg_temp.this_month() - 1)),
  'a cash advance is recorded');
select is(
  (select business_date from public.expenses where id = :'PAY_CASH'),
  pg_temp.today(:'KAL'),
  'cash is forced to the day it left the drawer');
select is(
  public.drawer_cash_expenses_paise(:'KAL', now() - interval '1 minute', now() + interval '1 minute')
    - (select paise from drawer_before),
  200000::bigint,
  'and it is among the cash that left the drawer');

-- More than owed, with an answer the server would not give: refused, nothing written.
select throws_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 5000000, %L, %L, false, null, 'settle')$q$,
         :'PAY_REFUSED', (select id from nayan), pg_temp.today(:'KAL'), pg_temp.today(:'KAL')),
  '22023', null,
  'paying more than owed and calling it That''s all is refused');
select throws_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 5000000, %L, %L, false, null, null)$q$,
         :'PAY_REFUSED', (select id from nayan), pg_temp.today(:'KAL'), pg_temp.today(:'KAL')),
  '22023', null,
  'paying more than owed without saying why is refused');
select is((select count(*) from public.expenses where id = :'PAY_REFUSED'), 0::bigint,
  'and neither refusal wrote an expense');

-- A permanent raise: this month settled at what was paid, the next at the new amount.
-- This month owes ₹10,000 after the ₹2,000 advance; ₹12,000 is ₹2,000 more.
select lives_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 1200000, %L, %L, false, 'Permanent pay raise', 'new-amount')$q$,
         :'PAY_RAISE', (select id from nayan), pg_temp.today(:'KAL'), pg_temp.today(:'KAL')),
  'a payment answered Permanent pay raise is recorded');
select is(
  public.fixed_cost_month_cost((select id from nayan), pg_temp.this_month()),
  1400000::bigint, 'this month is settled at its cost and the extra');
select is(
  public.fixed_cost_month_cost((select id from nayan), (pg_temp.this_month() + interval '1 month')::date),
  1400000::bigint, 'and the next month costs the new amount');

-- Undo takes the raise back with the payment.
select lives_ok(
  format($q$select public.undo_fixed_cost_payment(%L, %L)$q$,
         (select id from nayan),
         (select id from public.fixed_cost_payments where expense_id = :'PAY_RAISE')),
  'the raise''s payment is undone');
select isnt((select voided_at from public.expenses where id = :'PAY_RAISE'), null,
  'its expense is withdrawn, not deleted');
select is(
  public.fixed_cost_month_cost((select id from nayan), pg_temp.this_month()),
  1200000::bigint, 'this month is back to its amount');
select is(
  public.fixed_cost_month_cost((select id from nayan), (pg_temp.this_month() + interval '1 month')::date),
  1200000::bigint, 'and so is the next');

-- A lookalike typed on the Expenses page carries no link, so no chip.
select lives_ok(
  format($q$insert into public.expenses (id, outlet_id, business_date, category, is_cash, amount_paise, description)
            values (%L, %L, %L, 'Salary', false, 400000, 'Nayan [fixed]')$q$,
         :'LOOKALIKE', :'KAL', pg_temp.today(:'KAL')),
  'a lookalike is typed on the Expenses page');

select is(
  (select jsonb_agg(p->>'expenseId' order by p->>'expenseId')
     from jsonb_array_elements(public.fixed_costs_list(:'KAL')->'costs') c,
          jsonb_array_elements(c->'payments') p
    where c->>'name' = 'Nayan'),
  jsonb_build_array(:'PAY_LATE', :'PAY_CASH'),
  'the list carries the two effective payments: not the undone one, not the lookalike');
select is(
  (select p->>'note'
     from jsonb_array_elements(public.fixed_costs_list(:'KAL')->'costs') c,
          jsonb_array_elements(c->'payments') p
    where p->>'expenseId' = :'PAY_CASH'),
  'advance', 'a payment''s note is its expense''s, without the name in front');
select is(
  public.fixed_costs_list(:'KAL')->>'today', pg_temp.today(:'KAL')::text,
  'the list says the outlet''s business date');

select is(
  public.overview_month_v2(:'KAL') - 'fixedCosts',
  public.overview_month(:'KAL'),
  'overview_month_v2 is overview_month with the fixed costs beside it');
select is(
  public.overview_month_v2(:'KAL')->'fixedCosts',
  public.fixed_costs_list(:'KAL'),
  'and those are the list');

-- Needs attention: an ended month left short.
select lives_ok(
  format($q$select public.create_fixed_cost(%L, 'Shop rent', 'rent', 2500000, %L, null)$q$,
         :'KAL', pg_temp.last_month()),
  'rent from last month, never paid');
select is(
  public.fixed_costs_unpaid(),
  jsonb_build_object('count', 1, 'months', jsonb_build_array(pg_temp.last_month())),
  'the owner is told of one fixed cost unpaid from last month, and Nayan is not it');

-- Edit and Stop.
select lives_ok(
  format($q$select public.update_fixed_cost((select id from public.fixed_costs where name = 'Shop rent' and outlet_id = %L), 'Shop rent', 'rent', %L, 'Landlord')$q$,
         :'KAL', (pg_temp.last_month() - interval '1 month')::date),
  'rent''s start is moved a month earlier');
select is(
  public.fixed_cost_month_cost(
    (select id from public.fixed_costs where name = 'Shop rent' and outlet_id = :'KAL'),
    (pg_temp.last_month() - interval '1 month')::date),
  2500000::bigint, 'and the month it gains costs the first amount');

select lives_ok(
  format($q$select public.stop_fixed_cost(%L, %L, true)$q$,
         (select id from nayan), pg_temp.today(:'KAL')),
  'Nayan stops today, clearing what was paid ahead');
select throws_ok(
  format($q$select public.stop_fixed_cost(%L, %L, false)$q$,
         (select id from nayan), (pg_temp.last_month() - 1)),
  '22023', null, 'a stop before the start is refused');

-- ---------------------------------------------------------------------------
-- 3. Isolation. Kanchrapara's fixed cost, seeded as the database owner, with a
--    settlement, an amount and a paid month.

select pg_temp.unimpersonate();

insert into public.fixed_costs (id, outlet_id, name, category, starts_on, created_by)
values ('f1000000-0000-4000-a000-000000000001', :'KPA', 'Kpa rent', 'rent',
        pg_temp.last_month(), :'OWNER');
insert into public.fixed_cost_amounts (fixed_cost_id, outlet_id, from_month, amount_paise, created_by)
values ('f1000000-0000-4000-a000-000000000001', :'KPA', pg_temp.last_month(), 900000, :'OWNER');
insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise, created_by)
values ('f1000000-0000-4000-a000-000000000001', :'KPA', pg_temp.last_month(), 800000, :'OWNER');
insert into public.expenses (id, outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
values (:'KPA_EXPENSE', :'KPA', pg_temp.today(:'KPA'), 'Rent', false, 800000, 'Kpa rent', :'OWNER');
insert into public.fixed_cost_payments (fixed_cost_id, outlet_id, expense_id, paid_on, created_by)
values ('f1000000-0000-4000-a000-000000000001', :'KPA', :'KPA_EXPENSE', pg_temp.today(:'KPA'), :'OWNER');

create function pg_temp.seen()
returns text language sql stable as $$
  select concat_ws(' ',
    (select count(*) from public.fixed_costs where outlet_id = '00000000-0000-4000-a000-000000000002'),
    (select count(*) from public.fixed_cost_amounts where outlet_id = '00000000-0000-4000-a000-000000000002'),
    (select count(*) from public.fixed_cost_settlements where outlet_id = '00000000-0000-4000-a000-000000000002'),
    (select count(*) from public.fixed_cost_payments where outlet_id = '00000000-0000-4000-a000-000000000002'))
$$;
create function pg_temp.seen_kal()
returns bigint language sql stable as $$
  select (select count(*) from public.fixed_costs where outlet_id = '00000000-0000-4000-a000-000000000001')
       + (select count(*) from public.fixed_cost_amounts where outlet_id = '00000000-0000-4000-a000-000000000001')
       + (select count(*) from public.fixed_cost_settlements where outlet_id = '00000000-0000-4000-a000-000000000001')
       + (select count(*) from public.fixed_cost_payments where outlet_id = '00000000-0000-4000-a000-000000000001')
$$;
grant execute on function pg_temp.seen(), pg_temp.seen_kal() to authenticated;

select pg_temp.impersonate(:'OWNER'::uuid);
select is(pg_temp.seen(), '1 1 1 1', 'the owner reads Kanchrapara''s fixed cost, amount, settlement and payment');

select pg_temp.impersonate(:'FA_KPA'::uuid);
select is(pg_temp.seen(), '1 1 1 1', 'so does Kanchrapara''s manager');
select is(pg_temp.seen_kal(), 0::bigint, 'who reads nothing of Kalyani''s');

select pg_temp.impersonate(:'FA_KAL'::uuid);
select is(pg_temp.seen(), '0 0 0 0', 'Kalyani''s manager reads none of the four tables at Kanchrapara');
select ok(pg_temp.seen_kal() > 0, 'and does read Kalyani''s');
select throws_ok(
  format($q$select public.fixed_costs_list(%L)$q$, :'KPA'),
  '42501', null, 'a crafted list of Kanchrapara is refused');
select throws_ok(
  format($q$select public.overview_month_v2(%L)$q$, :'KPA'),
  '42501', null, 'and so is its Overview month');
select throws_ok(
  format($q$insert into public.fixed_costs (outlet_id, name, category, starts_on) values (%L, 'Crafted', 'other', %L)$q$,
         :'KPA', pg_temp.today(:'KPA')),
  '42501', null, 'a fixed cost at Kanchrapara cannot be inserted');
select throws_ok(
  format($q$select public.create_fixed_cost(%L, 'Crafted', 'other', 100, %L, null)$q$,
         :'KPA', pg_temp.today(:'KPA')),
  '42501', null, 'nor added through the function');
select throws_ok(
  format($q$select public.record_fixed_cost_payment(%L, 'f1000000-0000-4000-a000-000000000001', 100000, %L, %L, false, null, null)$q$,
         :'PAY_FOREIGN', pg_temp.today(:'KPA'), pg_temp.today(:'KPA')),
  '42501', null, 'nor paid');
select throws_ok(
  $q$insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
     values ('f1000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', date_trunc('month', now())::date, 0)$q$,
  '42501', null, 'nor settled');
select is(
  public.fixed_costs_unpaid()->'count', '1'::jsonb,
  'Kalyani''s manager is told of Kalyani''s unpaid rent, not Kanchrapara''s');

select pg_temp.impersonate(:'OWNER'::uuid);
select throws_ok(
  format($q$insert into public.fixed_cost_payments (fixed_cost_id, outlet_id, expense_id, paid_on)
            values (%L, %L, %L, %L)$q$,
         (select id from nayan), :'KAL', :'KPA_EXPENSE', pg_temp.today(:'KAL')),
  'P0001', null, 'a Kalyani fixed cost cannot claim Kanchrapara''s expense');
select throws_ok(
  format($q$delete from public.fixed_costs where id = %L$q$, (select id from nayan)),
  '42501', null, 'the owner cannot delete a fixed cost');
select throws_ok(
  $q$delete from public.fixed_cost_payments$q$,
  '42501', null, 'nor a payment''s link');
select throws_ok(
  $q$delete from public.fixed_cost_settlements$q$,
  '42501', null, 'nor a settlement');
select throws_ok(
  $q$delete from public.fixed_cost_amounts$q$,
  '42501', null, 'nor a monthly amount');

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select is(pg_temp.seen_kal(), 0::bigint, 'a Biller reads none of the four tables at their own outlet');
select throws_ok(format($q$select public.fixed_costs_list(%L)$q$, :'KAL'), '42501', null,
  'a Biller''s list is refused');
select is(public.fixed_costs_unpaid()->'count', '0'::jsonb, 'a Biller is told of nothing unpaid');
select throws_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 100000, %L, %L, true, null, null)$q$,
         :'PAY_BILLER', (select id from nayan), pg_temp.today(:'KAL'), pg_temp.today(:'KAL')),
  '42501', null, 'a Biller calling the pay function is refused');

select pg_temp.unimpersonate();
select is((select count(*) from public.expenses where id = :'PAY_BILLER'), 0::bigint,
  'before any expense is written');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select is(pg_temp.seen_kal(), 0::bigint, 'an Employee reads none of them');
select throws_ok(format($q$select public.fixed_costs_list(%L)$q$, :'KAL'), '42501', null,
  'an Employee''s list is refused');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(pg_temp.seen_kal(), 0::bigint, 'a counter tablet on a live shift reads none of them');
select throws_ok(
  format($q$select public.record_fixed_cost_payment(%L, %L, 100000, %L, %L, true, null, null)$q$,
         :'PAY_BILLER', (select id from nayan), pg_temp.today(:'KAL'), pg_temp.today(:'KAL')),
  '42501', null, 'and cannot pay one');

select pg_temp.impersonate(:'DEACTIVATED_FA_KAL'::uuid);
select is(pg_temp.seen_kal(), 0::bigint, 'a deactivated manager reads none of them, while the assignment lingers');
select throws_ok(format($q$select public.fixed_costs_list(%L)$q$, :'KAL'), '42501', null,
  'and their list is refused');

select pg_temp.unimpersonate();
update public.profiles set is_active = false where id = :'OWNER';
select pg_temp.impersonate(:'OWNER'::uuid);
select is(pg_temp.seen_kal(), 0::bigint, 'a deactivated owner reads none of them');
select throws_ok(format($q$select public.fixed_costs_list(%L)$q$, :'KAL'), '42501', null,
  'and their list is refused');
select is(public.fixed_costs_unpaid()->'count', '0'::jsonb, 'and they are told of nothing unpaid');

select pg_temp.unimpersonate();
set local role anon;
select throws_ok($q$select count(*) from public.fixed_costs$q$, '42501', null,
  'anonymous cannot read fixed costs');
select throws_ok($q$select count(*) from public.fixed_cost_payments$q$, '42501', null,
  'nor their payments');
select throws_ok(format($q$select public.fixed_costs_list(%L)$q$, :'KAL'), '42501', null,
  'nor call the list');

select * from finish();
rollback;
