-- The business-date guard, from both sides of the cutover, without a clock.
--
-- `validate_business_date` refuses a row whose stored business date contradicts
-- what its own timestamp implies under the outlet's cutover. Fixtures across
-- the suite used to label rows with `current_date`, the UTC calendar date, and
-- for the ninety minutes between the 04:00 IST cutover and UTC midnight the two
-- disagreed and the suite failed. The fixtures now take their date from the
-- instant they stamp; this file is the proof that the guard they satisfy is
-- still a guard.
--
-- Every instant below is fixed, so nothing here reads `now()` or
-- `current_date`: it passes or fails identically at any hour, on any machine,
-- under any session timezone. It runs twice, under UTC and under Asia/Kolkata,
-- and a result that moved between them would mean the test was reading a clock
-- it should not.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- A synthetic bill at Kalyani (04:00 cutover), on the seeded biller, tablet and
-- legacy shift, rung at a stated instant and filed under a stated date. Not a
-- command, so the guard reads the bill's `created_at`.
create function pg_temp.ring_at(p_at timestamptz, p_business_date date)
returns void language sql as $$
  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise, payment_method, created_at)
  values (
    gen_random_uuid(), '00000000-0000-4000-a000-000000000001', 0, p_business_date,
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    20000, 0, 0, 0, 20000, 'cash', p_at)
$$;

create function pg_temp.either_side(p_zone text) returns setof text
language plpgsql as $$
begin
  perform set_config('timezone', p_zone, true);

  -- 03:30 IST on the 21st is still the 20th's trading day.
  return next lives_ok(
    $q$select pg_temp.ring_at('2026-09-21 03:30+05:30', date '2026-09-20')$q$,
    format('[%s] half an hour before the cutover, the previous business date is accepted', p_zone));
  return next throws_like(
    $q$select pg_temp.ring_at('2026-09-21 03:30+05:30', date '2026-09-21')$q$,
    '%contradicts the outlet cutover%',
    format('[%s] half an hour before the cutover, the calendar date is refused', p_zone));

  -- 04:30 IST on the 21st is the 21st's trading day -- and 23:00 UTC on the
  -- 20th, which is exactly where `current_date` used to answer wrongly.
  return next lives_ok(
    $q$select pg_temp.ring_at('2026-09-21 04:30+05:30', date '2026-09-21')$q$,
    format('[%s] half an hour after the cutover, the current business date is accepted', p_zone));
  return next throws_like(
    $q$select pg_temp.ring_at('2026-09-21 04:30+05:30', date '2026-09-20')$q$,
    '%contradicts the outlet cutover%',
    format('[%s] half an hour after the cutover, the UTC calendar date is refused', p_zone));
end;
$$;

select * from pg_temp.either_side('UTC');
select * from pg_temp.either_side('Asia/Kolkata');

select * from finish();
rollback;
