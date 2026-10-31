-- A fixed cost's part month costs the figure agreed for it
-- (part-months-cost-what-was-agreed, the #79 follow-up behind
-- `agreed-part-months`).
--
-- Held here: stopping with a final payment settles the stop month at what was
-- already paid plus it, and records the payment on the last day when it is paid
-- now; a retried stop counts nothing twice; a mid-month start settles its first
-- month; and only the owner and the outlet's own manager may call any of it.
-- Every date is last month's, so the test reads the same on any day.

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

create function pg_temp.last_month()
returns date language sql stable as $$
  select (date_trunc('month', public.app_business_date(now(), o.business_day_cutover)::timestamp)
          - interval '1 month')::date
    from public.outlets o where o.id = '00000000-0000-4000-a000-000000000001'
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set KAL '00000000-0000-4000-a000-000000000001'
\set ADVANCE 'f1000000-0000-4000-a000-000000000001'
\set FINAL 'f1000000-0000-4000-a000-000000000002'
\set ADVANCE_LATER 'f1000000-0000-4000-a000-000000000003'
\set ADVANCE_NOTHING 'f1000000-0000-4000-a000-000000000004'

select pg_temp.impersonate(:'OWNER');

-- Three ₹6,000 salaries from the 1st of last month, each paid ₹2,000 on the 21st.
create temp table costs (label text primary key, id uuid) on commit drop;
grant all on costs to authenticated;
insert into costs
select label, public.create_fixed_cost(:'KAL', 'Jayanta ' || label, 'salary', 600000,
                                       pg_temp.last_month(), null)
  from unnest(array['now', 'later', 'nothing']) as label;

select public.record_fixed_cost_payment(p.payment, c.id, 200000,
         pg_temp.last_month() + 20, pg_temp.last_month() + 20, false, 'Advance', null)
  from costs c
  join (values ('now', :'ADVANCE'::uuid), ('later', :'ADVANCE_LATER'::uuid),
               ('nothing', :'ADVANCE_NOTHING'::uuid)) p (label, payment)
    on p.label = c.label;

select is(public.fixed_cost_already_paid_in((select id from costs where label = 'now'),
                                            pg_temp.last_month()),
          200000::bigint, 'what is already paid in the month is the ₹2,000 advance');

-- ---------------------------------------------------------------------------
-- 1. Paid now: the ₹2,000 handed over at closing is recorded on the last day.

select lives_ok(
  format($q$select public.stop_fixed_cost_v2(%L, %L, 200000, %L, false)$q$,
         (select id from costs where label = 'now'), pg_temp.last_month() + 27, :'FINAL'),
  'stopping with a final payment, paid now, saves');

select is(public.fixed_cost_month_cost((select id from costs where label = 'now'),
                                       pg_temp.last_month()),
          400000::bigint, 'the stop month costs what was paid plus the final payment');

select results_eq(
  format($q$select e.business_date, e.amount_paise, e.description
              from public.expenses e where e.id = %L$q$, :'FINAL'),
  format($q$values (%L::date, 200000::bigint, 'Jayanta now · Final payment'::text)$q$,
         pg_temp.last_month() + 27),
  'the final payment is an expense on the last day');

select is(
  (select coalesce(sum(m.cost_paise), 0)
     from public.fixed_cost_months((select id from costs where label = 'now'),
                                   pg_temp.last_month()) m)
  - public.fixed_cost_paid_paise((select id from costs where label = 'now'), current_date),
  0::numeric, 'and nothing is owed');

-- A retried tap finds the payment and settles nothing twice.
select lives_ok(
  format($q$select public.stop_fixed_cost_v2(%L, %L, 200000, %L, false)$q$,
         (select id from costs where label = 'now'), pg_temp.last_month() + 27, :'FINAL'),
  'a retried stop saves');
select is(public.fixed_cost_month_cost((select id from costs where label = 'now'),
                                       pg_temp.last_month()),
          400000::bigint, 'and the month still costs ₹4,000');
select is((select count(*) from public.fixed_cost_payments
            where fixed_cost_id = (select id from costs where label = 'now')),
          2::bigint, 'with one final payment, not two');

-- ---------------------------------------------------------------------------
-- 2. Paying later, and nothing more.

select public.stop_fixed_cost_v2((select id from costs where label = 'later'),
                                 pg_temp.last_month() + 27, 200000);
select is(public.fixed_cost_month_cost((select id from costs where label = 'later'),
                                       pg_temp.last_month()),
          400000::bigint, 'paying later still closes the month at ₹4,000');
select is(public.fixed_cost_paid_paise((select id from costs where label = 'later'), current_date),
          200000::bigint, 'with only the advance paid');

select public.stop_fixed_cost_v2((select id from costs where label = 'nothing'),
                                 pg_temp.last_month() + 27, 0);
select is(public.fixed_cost_month_cost((select id from costs where label = 'nothing'),
                                       pg_temp.last_month()),
          200000::bigint, 'nothing more closes the month at what was paid');

select throws_ok(
  format($q$select public.stop_fixed_cost_v2(%L, %L, -100)$q$,
         (select id from costs where label = 'nothing'), pg_temp.last_month() + 27),
  '22023', null, 'a final payment below zero is refused');

-- ---------------------------------------------------------------------------
-- 3. Starting part-way through a month.

-- Each read is its own statement: a stable read does not see rows written
-- earlier in the same statement, and every settlement in one transaction has
-- the same created_at, so each case below uses a fixed cost of its own.
insert into costs
values ('ravi', public.create_fixed_cost_v2(:'KAL', 'Ravi', 'salary', 1000000,
                                            pg_temp.last_month() + 19, null, 350000)),
       ('mita', public.create_fixed_cost_v2(:'KAL', 'Mita', 'salary', 1000000,
                                            pg_temp.last_month(), null, null)),
       ('moved', public.create_fixed_cost(:'KAL', 'Moved', 'salary', 1000000,
                                          pg_temp.last_month(), null));

select is(public.fixed_cost_month_cost((select id from costs where label = 'ravi'),
                                       pg_temp.last_month()),
          350000::bigint, 'a mid-month start costs what its first month was agreed at');

select throws_ok(
  format($q$select public.create_fixed_cost_v2(%L, 'Ravi', 'salary', 1000000, %L, null, null)$q$,
         :'KAL', pg_temp.last_month() + 19),
  '22023', null, 'and is refused without it');

select is(public.fixed_cost_month_cost((select id from costs where label = 'mita'),
                                       pg_temp.last_month()),
          1000000::bigint, 'a start on the 1st needs no first-month figure');

select lives_ok(
  format($q$select public.update_fixed_cost_v2(%L, 'Moved', 'salary', %L, null, 150000)$q$,
         (select id from costs where label = 'moved'), pg_temp.last_month() + 9),
  'an edited start part-way through a month saves with its figure');
select is(public.fixed_cost_month_cost((select id from costs where label = 'moved'),
                                       pg_temp.last_month()),
          150000::bigint, 'and the month costs it');

-- ---------------------------------------------------------------------------
-- 4. Only the owner and the outlet's own manager.

select pg_temp.impersonate(:'FA_KPA');
select throws_ok(
  format($q$select public.stop_fixed_cost_v2(%L, %L, 0)$q$,
         (select id from costs where label = 'nothing'), pg_temp.last_month() + 27),
  'P0002', null, 'another outlet''s manager cannot even find the fixed cost to stop');
select throws_ok(
  format($q$select public.create_fixed_cost_v2(%L, 'Ravi', 'salary', 1000000, %L, null, 1)$q$,
         :'KAL', pg_temp.last_month() + 19),
  '42501', null, 'nor add one to it');

select * from finish();
rollback;
