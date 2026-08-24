-- The ledger transition is outlet-by-outlet and date-bound: scheduling is an
-- owner decision, started dates are immutable, and counter revenue is exactly
-- the settled Cash/UPI allocation total rather than typed revenue plus bills.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

select pg_temp.impersonate(:'OWNER');
update public.outlets set billing_live_from = current_date + 1 where id = :'KAL';
select is((select billing_live_from from public.outlets where id = :'KAL'),
  current_date + 1, 'the owner can schedule an outlet on a future business date');
select throws_ok(
  format('update public.outlets set billing_live_from = current_date - 7 where id = %L', :'KAL'),
  'P0001', null, 'an already-started date cannot be chosen');
select throws_like(
  format('update public.outlets set billing_live_from = current_date - 7 where id = %L', :'KAL'),
  '%next eligible business date is%',
  'the refusal names the next business date that has not started');

select pg_temp.impersonate(:'FA_KAL');
update public.outlets set billing_live_from = current_date + 2 where id = :'KAL';
reset role;
select is((select billing_live_from from public.outlets where id = :'KAL'),
  current_date + 1, 'an outlet manager cannot move the owner-controlled date through RLS');

-- Privileged setup advances this outlet past its scheduled day without waiting
-- for the wall clock. Runtime clients cannot bypass the trigger this disables.
set local session_replication_role = replica;
update public.outlets set billing_live_from = current_date - 2 where id = :'KAL';
set local session_replication_role = origin;

select pg_temp.impersonate(:'OWNER');
select is(
  (select cash_revenue_paise from public.manual_ledger_counter_revenue(
    :'KAL', current_date - 2, current_date - 1)),
  86600::bigint,
  'Cash is the settled allocation total once, with the voided bill excluded');
select is(
  (select upi_revenue_paise from public.manual_ledger_counter_revenue(
    :'KAL', current_date - 2, current_date - 1)),
  45700::bigint,
  'UPI is the settled allocation total once');

select throws_ok(
  format($q$insert into public.manual_ledger_days
    (outlet_id,business_date,opening_cash_paise,cash_revenue_paise,upi_revenue_paise,
     cash_added_paise,cash_removed_paise,
     counted_cash_paise)
    values (%L,current_date,10000,100,200,0,0,10000)$q$, :'KAL'),
  'P0001', null, 'typed Cash/UPI is refused from the live date onward');

-- There is no unsourced aggregator left to keep typed: Zomato's figures left
-- this row when they were sourced, and Swiggy's have now followed them. The
-- property this block used to demonstrate is gone by design, so what remains
-- to assert is the absence itself — no channel column a form could reach.
select is(
  (select count(*) from pg_attribute a
    where a.attrelid = 'public.manual_ledger_days'::regclass
      and a.attnum > 0 and not a.attisdropped
      and (a.attname like 'swiggy%' or a.attname like 'zomato%')),
  0::bigint,
  'no aggregator column remains typed on the day row after counter go-live');

select pg_temp.impersonate(:'FA_KAL');
select is((select count(*) from public.manual_ledger_counter_revenue(
  :'KPA', current_date - 3, current_date + 1)), 0::bigint,
  'the revenue read model cannot cross the caller''s outlet boundary');

reset role;
select * from finish();
rollback;
