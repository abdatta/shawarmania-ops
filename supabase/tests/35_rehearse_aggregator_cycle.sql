-- A rehearsal decides everything a real run decides, and writes none of it.
--
-- Two claims, and the second is the one worth the file:
--
--  1. The verdict a rehearsal returns is the verdict the real path produced. It
--     is not a second implementation of the reconciliation gate, because a second
--     implementation would be the thing being tested while the first is the thing
--     that runs.
--  2. Nothing survives. Not the day figures, not the expenses, not the
--     deductions, not the superseded pre-image, not a disputed marking. The
--     rehearsal exists so the owner can read a real decision before their ledger
--     carries it, and a rehearsal that left one column behind would be worse than
--     none: they would trust the next one.
--
-- The mechanism rests on a PL/pgSQL asymmetry — a caught exception rolls back the
-- database changes inside the block but not the variable assignments. That is
-- load-bearing and non-obvious, so the first assertion below proves it rather
-- than assuming it.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

/*
 * The sync boundary, planted in the past.
 *
 * `ingest_aggregator_cycle` refuses to touch a day before the date its outlet was
 * switched on, so every case below needs a boundary earlier than the days it writes.
 * The trigger is disabled to plant it, because it deliberately refuses a date that
 * has already started: switching a sync on is a scheduled act, and applying one
 * retrospectively over days somebody already typed is the thing it exists to stop.
 */
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values ('00000000-0000-4000-a000-000000000001', 'zomato',
        public.app_business_date(now(), time '04:00') - 60),
       ('00000000-0000-4000-a000-000000000002', 'zomato',
        public.app_business_date(now(), time '04:00') - 60)
on conflict (outlet_id, channel) do update set synced_from = excluded.synced_from;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;


\set OWNER '10000000-0000-4000-a000-000000000001'
\set KAL '00000000-0000-4000-a000-000000000001'

create function pg_temp.ledger_day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- A plain typed day, of the kind the sync supersedes. Deliberately carrying a
-- typed figure, because the interesting rollback is of the supersede: that path
-- moves the owner's own two numbers aside and stamps the moment it did.
insert into public.manual_ledger_days
  (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
   zomato_revenue_paise, zomato_commission_paise, swiggy_commission_paise, recorded_by)
values (:'KAL'::uuid, pg_temp.ledger_day(3), 500000, 500000, 250000, 2800, 0, :'OWNER'::uuid);

-- Reconciles exactly: 216000 of orders, less 40000 of deductions, is 176000.
create function pg_temp.payload(p_state text, p_stated bigint)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.ledger_day(3),
    'cycle_end', pg_temp.ledger_day(3),
    'cycle_state', p_state,
    'stated_payout_paise', p_stated,
    'orders', jsonb_build_array(
      jsonb_build_object(
        'order_id', 'rehearsal-1',
        'placed_at', (pg_temp.ledger_day(3) + time '19:00')::timestamptz,
        'gross_paise', 300000,
        'commission_paise', 84000,
        'net_paise', 216000)),
    'deductions', jsonb_build_array(
      jsonb_build_object(
        'spent_on', pg_temp.ledger_day(5),
        'category', 'Supplies',
        'amount_paise', 40000,
        'description', 'Hyperpure invoice HP-1',
        'source_ref', 'HP-1')),
    'cycle_deductions', '[]'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- 1. The verdict survives the rollback.
--
-- If PL/pgSQL rolled variable assignments back along with the writes, this would
-- come back null and every other assertion in the file would be checking the
-- behaviour of nothing.

create temporary table rehearsed as
select public.rehearse_aggregator_cycle(
         pg_temp.payload('settled', 176000), array[:'KAL'::uuid]) as verdict;

select is(
  (select verdict ->> 'outcome' from rehearsed),
  'ok',
  'the verdict computed inside the rolled-back block survives it'
);

select is(
  (select verdict -> 'rehearsal' from rehearsed),
  'true'::jsonb,
  'and says plainly that it was a rehearsal'
);

select is(
  (select (verdict ->> 'days_written')::int from rehearsed),
  1,
  'it reports the day it would have written'
);

select is(
  (select (verdict ->> 'computed_paise')::bigint from rehearsed),
  176000::bigint,
  'and the figure it reconciled, from the real path rather than a second one'
);

select is(
  (select (verdict ->> 'difference_paise')::bigint from rehearsed),
  0::bigint,
  'with no difference against the stated payout'
);

-- The report the owner actually reads: which day, from what, to what. Without
-- this the rehearsal answers "it would have worked" and leaves them no wiser
-- about whether the numbers are right.
select is(
  (select jsonb_array_length(verdict -> 'days_that_would_change') from rehearsed),
  1,
  'the report names the day that would move'
);

select is(
  (select verdict -> 'days_that_would_change' -> 0 -> 'to' ->> 'net_paise' from rehearsed),
  '216000',
  'and what it would move to'
);

-- The assertion the first build failed. Reading the pre-image out of the
-- provisional columns gave a report whose "from" was the value it had just been
-- changed to, and a report that says a day changed from a number to the same
-- number is worse than no report: it looks like a rehearsal that found nothing.
--
-- On a typed day the "from" side is the owner's own pair, which is exactly the
-- comparison they want: their number beside Zomato's. ₹2,500.00 typed less ₹28.00
-- charged is ₹2,472.00, against Zomato's ₹2,160.00.
select is(
  (select verdict -> 'days_that_would_change' -> 0 -> 'from' ->> 'revenue_paise' from rehearsed),
  '250000',
  'and what it would move FROM, which on a typed day is what the owner typed'
);

select is(
  (select verdict -> 'days_that_would_change' -> 0 -> 'from' ->> 'net_paise' from rehearsed),
  '247200',
  'reported as a net too, so the two sides can be compared without arithmetic'
);

select isnt(
  (select verdict -> 'days_that_would_change' -> 0 -> 'from' from rehearsed),
  (select verdict -> 'days_that_would_change' -> 0 -> 'to' from rehearsed),
  'a day only appears in the report when the two sides actually differ'
);

select is(
  (select (verdict ->> 'expenses_that_would_appear')::int from rehearsed),
  1,
  'and that one Hyperpure expense would appear'
);

-- ---------------------------------------------------------------------------
-- 2. Nothing was written.
--
-- Every column the real path touches, checked as it stands after the rehearsal.
-- The day was typed and stays typed.

-- Still the owner's own net, not Zomato's ₹2,160.00. There is no stored net column
-- to be null any more, so the honest claim is that the subtraction still answers
-- with what they typed.
select is(
  (select zomato_revenue_paise - zomato_commission_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  247200::bigint,
  'the day still nets to what the owner typed, not to what Zomato reported'
);

select is(
  (select zomato_settlement_state from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  null,
  'and no settlement state'
);

-- The owner's typed figure is untouched, in both places it could have moved: the
-- live column and the superseded pre-image. A rehearsal that zeroed the typed
-- revenue would have taken a real number off a real day.
select is(
  (select zomato_revenue_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  250000::bigint,
  'the typed revenue is exactly as the owner left it'
);

select is(
  (select zomato_commission_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  2800::bigint,
  'and so is the commission they typed against it'
);

select is(
  (select zomato_superseded_at from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  null,
  'nothing was superseded'
);

select is(
  (select count(*)::int from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_system = 'zomato'),
  0,
  'no synced expense was left behind'
);

select is(
  (select count(*)::int from public.aggregator_cycle_deductions
    where outlet_id = :'KAL'::uuid),
  0,
  'and no cycle deduction'
);

-- ---------------------------------------------------------------------------
-- 3. A cycle that will not reconcile is refused in rehearsal too, and the
--    refusal does not stick.
--
-- The disputed marking is a write like any other. If it survived a rehearsal,
-- reading a week would mark it disputed, and the owner would arrive at a screen
-- asking them to resolve something nobody had decided.

create temporary table refused as
select public.rehearse_aggregator_cycle(
         pg_temp.payload('settled', 183915), array[:'KAL'::uuid]) as verdict;

select is(
  (select verdict ->> 'outcome' from refused),
  'reconciliation_failed',
  'a cycle that does not add up is refused in rehearsal, by the real gate'
);

select is(
  (select (verdict ->> 'difference_paise')::bigint from refused),
  -7915::bigint,
  'and reports the gap, in the direction the real path reports it'
);

select is(
  (select zomato_settlement_state from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(3)),
  null,
  'and marks nothing disputed, because a rehearsal decides and does not record'
);

-- ---------------------------------------------------------------------------
-- 4. A rehearsal cannot be mistaken for a run that did something.

-- Recorded in a statement of their own. Calling the recorder inside the WHERE of
-- a select against the table it writes to reads from a snapshot taken before the
-- insert, so the row is invisible and the assertion fails for a reason that has
-- nothing to do with the claim.
create temporary table recorded as
select public.record_aggregator_sync_run(
         :'KAL'::uuid, 'zomato', now(), 'ok', 'read two cycles, wrote nothing', true)
         as rehearsal_run,
       public.record_aggregator_sync_run(
         :'KAL'::uuid, 'zomato', now(), 'ok', 'wrote seven days')
         as ordinary_run;

select is(
  (select rehearsal from public.aggregator_sync_runs
    where id = (select rehearsal_run from recorded)),
  true,
  'a run can record that it was a rehearsal'
);

select is(
  (select rehearsal from public.aggregator_sync_runs
    where id = (select ordinary_run from recorded)),
  false,
  'and an ordinary run is not one by default'
);

-- The old five-argument form is gone rather than left beside the new one. Two
-- overloads differing only by a defaulted trailing argument would let a caller
-- record a rehearsal as a real run by omitting one word.
select is(
  (select count(*)::int from pg_proc
    where proname = 'record_aggregator_sync_run'),
  1,
  'there is one way to record a run, not two that differ by a default'
);

-- ---------------------------------------------------------------------------
-- 5. Neither function is reachable by anybody who signs in.

select ok(
  not has_function_privilege(
    'authenticated', 'public.rehearse_aggregator_cycle(jsonb, uuid[])', 'EXECUTE'),
  'authenticated cannot rehearse a cycle'
);

select ok(
  has_function_privilege(
    'service_role', 'public.rehearse_aggregator_cycle(jsonb, uuid[])', 'EXECUTE'),
  'the service role can, since the reader is the caller'
);

select * from finish();
rollback;
