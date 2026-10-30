-- revenue-reads-the-same-everywhere (#76): the one definition, the compared
-- windows and their cut, and who may read them.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select * from no_plan();
create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end; $$;

-- ── Fixture: the seed's bills, plus a stated, a charge-only and a waiting
--    delivery day at Kalyani ──────────────────────────────────────────────
create temp table fx as
select min(business_date) as d0, max(business_date) as d2
  from public.bills
 where outlet_id = '00000000-0000-4000-a000-000000000001' and status = 'settled';
select ok((select d2 > d0 from fx), 'the seed has settled bills across several dates');

insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin)
select '00000000-0000-4000-a000-000000000001'::uuid, 'zomato', d0, 200000, 60000, 140000,
       'settled', 'settlement' from fx
union all
-- A charge on a day with no orders: no sales, a negative receipt.
select '00000000-0000-4000-a000-000000000001'::uuid, 'swiggy', d0, 0, 61107, -61107,
       'settled', 'settlement' from fx
union all
-- Not stated yet.
select '00000000-0000-4000-a000-000000000001'::uuid, 'zomato', d0 + 1, 50000, null, null,
       'provisional', 'daily_reader' from fx;

-- What the definition says, computed here from the tables, independently.
create temp table expected as
with per_bill as (
  select b.id,
         coalesce(sum(e.amount_paise) filter (where e.method = 'cash'), 0) as cash,
         coalesce(sum(e.amount_paise) filter (where e.method = 'upi'), 0) as upi
    from public.bills b join public.effective_bill_payments e on e.bill_id = b.id, fx
   where b.outlet_id = '00000000-0000-4000-a000-000000000001' and b.status = 'settled'
     and b.business_date between fx.d0 and fx.d2
   group by b.id)
select (select sum(greatest(cash, 0) + greatest(upi, 0)) from per_bill)::bigint as counter,
       250000::bigint as delivery,
       (60000 + 61107)::bigint as commission,
       (select coalesce(sum(amount_paise), 0) from public.effective_expenses x, fx
         where x.outlet_id = '00000000-0000-4000-a000-000000000001'
           and x.business_date between fx.d0 and fx.d2)::bigint as recorded;

-- ── The definition (D1) ────────────────────────────────────────────────────
create temp table got as
select public.revenue_figures('00000000-0000-4000-a000-000000000001', d0, d2) as f from fx;
select is((select (f->>'revenuePaise')::bigint from got), (select counter + delivery from expected),
  'revenue is the counter plus delivery before commission');
select is((select (f->>'deliveryPaise')::bigint from got), 250000::bigint,
  'a charge-only day adds nothing to revenue, and a waiting day adds its sales');
select is((select (f->>'commissionPaise')::bigint from got), (select commission from expected),
  'commission is each stated channel-day''s sales less what arrived, charges included');
select is((select (f->>'waitingDays')::int from got), 1, 'a day not stated yet is counted as waiting');
select is((select (f->>'recordedExpensesPaise')::bigint from got), (select recorded from expected),
  'recorded expenses are the effective expenses');

grant select on fx, expected to authenticated;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

-- ── Overview (D5) ─────────────────────────────────────────────────────────
create temp table om as
select public.overview_month('00000000-0000-4000-a000-000000000001') as m;
select is((select m->>'from' from om), to_char(date_trunc('month', (select d2 from fx)), 'YYYY-MM-DD'),
  'the month starts on the 1st');
select is((select m->>'through' from om), (select d2::text from fx), 'the month runs through today');
select is((select (m->>'expensesPaise')::bigint from om),
  (select (m->>'recordedExpensesPaise')::bigint + (m->>'commissionPaise')::bigint from om),
  'expenses are recorded expenses plus commission');
select is((select (m->>'profitPaise')::bigint from om),
  (select (m->>'revenuePaise')::bigint - (m->>'expensesPaise')::bigint from om),
  'profit is revenue less expenses');
select is((select m->'previous'->>'from' from om),
  to_char(date_trunc('month', (select d2 from fx)) - interval '1 month', 'YYYY-MM-DD'),
  'the comparison starts on the previous month''s 1st');
select ok((select m->'previous'->>'cutAt' is not null from om),
  'the comparison is cut at the time it is now');
select ok((select (o->>'cashPaise')::bigint + (o->>'upiPaise')::bigint + (o->>'deliveryPaise')::bigint >= 0
             from (select public.overview_today('00000000-0000-4000-a000-000000000001') as o) t),
  'today reads');

-- ── Windows and the cut (D3) ──────────────────────────────────────────────
reset role;
select results_eq(
  $q$select w_first, w_last, cut_at is null from public.revenue_compared_windows(
       '00000000-0000-4000-a000-000000000001', '2026-03-01', '2026-03-30', 2, 'month', 'now')
     order by period$q$,
  $q$values ('2026-03-01'::date, '2026-03-30'::date, true), ('2026-02-01'::date, '2026-02-28'::date, true)$q$,
  'a month past February''s length compares with all of February');
select results_eq(
  $q$select w_first, w_last from public.revenue_compared_windows(
       '00000000-0000-4000-a000-000000000001', '2026-09-01', '2026-09-30', 2, 'month', null)
     order by period$q$,
  $q$values ('2026-09-01'::date, '2026-09-30'::date), ('2026-08-01'::date, '2026-08-31'::date)$q$,
  'a whole month compares with the whole month before');
select results_eq(
  $q$select w_first, w_last from public.revenue_compared_windows(
       '00000000-0000-4000-a000-000000000001', '2026-10-09', '2026-10-15', 3, 'equal', null)
     order by period$q$,
  $q$values ('2026-10-09'::date, '2026-10-15'::date), ('2026-10-02'::date, '2026-10-08'::date),
            ('2026-09-25'::date, '2026-10-01'::date)$q$,
  'equal windows are the adjacent ones of the same length');
select is(
  (select w.cut_at from fx, public.revenue_compared_windows(
     '00000000-0000-4000-a000-000000000001', fx.d2, fx.d2, 2, 'equal', 'now') w where w.period = 1),
  (select public.app_business_day_end(d2 - 2, '04:00') + (now() - public.app_business_day_end(d2 - 1, '04:00')) from fx),
  'yesterday is cut at the same time of day as now');

-- ── Analytics v2 (D7) ─────────────────────────────────────────────────────
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
-- The cut: yesterday's comparison counts only bills ordered before the cut.
reset role;
create temp table cut_expect as
select (select coalesce(sum(b.total_paise), 0) from public.bills b
         where b.outlet_id = '00000000-0000-4000-a000-000000000001' and b.status = 'settled'
           and b.business_date = fx.d2 - 1
           and b.ordered_at < public.app_business_day_end(fx.d2 - 2, '04:00')
                             + (now() - public.app_business_day_end(fx.d2 - 1, '04:00')))::bigint as counter
  from fx;
grant select on cut_expect to authenticated;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select (public.sales_analytics_v2('00000000-0000-4000-a000-000000000001', d2, d2, 'sales', 2, 'equal', 'now')->'totals'->1->>'counter')::bigint from fx),
  (select counter from cut_expect),
  'an earlier window''s total stops at the same time of day');
-- Overview's month and Analytics' Month are one figure (D8).
select is(
  (select (t->>'counter')::bigint + (t->>'delivery')::bigint
     from (select public.sales_analytics_v2('00000000-0000-4000-a000-000000000001',
             date_trunc('month', d2)::date, d2, 'sales', 2, 'month', 'now')->'totals'->0 as t from fx) x),
  (select (m->>'revenuePaise')::bigint from om),
  'Analytics'' Month equals Overview''s month to the paisa');
select is(
  (select (t->>'counter')::bigint + (t->>'delivery')::bigint
     from (select public.sales_analytics_v2('00000000-0000-4000-a000-000000000001',
             date_trunc('month', d2)::date, d2, 'sales', 2, 'month', 'now')->'totals'->1 as t from fx) x),
  (select (m->'previous'->>'revenuePaise')::bigint from om),
  'and so does the month it is compared with');
select throws_ok($q$select public.sales_analytics_v2('00000000-0000-4000-a000-000000000001','2026-09-20','2026-10-05','sales',2,'month')$q$,
  '22023', null, 'a Month range across two months is refused');
select throws_ok($q$select public.sales_analytics_v2('00000000-0000-4000-a000-000000000001','2026-10-01','2026-10-05','sales',2,'equal','later')$q$,
  '22023', null, 'an unknown cut is refused');
-- The series: its totals per window.
select is(
  (select (public.sales_analytics_series_v2('00000000-0000-4000-a000-000000000001', d0, d2, 2)->'totals'->0->>'units')::bigint from fx),
  (select sum((i->>'units')::bigint)::bigint from fx,
     jsonb_array_elements(public.sales_analytics_v2('00000000-0000-4000-a000-000000000001', fx.d0, fx.d2, 'items', 2)->'items') i),
  'the series'' current total is every dish''s units');

-- ── Authority ─────────────────────────────────────────────────────────────
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$select public.overview_today('00000000-0000-4000-a000-000000000002')$q$, '42501', null,
  'a manager''s crafted request for another outlet''s today is refused');
select throws_ok($q$select public.overview_month('00000000-0000-4000-a000-000000000002')$q$, '42501', null,
  'and for its month');
select throws_ok($q$select public.sales_analytics_v2('00000000-0000-4000-a000-000000000002','2026-10-01','2026-10-07')$q$, '42501', null,
  'and for its sales');
select throws_ok($q$select public.sales_analytics_series_v2('00000000-0000-4000-a000-000000000002','2026-10-01','2026-10-07')$q$, '42501', null,
  'and for its dish series');
select lives_ok($q$select public.overview_month('00000000-0000-4000-a000-000000000001')$q$,
  'the manager reads their own outlet');
select ok(not has_function_privilege('public.revenue_figures(uuid, date, date, timestamptz, boolean)', 'execute'),
  'the figures function is not callable directly');
select ok(not has_function_privilege('public.revenue_compared_windows(uuid, date, date, integer, text, text)', 'execute'),
  'nor are the windows');
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$select public.overview_month('00000000-0000-4000-a000-000000000001')$q$, '42501', null,
  'a biller is refused the month');
select throws_ok($q$select public.sales_analytics_v2('00000000-0000-4000-a000-000000000001','2026-10-01','2026-10-07')$q$, '42501', null,
  'and Analytics');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$select public.overview_today('00000000-0000-4000-a000-000000000001')$q$, '42501', null,
  'an employee is refused today');
reset role;
set local role anon;
select throws_ok($q$select public.overview_month('00000000-0000-4000-a000-000000000001')$q$, '42501', null,
  'anonymous is refused');
reset role;

-- ── The retirement (retire-one-revenue) ───────────────────────────────────
select hasnt_function('public', 'overview_sales', 'the old Overview card''s sales read is gone');
select hasnt_function('public', 'overview_revenue', 'and its revenue read');
select hasnt_function('public', 'overview_expenses', 'and its expenses read');
select hasnt_function('public', 'sales_analytics', 'Analytics'' first read is gone');
select hasnt_function('public', 'sales_analytics_series', 'and its first dish series');
select is((select retired_at is not null and not enabled from public.change_gates where key = 'one-revenue'),
  true, 'the gate is retired and off');

select * from finish();
rollback;
