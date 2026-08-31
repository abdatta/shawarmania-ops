-- The Zomato settlement boundary, written out rather than inherited.
--
-- The generic sweep in 02_isolation_matrix.sql discovers the three new tables
-- from the catalog and proves the ordinary claim: nobody reads across outlets.
-- The claim here is stronger and the sweep cannot express it — **no outlet role
-- reaches these rows at all, at any outlet, including their own.** They carry
-- settlement money, the decisions taken about it, and the record of what the
-- automation did, and outlet staff cannot type any of them.
--
-- The constraints are exercised by hand-crafted violations for the reason the
-- ledger's own file gives: this capability's only value is that the figures in it
-- are possible. A triple that does not add up, or a settled day quietly
-- downgraded to provisional by a later run reading the live dashboard, would each
-- produce a true-looking number that is wrong.

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

-- Back to `postgres` with no session identity at all. The claim is
-- transaction-local rather than role-local, so `reset role` alone leaves
-- `auth.uid()` still answering with whoever was last impersonated.
create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.rows_changed(sql text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('with attempted as (%s returning 1) select count(*) from attempted', sql)
    into n;
  return n;
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

create function pg_temp.ledger_day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- ---------------------------------------------------------------------------
-- 0. The sync's own rows, planted as the service role would write them.
--
-- Planted rather than written in character, because the sync does not sign in:
-- it posts to an Edge Function which writes with the service role. Nothing an
-- `authenticated` session can do produces these rows, and that is the point.

select pg_temp.unimpersonate();

insert into public.aggregator_cycle_deductions
  (outlet_id, channel, kind, period_start, period_end, amount_paise,
   source_system, source_ref)
values
  (:'KAL', 'zomato', 'tax_deducted_at_source',
   pg_temp.ledger_day(28), pg_temp.ledger_day(22), -31124,
   'zomato', 'TDS::21917311::20260719'),
  (:'KPA', 'zomato', 'tax_deducted_at_source',
   pg_temp.ledger_day(28), pg_temp.ledger_day(22), -18800,
   'zomato', 'TDS::22675834::20260719');

insert into public.aggregator_sync_runs
  (outlet_id, channel, started_at, finished_at, outcome, detail)
values
  (:'KAL', 'zomato', now() - interval '2 hours', now() - interval '2 hours' + interval '40 seconds',
   'ok', null),
  (:'KPA', 'zomato', now() - interval '2 hours', now() - interval '2 hours' + interval '35 seconds',
   'session_lapsed', 'the Zomato session is no longer valid');

insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values (:'KAL', 'zomato', pg_temp.ledger_day(-3)),
       (:'KPA', 'zomato', pg_temp.ledger_day(-3));

-- A synced channel day at each outlet gives the column assertions below a real
-- row to refuse. Drawer observations are independent records.
insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin)
values
  (:'KAL', 'zomato', pg_temp.ledger_day(2), 297003, 83892, 213111, 'settled', 'settlement'),
  (:'KPA', 'zomato', pg_temp.ledger_day(2), 412200, 128000, 284200, 'provisional', 'daily_reader');

-- ---------------------------------------------------------------------------
-- 1. The owner reads all of it, across both outlets.

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.aggregator_cycle_deductions),
  2::bigint,
  'the owner reads cycle deductions at both outlets');

select is(
  (select count(*) from public.aggregator_sync_runs),
  2::bigint,
  'and every sync run');

select is(
  (select count(*) from public.outlet_channel_sync),
  2::bigint,
  'and the sync date for each outlet');

-- Net is a subtraction rather than a column [owner, 2026-08-17]. With commission
-- exact, a stored third figure would be a copy able to disagree with the two it
-- came from, so the reading computes it and there is nothing to store.
select is(
  (select revenue_paise - commission_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(2)),
  213111::bigint,
  'and a synced day''s measured net, as the difference of the two figures stored');

reset role;

-- ---------------------------------------------------------------------------
-- 2. Every other role is refused all three tables outright, at both outlets.
--
-- Read, insert and update are each asserted, and the shapes differ: RLS filters
-- rows rather than raising, so a refused UPDATE is a no-op and not an error,
-- while an insert's `with check` raises 42501. Asserting the wrong one of these
-- is how a policy hole gets a passing test.

create function pg_temp.settlement_refused(persona text, p_sub uuid, p_outlet uuid, whose text,
                                           p_sees_figures boolean default false)
returns setof text language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.impersonate(p_sub);

  execute format(
    'select count(*) from public.aggregator_cycle_deductions where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads no cycle deduction at %s outlet', persona, whose));

  execute format(
    'select count(*) from public.aggregator_sync_runs where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads no sync run at %s outlet', persona, whose));

  execute format(
    'select count(*) from public.outlet_channel_sync where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads no sync date at %s outlet', persona, whose));

  -- Daily aggregates follow the ledger grant they were folded into: an assigned
  -- Franchise Admin reads them at their own outlet and nowhere else, while
  -- Biller, Employee and every cross-outlet request still see nothing. The
  -- settlement internals above stay refused to every outlet role regardless.
  execute format(
    'select count(*) from public.aggregator_channel_days where outlet_id = %L', p_outlet)
    into n;
  return next is(n, (case when p_sees_figures then 1 else 0 end)::bigint,
    format('%s %s measured figures at %s outlet', persona,
      case when p_sees_figures then 'reads the assigned outlet''s'
           else 'reads no' end, whose));

  return next throws_ok(
    format($q$
      insert into public.aggregator_cycle_deductions
        (outlet_id, channel, kind, period_start, period_end, amount_paise,
         source_system, source_ref, accepted_by, accepted_at)
      values (%L, 'zomato', 'unexplained_settlement_difference',
              current_date - 7, current_date - 1, -7915, 'owner', 'forged', %L, now()) $q$,
      p_outlet, p_sub),
    '42501', null,
    format('%s cannot record a settlement difference at %s outlet', persona, whose));

  return next throws_ok(
    format($q$
      insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
      values (%L, 'zomato', current_date + 30) $q$, p_outlet),
    '42501', null,
    format('%s cannot set a sync date at %s outlet', persona, whose));

  n := pg_temp.rows_changed(format(
    'update public.aggregator_cycle_deductions set amount_paise = 1 where outlet_id = %L',
    p_outlet));
  return next is(n, 0::bigint,
    format('%s changes no cycle deduction at %s outlet', persona, whose));

  -- No client role is granted any write on the figures table, so a refused
  -- write here is the grant's own denial rather than a filtered no-op.
  return next throws_ok(
    format($q$
      update public.aggregator_channel_days set revenue_paise = 1
       where outlet_id = %L $q$, p_outlet),
    '42501', null,
    format('%s changes no measured figure at %s outlet', persona, whose));

  n := pg_temp.rows_changed(format(
    'update public.outlet_channel_sync set synced_from = current_date + 60 where outlet_id = %L',
    p_outlet));
  return next is(n, 0::bigint,
    format('%s changes no sync date at %s outlet', persona, whose));

  execute 'reset role';
end;
$$;

select * from pg_temp.settlement_refused('fa_kalyani', :'FA_KAL', :'KAL', 'their own', true);
select * from pg_temp.settlement_refused('fa_kalyani', :'FA_KAL', :'KPA', 'the other');
select * from pg_temp.settlement_refused('fa_kanchrapara', :'FA_KPA', :'KPA', 'their own', true);
select * from pg_temp.settlement_refused('biller_kalyani', :'BILLER_KAL', :'KAL', 'their own');
select * from pg_temp.settlement_refused('biller_kalyani', :'BILLER_KAL', :'KPA', 'the other');
select * from pg_temp.settlement_refused('employee_kalyani', :'EMPLOYEE_KAL', :'KAL', 'their own');
select * from pg_temp.settlement_refused('employee_kalyani', :'EMPLOYEE_KAL', :'KPA', 'the other');

-- Nobody may delete any of it, and the grant itself is absent rather than merely
-- unreachable through a policy.
create function pg_temp.delete_refused(persona text, p_sub uuid)
returns setof text language plpgsql as $$
begin
  perform pg_temp.impersonate(p_sub);
  return next throws_ok(
    'delete from public.aggregator_cycle_deductions', '42501', null,
    format('%s cannot delete a cycle deduction', persona));
  return next throws_ok(
    'delete from public.aggregator_sync_runs', '42501', null,
    format('%s cannot delete a sync run', persona));
  return next throws_ok(
    'delete from public.outlet_channel_sync', '42501', null,
    format('%s cannot delete a sync date', persona));
  execute 'reset role';
end;
$$;

select * from pg_temp.delete_refused('the owner', :'OWNER');
select * from pg_temp.delete_refused('a manager', :'FA_KAL');
select * from pg_temp.delete_refused('a biller', :'BILLER_KAL');

select is(
  has_table_privilege('authenticated', 'public.aggregator_sync_runs', 'INSERT'),
  false,
  'no signed-in account may write a sync run at all: the runs are the machine''s '
  'own record, and an account that could write one could report a run that never '
  'happened');

-- ---------------------------------------------------------------------------
-- 3. The new day columns widened the row and widened no access.
--
-- Two different claims, because the day row already answers differently for
-- different roles and this change must not blur that.
--
--   * **A Biller and an Employee reach nothing**, which the blanket refusal in
--     21_manual_ledger.sql already covers for the table. Named per column anyway,
--     because a future policy opening a single column would still pass a blanket
--     test.
--
--   * **Nobody types a settlement figure at all** — not a Franchise Admin at the
--     outlet they run, and not the owner. A manager may correct the drawer and
--     the typed channels at their own outlet, which is correct and is not
--     changed here; these columns are read from Zomato and reconciled against
--     the payout, so a figure a person could type is a figure the gate never saw.

create function pg_temp.day_column_unreadable(persona text, p_sub uuid, col text)
returns setof text language plpgsql as $$
declare
  visible bigint;
begin
  perform pg_temp.impersonate(p_sub);

  execute format(
    'select count(*) from public.aggregator_channel_days where %I is not null', col)
    into visible;
  return next is(visible, 0::bigint,
    format('%s reads no %s on any day', persona, col));

  execute 'reset role';
end;
$$;

select * from pg_temp.day_column_unreadable('biller_kalyani', :'BILLER_KAL',
  'settlement_state');
select * from pg_temp.day_column_unreadable('employee_kalyani', :'EMPLOYEE_KAL',
  'commission_paise');
select * from pg_temp.day_column_unreadable('employee_kalyani', :'EMPLOYEE_KAL',
  'superseded_revenue_paise');

-- A second settled channel day exercises the guard rather than a state-machine
-- transition or a CHECK.
select pg_temp.unimpersonate();
insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin)
values (:'KAL', 'zomato', pg_temp.ledger_day(3), 295000, 83338, 211662,
        'settled', 'settlement');

-- The refusal is now `42501` rather than `P0001`, and the change is the point.
--
-- It used to come from a trigger: the columns lived on a row every manager may
-- write, so something had to stand in front of them and raise. The figures have
-- their own table now and no client role is granted insert, update or delete on
-- it at all, so the request is refused before any policy or trigger is
-- consulted. A guard that has to fire is a guard that can be got round; a
-- privilege that was never granted cannot.
create function pg_temp.figure_column_unwritable(persona text, p_sub uuid, col text, val text)
returns setof text language plpgsql as $$
begin
  perform pg_temp.impersonate(p_sub);

  return next throws_ok(
    format('update public.aggregator_channel_days set %I = %s '
           'where outlet_id = %L and business_date = %L',
      col, val, '00000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00') - 3),
    '42501', null,
    format('%s cannot type %s on a day at their own outlet', persona, col));

  execute 'reset role';
end;
$$;

-- The manager who CAN correct that same day's drawer figures, proving the
-- refusal comes from the figure rather than from the day being out of reach.
select * from pg_temp.figure_column_unwritable('fa_kalyani', :'FA_KAL',
  'settlement_state', '''settled''');
select * from pg_temp.figure_column_unwritable('fa_kalyani', :'FA_KAL',
  'superseded_revenue_paise', '95000');
select * from pg_temp.figure_column_unwritable('the owner', :'OWNER',
  'settlement_state', '''settled''');
select * from pg_temp.figure_column_unwritable('the owner', :'OWNER',
  'revenue_paise', '95000');

-- `42501` rather than `P0001`: the owner is refused the whole table rather than
-- refused these columns on a table they may otherwise write. There is no longer
-- a way to record a day AS THOUGH it had been measured, because the day row and
-- the measurement are different records and only one of them accepts typing.
select pg_temp.impersonate(:'OWNER');
select throws_ok(
  format($q$
    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise,
       settlement_state, origin)
    values (%L, 'zomato', %L, 100000, 30000, 'settled', 'settlement') $q$,
    :'KAL', pg_temp.ledger_day(15)),
  '42501', null,
  'and a day cannot be recorded as though it had been measured');
reset role;

-- ---------------------------------------------------------------------------
-- 4. The constraints, each against a hand-crafted violation.

select pg_temp.unimpersonate();

-- A figure row rather than a day row, because that is where these constraints
-- live now. Revenue and the settlement state are supplied by every caller that
-- needs them, so they are not defaulted here: a case naming one would otherwise
-- collide with this list.
create function pg_temp.bad_day(cols text, vals text)
returns text language sql as $$
  select format(
    'insert into public.aggregator_channel_days '
    '(outlet_id, channel, business_date, origin, %s) '
    'values (''00000000-0000-4000-a000-000000000001'', ''zomato'', '
    'public.app_business_date(now(), time ''04:00'') - 9, ''daily_reader'', %s)',
    cols, vals)
$$;

/*
 * Four constraints that used to be tested here are gone, and their absence is the
 * point of the 2026-08-17 change rather than a gap in this file.
 *
 * A synced day used to carry its own gross, commission and net beside a typed
 * revenue and rate, which needed a constraint holding the triple together, one
 * making it add up, one pairing it with a state, and one zeroing the typed pair so
 * nothing could sum a measured figure with an estimated one. Commission is an
 * amount now, so both sources write the same two columns and net is a subtraction:
 * there is no triple to hold together, nothing to add up, and no second pair to
 * zero. A failure that cannot be represented needs no constraint, and one written
 * against it would describe a schema that no longer exists.
 *
 * What remains is everything about the ARCHIVE: what a figure moved from, and
 * when. Those are still separate columns, so they can still contradict the row
 * they sit on.
 */

select throws_ok(
  pg_temp.bad_day('revenue_paise, settlement_state', '100000, ''guessed'''),
  '23514', null,
  'an unknown settlement state is refused');

select throws_ok(
  pg_temp.bad_day(
    'revenue_paise, settlement_state, superseded_revenue_paise',
    '100000, ''settled'', 95000'),
  '23514', null,
  'a retained figure without the moment it was superseded is refused');

-- Half an archive is now LEGAL, and deliberately so: a typed day whose commission
-- was undetermined when the sync took it over archives the revenue the owner
-- recorded and a null beside it. Refusing that would throw away the half that was
-- known in order to avoid storing the half that never existed.
select lives_ok(
  pg_temp.bad_day(
    'revenue_paise, settlement_state, superseded_revenue_paise, '
    'superseded_at',
    '100000, ''settled'', 95000, now()'),
  'an archive may keep the revenue with the commission undetermined');

-- Removed again, because `bad_day` writes a fixed business date and every other
-- case on it expects to be the one inserting. The two `lives_ok` cases in this
-- section would otherwise collide on the uniqueness constraint rather than on the
-- claim being tested.
delete from public.aggregator_channel_days
 where outlet_id = '00000000-0000-4000-a000-000000000001'
   and business_date = public.app_business_date(now(), time '04:00') - 9;

-- `23502` rather than `23514`, and the mechanism changed rather than the claim.
-- A retained figure with nothing retaining it used to need a CHECK, because the
-- current figure lived in a nullable column on a row that existed for other
-- reasons. A figure row exists only to hold a figure, so revenue is NOT NULL and
-- the impossible state is now unrepresentable rather than merely refused.
select throws_ok(
  pg_temp.bad_day(
    'settlement_state, superseded_revenue_paise, superseded_commission_paise, '
    'superseded_at',
    '''settled'', 95000, 25000, now()'),
  '23502', null,
  'nothing can be superseded without something superseding it');

select throws_ok(
  pg_temp.bad_day(
    'revenue_paise, commission_paise, net_paise, settlement_state, '
    'provisional_revenue_paise, provisional_commission_paise, '
    'revised_at',
    '100000, 30000, 70000, ''provisional'', 99000, 29000, now()'),
  '23514', null,
  'only a settled day can have been revised');

select throws_ok(
  pg_temp.bad_day(
    'revenue_paise, commission_paise, net_paise, settlement_state, '
    'provisional_revenue_paise, provisional_commission_paise, '
    'revised_at',
    '100000, 30000, 70000, ''settled'', 100000, 30000, now()'),
  '23514', null,
  'and a day whose settled figures match the provisional ones cannot be marked '
  'revised, because nothing about it changed');

select lives_ok(
  pg_temp.bad_day(
    'revenue_paise, commission_paise, net_paise, settlement_state, '
    'provisional_revenue_paise, provisional_commission_paise, '
    'revised_at',
    '100000, 30000, 70000, ''settled'', 92085, 30000, now()'),
  'a settled day that grew when its week paid is stored with what it grew from');

-- ---------------------------------------------------------------------------
-- 5. The state machine.

select is(
  pg_temp.rows_changed(format(
    'update public.aggregator_channel_days set settlement_state = ''settled'' '
    'where outlet_id = %L and business_date = %L',
    :'KPA', pg_temp.ledger_day(2))),
  1::bigint,
  'a provisional day settles');

select throws_ok(
  format($q$
    update public.aggregator_channel_days set settlement_state = 'provisional'
     where outlet_id = %L and business_date = %L $q$,
    :'KPA', pg_temp.ledger_day(2)),
  'P0001', null,
  'and cannot be downgraded afterwards by a later run reading the live dashboard');

select throws_ok(
  format($q$
    update public.aggregator_channel_days set settlement_state = 'disputed'
     where outlet_id = %L and business_date = %L $q$,
    :'KPA', pg_temp.ledger_day(2)),
  'P0001', null,
  'nor disputed, because a settled figure has already reconciled');

-- A paid week that does not add up, and its way back out.
insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin)
values
  (:'KAL', 'zomato', pg_temp.ledger_day(11), 250000, 70000, 180000,
   'provisional', 'daily_reader');

select is(
  pg_temp.rows_changed(format(
    'update public.aggregator_channel_days set settlement_state = ''disputed'' '
    'where outlet_id = %L and business_date = %L',
    :'KAL', pg_temp.ledger_day(11))),
  1::bigint,
  'a paid week that will not reconcile becomes disputed rather than staying '
  'provisional, so it cannot be mistaken for the current week');

select throws_ok(
  format($q$
    update public.aggregator_channel_days set settlement_state = 'provisional'
     where outlet_id = %L and business_date = %L $q$,
    :'KAL', pg_temp.ledger_day(11)),
  'P0001', null,
  'a disputed week has been paid, so it cannot go back to awaiting payment');

select is(
  pg_temp.rows_changed(format(
    'update public.aggregator_channel_days set settlement_state = ''settled'' '
    'where outlet_id = %L and business_date = %L',
    :'KAL', pg_temp.ledger_day(11))),
  1::bigint,
  'but a later run that does reconcile settles it');

-- ---------------------------------------------------------------------------
-- 6. The sync date is scheduled, never applied retrospectively.

select throws_ok(
  format($q$
    insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
    values (%L, 'zomato', public.app_business_date(now(), time '04:00')) $q$,
    :'KAL'),
  'P0001', null,
  'a sync date on a business date already under way is refused, because it would '
  'move the boundary onto a day somebody has already typed');

select throws_ok(
  format($q$
    insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
    values (%L, 'zomato', public.app_business_date(now(), time '04:00') - 30) $q$,
    :'KPA'),
  'P0001', null,
  'and one in the past is refused for the same reason');

savepoint before_started_date;

-- A date that has already started can only be reached by living through it, so
-- it is planted with the guard disabled. Doing it any other way would be the
-- guard refusing the setup and the test passing for the wrong reason.
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
update public.outlet_channel_sync
   set synced_from = public.app_business_date(now(), time '04:00') - 1
 where outlet_id = :'KAL'::uuid;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

select throws_ok(
  format($q$
    update public.outlet_channel_sync set synced_from = current_date + 90
     where outlet_id = %L $q$, :'KAL'),
  'P0001', null,
  'a sync date that has already started cannot be moved');

rollback to savepoint before_started_date;

select is(
  pg_temp.rows_changed(format(
    'update public.outlet_channel_sync set synced_from = current_date + 40 where outlet_id = %L',
    :'KAL')),
  1::bigint,
  'while one that has not started yet can still be rescheduled');

-- Only one sync date per outlet per channel: a second would leave the boundary
-- ambiguous.
select throws_ok(
  format($q$
    insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
    values (%L, 'zomato', current_date + 50) $q$, :'KAL'),
  '23505', null,
  'and an outlet holds exactly one sync date per channel');

-- ---------------------------------------------------------------------------
-- 7. Cycle deductions and expense sources.

select throws_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values (%L, 'zomato', 'unexplained_settlement_difference',
            current_date - 7, current_date - 1, -7915, 'owner', 'week-30') $q$,
    :'KAL'),
  '23514', null,
  'an unexplained difference with nobody''s name on it is refused: it is a '
  'decision somebody made, not a fact Zomato reported');

select throws_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values (%L, 'zomato', 'tax_deducted_at_source',
            current_date - 22, current_date - 28, -31124, 'zomato', 'TDS::x::1') $q$,
    :'KAL'),
  '23514', null,
  'a period that ends before it starts is refused');

select throws_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values (%L, 'zomato', 'tax_deducted_at_source',
            current_date - 28, current_date - 22, -31124,
            'zomato', 'TDS::21917311::20260719') $q$,
    :'KAL'),
  '23505', null,
  'and the same Zomato record cannot be stored twice, which is what makes a '
  're-run over an overlapping window safe');

-- The same source id at the OTHER outlet is a different record, so the key is
-- per outlet rather than global.
select lives_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values (%L, 'zomato', 'tax_deducted_at_source',
            current_date - 28, current_date - 22, -31124,
            'zomato', 'TDS::21917311::20260719') $q$,
    :'KPA'),
  'the same source reference at another outlet is a separate record');

-- No recorder: a synced row was recorded by nobody, and naming an account would
-- be a lie with somebody's name on it.
insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, description,
   source_system, source_ref)
values (:'KAL', pg_temp.ledger_day(4), 'Other', false, 374777,
        'Hyperpure invoice HP-88213', 'zomato', 'HP-88213');

select throws_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description,
       source_system, source_ref, recorded_by)
    values (%L, %L, 'Other', false, 374777,
            'Hyperpure invoice HP-88213', 'zomato', 'HP-88213', %L) $q$,
    :'KAL', pg_temp.ledger_day(4), :'OWNER'),
  '23514', null,
  'a synced expense claiming a human recorder is refused outright');

select throws_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description,
       source_system, source_ref)
    values (%L, %L, 'Other', false, 374777,
            'Hyperpure invoice HP-88213', 'zomato', 'HP-88213') $q$,
    :'KAL', pg_temp.ledger_day(4)),
  '23505', null,
  'a synced expense arriving twice is refused, so an overlapping re-run updates '
  'in place rather than doubling the month''s costs');

-- Two hand-entered rows for the same purchase are still allowed. The owner may
-- legitimately record a thing twice, and the surface flags it rather than the
-- database refusing it — a partial unique index is why the null source does not
-- collide with itself.
select lives_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
    values (%L, %L, 'Other', false, 374777, 'Hyperpure, paid online', %L),
           (%L, %L, 'Other', false, 374777, 'Hyperpure, paid online', %L) $q$,
    :'KAL', pg_temp.ledger_day(4), :'OWNER',
    :'KAL', pg_temp.ledger_day(4), :'OWNER'),
  'two hand-entered expenses with no source are not treated as duplicates by the '
  'database, because that judgement is the owner''s to make');

select throws_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description,
       source_system, recorded_by)
    values (%L, %L, 'Other', false, 100, 'x', 'zomato', %L) $q$,
    :'KAL', pg_temp.ledger_day(4), :'OWNER'),
  '23514', null,
  'a source system with no reference identifies nothing and is refused');

-- ---------------------------------------------------------------------------
-- 8. The owner accepts a disputed week, and that is the only kind they may write.

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref, accepted_by, accepted_at)
    values (%L, 'zomato', 'unexplained_settlement_difference',
            current_date - 7, current_date - 1, -7915,
            'owner', 'accepted-week-30', %L, now()) $q$,
    :'KAL', :'OWNER'),
  'the owner accepts a disputed week, recording the gap with their own name on it');

select throws_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values (%L, 'zomato', 'tax_deducted_at_source',
            current_date - 7, current_date - 1, -5000, 'zomato', 'TDS::forged') $q$,
    :'KAL'),
  '42501', null,
  'but cannot write a deduction that is supposed to have come from Zomato');

select throws_ok(
  format($q$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref, accepted_by, accepted_at)
    values (%L, 'zomato', 'unexplained_settlement_difference',
            current_date - 7, current_date - 1, -7915,
            'owner', 'attributed-elsewhere', %L, now()) $q$,
    :'KAL', :'FA_KAL'),
  '42501', null,
  'nor attribute their own acceptance to somebody else');

reset role;

-- ---------------------------------------------------------------------------
-- 9. Losing the role ends the reach on the next request, not at token expiry.

savepoint before_revocation;

insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'FA_KPA', 'super_admin', null, current_date);

update public.assignments
   set ended_on = current_date
 where person_id = :'OWNER' and role = 'super_admin' and ended_on is null;

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.aggregator_cycle_deductions),
  0::bigint,
  'an owner whose Super Admin assignment has ended reads no settlement record');

select is(
  (select count(*) from public.aggregator_sync_runs),
  0::bigint,
  'and no sync run either');

reset role;
rollback to savepoint before_revocation;

savepoint before_deactivation;

update public.profiles set is_active = false where id = :'OWNER';

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.outlet_channel_sync),
  0::bigint,
  'a deactivated owner reads no sync date, while the assignment is still live');

reset role;
rollback to savepoint before_deactivation;

-- The premise, asserted after the rollbacks so a failure above cannot be
-- mistaken for these rows never having been readable.
select pg_temp.impersonate(:'OWNER');
select isnt(
  (select count(*) from public.aggregator_cycle_deductions),
  0::bigint,
  'with the assignment and the account restored, the owner reads them again');
reset role;

-- Switching a channel off leaves the figures it already read alone.
--
-- Carried from #42's rollback concern: clearing an outlet's synced-from date must
-- not touch the measured figures it produced. The figures live on their own table
-- with no reference to the sync row, so deleting the sync row cannot cascade —
-- proved rather than assumed, because "it has no foreign key" is the kind of fact
-- a later migration quietly changes.
select pg_temp.unimpersonate();
select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(2)),
  1::bigint,
  'the outlet has a measured figure before its sync is switched off');

delete from public.outlet_channel_sync
 where outlet_id = :'KAL'::uuid and channel = 'zomato';

select is(
  (select revenue_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(2)),
  297003::bigint,
  'and clearing the synced-from date leaves that figure exactly where it was');

select * from finish();
rollback;
