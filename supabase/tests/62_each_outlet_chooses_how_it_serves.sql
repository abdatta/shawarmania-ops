-- each-outlet-chooses-how-it-serves (#60), section 3: the settings in the
-- database.
--
-- Three things this file has to prove, and each fails differently:
--
--   * every outlet starts with nothing chosen, and the database itself refuses
--     every inconsistent combination — a form that refuses them proves nothing
--     about a hand-crafted request;
--   * the owner writes any outlet's choices and a manager their own outlet's,
--     through one narrow function that reaches these six columns and no others —
--     a wider `outlets_update` would pass every functional test and hand a
--     manager the cutover and the check-in fence;
--   * the choices are read exactly where the outlet row is read, a tablet
--     included for its own outlet only.

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

create function pg_temp.as_server()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

--   outlets  00000000-…0001 Kalyani   00000000-…0002 Kanchrapara
--   people   10000000-…0001 owner     …0002 fa_kalyani    …0003 fa_kanchrapara
--            …0004 device_kalyani     …0005 device_kanchrapara
--            …000a biller_kalyani     …0006 employee_kalyani

-- ---------------------------------------------------------------------------
-- Every outlet starts with nothing chosen.

select pg_temp.as_server();

select is(
  (select count(*) from public.outlets
    where dine_in_offered or takeaway_offered or table_numbers
       or packaging_mode <> 'off' or packaging_price_paise is not null
       or packaging_free_for_gold),
  0::bigint,
  'every existing outlet has chosen nothing, and bills exactly as it did');

insert into public.outlets (id, code, name, location_label)
values ('00000000-0000-4000-a000-000000000060', 'servetest', 'Synthetic Serve Test', 'Nowhere');

select is(
  (select row(dine_in_offered, takeaway_offered, table_numbers, packaging_mode::text,
              packaging_price_paise, packaging_free_for_gold)::text
     from public.outlets where id = '00000000-0000-4000-a000-000000000060'),
  row(false, false, false, 'off'::text, null::integer, false)::text,
  'a new outlet offers no type, no table numbers and no packaging charge');

-- ---------------------------------------------------------------------------
-- The database refuses what does not make sense, however it is asked.

select throws_ok($q$
  update public.outlets set table_numbers = true
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'table numbers without dine-in are refused');

select throws_ok($q$
  update public.outlets set packaging_mode = 'per_bag', packaging_price_paise = 500
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a packaging charge without takeaway is refused');

select throws_ok($q$
  update public.outlets set takeaway_offered = true, packaging_mode = 'per_bag'
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a packaging charge with no price is refused');

select throws_ok($q$
  update public.outlets set packaging_price_paise = 500
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a packaging price without a packaging charge is refused');

select throws_ok($q$
  update public.outlets
     set takeaway_offered = true, packaging_mode = 'per_bag', packaging_price_paise = 550
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a packaging price in part-rupees is refused');

select throws_ok($q$
  update public.outlets
     set takeaway_offered = true, packaging_mode = 'per_order', packaging_price_paise = 0
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a packaging price below one rupee is refused');

select throws_ok($q$
  update public.outlets set packaging_free_for_gold = true
   where id = '00000000-0000-4000-a000-000000000060'
$q$, '23514', null, 'a gold waiver without a packaging charge is refused');

select lives_ok($q$
  update public.outlets
     set takeaway_offered = true, packaging_mode = 'per_order',
         packaging_price_paise = 250000, packaging_free_for_gold = true
   where id = '00000000-0000-4000-a000-000000000060'
$q$, 'a whole-rupee packaging price has no ceiling');

-- ---------------------------------------------------------------------------
-- The owner writes any outlet's choices through the one function.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

select lives_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000002', true, true, true, 'per_bag', 500, true)
$q$, 'the owner sets Kanchrapara''s choices');

select is(
  (select row(dine_in_offered, takeaway_offered, table_numbers, packaging_mode::text,
              packaging_price_paise, packaging_free_for_gold)::text
     from public.outlets where id = '00000000-0000-4000-a000-000000000002'),
  row(true, true, true, 'per_bag'::text, 500, true)::text,
  'and every one of them round-trips');

select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000002', true, false, false, 'per_bag', 500, false)
$q$, '23514', null, 'the function meets the same checks: packaging without takeaway');

-- ---------------------------------------------------------------------------
-- A manager writes their own outlet's choices, and nothing else of it.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select lives_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000001', true, true, false, 'per_order', 1000, false)
$q$, 'a manager sets the choices of the outlet they manage');

select is(
  (select row(dine_in_offered, takeaway_offered, table_numbers, packaging_mode::text,
              packaging_price_paise, packaging_free_for_gold)::text
     from public.outlets where id = '00000000-0000-4000-a000-000000000001'),
  row(true, true, false, 'per_order'::text, 1000, false)::text,
  'and they are stored');

select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000002', false, false, false, 'off', null, false)
$q$, '42501', null, 'a manager cannot set another outlet''s choices');

select is(
  (select packaging_price_paise from public.outlets
    where id = '00000000-0000-4000-a000-000000000002'),
  null::integer, 'and another outlet''s row is not even readable to check');

select pg_temp.as_server();
select is(
  (select packaging_price_paise from public.outlets
    where id = '00000000-0000-4000-a000-000000000002'),
  500, 'Kanchrapara''s choices are untouched');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select is(pg_temp.rows_touched($q$
  update public.outlets set packaging_price_paise = 2000
   where id = '00000000-0000-4000-a000-000000000001'
$q$), 0::bigint, 'the function is the manager''s only door: a direct write touches no rows');

select is(pg_temp.rows_touched($q$
  update public.outlets set business_day_cutover = time '06:00'
   where id = '00000000-0000-4000-a000-000000000001'
$q$), 0::bigint, 'and the cutover stays the owner''s');

select is(pg_temp.rows_touched($q$
  update public.outlets set geofence_radius_m = 5000
   where id = '00000000-0000-4000-a000-000000000001'
$q$), 0::bigint, 'and so does the check-in fence');

-- ---------------------------------------------------------------------------
-- Nobody else writes them, however the request is made.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false)
$q$, '42501', null, 'a biller cannot set their outlet''s choices');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false)
$q$, '42501', null, 'an employee cannot set their outlet''s choices');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false)
$q$, '42501', null, 'a counter device cannot set its own outlet''s choices');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select public.set_outlet_service_settings(
    '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false)
$q$, '42501', null, 'the other outlet''s manager cannot set Kalyani''s choices');

select pg_temp.as_server();
select is(
  (select packaging_price_paise from public.outlets
    where id = '00000000-0000-4000-a000-000000000001'),
  1000, 'and after every refusal Kalyani''s choices are what its manager set');

-- ---------------------------------------------------------------------------
-- The choices are read where the outlet row is read — a tablet included, for
-- its own outlet only (design D6: no function needed, `outlets_select` already
-- reaches a device's own row).

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select packaging_price_paise from public.outlets
    where id = '00000000-0000-4000-a000-000000000001'),
  1000, 'Kalyani''s tablet reads Kalyani''s choices');
select is(
  (select count(*) from public.outlets where id = '00000000-0000-4000-a000-000000000002'),
  0::bigint, 'and nothing of Kanchrapara''s');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  (select count(*) from public.outlets where id = '00000000-0000-4000-a000-000000000001'),
  0::bigint, 'Kanchrapara''s tablet reads nothing of Kalyani''s choices');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is(
  (select count(*) from public.outlets where id = '00000000-0000-4000-a000-000000000002'),
  0::bigint, 'an employee reads nothing of an outlet they do not work at');

select * from finish();
rollback;
