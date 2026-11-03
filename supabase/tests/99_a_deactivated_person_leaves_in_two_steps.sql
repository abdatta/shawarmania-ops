-- A deactivated person leaves in two steps (#82,
-- a-deactivated-person-leaves-in-two-steps, behind `deactivate-then-leave` and
-- `owner-access-in-the-database`).
--
-- Held here: the gates' rows arrive off; `profiles.deactivated_at` is read
-- under `profiles_select` and nothing wider; `mark_account_as_left_v2` refuses
-- with its gate off, refuses an active account, a stale fingerprint, a manager
-- for somebody who also works elsewhere, and an owner while owner access is
-- the database's; it ends every live assignment on the deactivation day (an
-- assignment begun after that day, on its own start), clears the phone, and
-- dates an undated deactivation by Kolkata today; and no browser may call it.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set STAFF_KAL '10000000-0000-4000-a000-000000000006'
\set STAFF_KPA '10000000-0000-4000-a000-000000000007'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set SPLIT '10000000-0000-4000-a000-00000000000e'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

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
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.kolkata_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

/** Deactivate as the account function does: the flag and the day together. */
/** Deactivated at 15:00 Kolkata on a given day, as the account function stamps it. */
create function pg_temp.deactivate(p_person uuid, p_on date)
returns void language sql as $$
  update public.profiles
     set is_active = false,
         deactivated_at = (p_on + time '15:00') at time zone 'Asia/Kolkata'
   where id = p_person
$$;

create function pg_temp.leave(p_actor uuid, p_person uuid)
returns text language sql as $$
  select format('select * from public.mark_account_as_left_v2(%L, %L, %L)',
                p_actor, p_person, public.account_state_fingerprint(p_person))
$$;

-- ---------------------------------------------------------------------------
-- The gates, off.

select is(
  (select array_agg(code || ':' || enabled::text order by code)
     from public.change_gates
    where key in ('deactivate-then-leave', 'owner-access-in-the-database')),
  array['DL:false', 'OD:false'],
  'both gates arrive, off'
);
select is(
  (select change_number from public.change_gates where key = 'deactivate-then-leave'),
  82,
  'deactivate-then-leave names its roadmap row'
);
select has_column('public', 'profiles', 'deactivated_at', 'profiles carries the deactivation moment');
select col_type_is('public', 'profiles', 'deactivated_at', 'timestamp with time zone', 'the moment is a timestamp');
select col_is_null('public', 'profiles', 'deactivated_at', 'and nullable, since an active account has none');

-- ---------------------------------------------------------------------------
-- Off: the new leave refuses, whoever asks.

select pg_temp.deactivate(:'BILLER_KAL', pg_temp.kolkata_today() - 3);
select throws_ok(
  pg_temp.leave(:'OWNER', :'BILLER_KAL'),
  'P0001', 'deactivate-then-leave is off',
  'v2 refuses while deactivate-then-leave is off'
);
select is(
  (select count(*) from public.assignments where person_id = :'BILLER_KAL' and ended_on is null),
  1::bigint,
  'and ends nothing'
);

update public.change_gates set enabled = true where key = 'deactivate-then-leave';

-- ---------------------------------------------------------------------------
-- An active account is never left: deactivate first.

select throws_ok(
  pg_temp.leave(:'FA_KAL', :'STAFF_KAL'),
  'P0001', 'deactivate first',
  'an active account is refused'
);
select is(
  (select count(*) from public.assignments where person_id = :'STAFF_KAL' and ended_on is null),
  1::bigint,
  'and keeps its outlet'
);

-- A stale fingerprint is refused before anything changes.
select throws_ok(
  format('select * from public.mark_account_as_left_v2(%L, %L, %L)',
         :'FA_KAL', :'BILLER_KAL', 'stale'),
  'P0001', 'stale account state',
  'a stale fingerprint is refused'
);

-- ---------------------------------------------------------------------------
-- A manager leaves a deactivated Biller wholly theirs, dated by the deactivation.

select is(
  (select left_on from public.mark_account_as_left_v2(
     :'FA_KAL', :'BILLER_KAL', public.account_state_fingerprint(:'BILLER_KAL'))),
  pg_temp.kolkata_today() - 3,
  'a manager leaves a deactivated Biller of their own outlet, on the deactivation day'
);
select is(
  (select ended_on from public.assignments where person_id = :'BILLER_KAL' and role = 'biller'),
  pg_temp.kolkata_today() - 3,
  'their outlet ends on the day they were deactivated, not today'
);
select is(
  (select phone from public.profiles where id = :'BILLER_KAL'),
  null,
  'their phone is cleared, so it is free for somebody else'
);
select is(
  (select is_active from public.profiles where id = :'BILLER_KAL'),
  false,
  'and they stay unable to sign in'
);

-- ---------------------------------------------------------------------------
-- Somebody who also works at an outlet the manager does not run is the owner's.

select pg_temp.deactivate(:'SPLIT', pg_temp.kolkata_today() - 2);
select throws_ok(
  pg_temp.leave(:'FA_KAL', :'SPLIT'),
  '42501', 'forbidden departure',
  'a manager cannot leave a person who also works at another outlet'
);
select is(
  (select count(*) from public.assignments where person_id = :'SPLIT' and ended_on is null),
  2::bigint,
  'and both outlets stay'
);

-- ---------------------------------------------------------------------------
-- An assignment begun after the deactivation ends the day it began.

select pg_temp.deactivate(:'STAFF_KAL', pg_temp.kolkata_today() - 5);
insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'STAFF_KAL', 'employee', :'KPA', pg_temp.kolkata_today() - 1);
select lives_ok(pg_temp.leave(:'OWNER', :'STAFF_KAL'), 'the owner leaves somebody at two outlets');
select is(
  (select ended_on from public.assignments
    where person_id = :'STAFF_KAL' and outlet_id = :'KAL'),
  pg_temp.kolkata_today() - 5,
  'the outlet they held when deactivated ends on that day'
);
select is(
  (select ended_on from public.assignments
    where person_id = :'STAFF_KAL' and outlet_id = :'KPA'),
  pg_temp.kolkata_today() - 1,
  'the one begun after it ends on its own start, never before it'
);

-- ---------------------------------------------------------------------------
-- A deactivation with no recorded day is dated by Kolkata today, and recorded.

update public.profiles set is_active = false where id = :'STAFF_KPA';
select is(
  (select left_on from public.mark_account_as_left_v2(
     :'OWNER', :'STAFF_KPA', public.account_state_fingerprint(:'STAFF_KPA'))),
  pg_temp.kolkata_today(),
  'an undated deactivation leaves on Kolkata today'
);
select is(
  (select (deactivated_at at time zone 'Asia/Kolkata')::date from public.profiles where id = :'STAFF_KPA'),
  pg_temp.kolkata_today(),
  'and the moment is recorded on the account'
);

-- ---------------------------------------------------------------------------
-- An owner is left only in the database while owner access is the database's.

insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'FA_KPA', 'super_admin', null, pg_temp.kolkata_today());
select pg_temp.deactivate(:'FA_KPA', pg_temp.kolkata_today());
update public.change_gates set enabled = true where key = 'owner-access-in-the-database';
select throws_ok(
  pg_temp.leave(:'OWNER', :'FA_KPA'),
  '42501', 'owner access is changed in the database',
  'with owner-access-in-the-database on, an owner cannot be marked as left'
);
select is(
  (select count(*) from public.assignments where person_id = :'FA_KPA' and ended_on is null),
  2::bigint,
  'and keeps both their assignments'
);

-- ---------------------------------------------------------------------------
-- The day is read under profiles_select, and no wider.

select pg_temp.deactivate(:'SPLIT', pg_temp.kolkata_today() - 2);
select pg_temp.impersonate(:'FA_KAL');
select is(
  (select (deactivated_at at time zone 'Asia/Kolkata')::date from public.profiles where id = :'SPLIT'),
  pg_temp.kolkata_today() - 2,
  'a manager reads the moment of somebody working at their outlet'
);
select pg_temp.as_service();
update public.assignments set ended_on = pg_temp.kolkata_today()
 where person_id = :'SPLIT' and outlet_id = :'KAL' and ended_on is null;
select pg_temp.impersonate(:'FA_KAL');
select is(
  (select count(*) from public.profiles where id = :'SPLIT' and deactivated_at is not null),
  0::bigint,
  'and nothing of somebody who works only at another outlet'
);
select pg_temp.as_service();

-- ---------------------------------------------------------------------------
-- Service only.

select ok(
  not has_function_privilege(
    'authenticated', 'public.mark_account_as_left_v2(uuid,uuid,text)', 'execute'),
  'a signed-in browser cannot call the new leave'
);
select ok(
  not has_function_privilege(
    'anon', 'public.mark_account_as_left_v2(uuid,uuid,text)', 'execute'),
  'nor can an anonymous one'
);
select ok(
  has_function_privilege(
    'service_role', 'public.mark_account_as_left_v2(uuid,uuid,text)', 'execute'),
  'the account function can'
);
select ok(
  has_function_privilege('service_role', 'public.app_change_gate(text)', 'execute'),
  'the account function reads the gates with the service role'
);
-- Sign-in switched off and on, its moment by the database clock.
select pg_temp.as_service();
select public.account_set_active(:'STAFF_KAL', true);
select is((select deactivated_at from public.profiles where id = :'STAFF_KAL'), null,
  'reactivating clears the moment');
select public.account_set_active(:'STAFF_KAL', false);
select is((select deactivated_at from public.profiles where id = :'STAFF_KAL'), now(),
  'deactivating stamps the database''s now');
update public.profiles set deactivated_at = now() - interval '3 days' where id = :'STAFF_KAL';
select public.account_set_active(:'STAFF_KAL', false);
select is((select deactivated_at from public.profiles where id = :'STAFF_KAL'), now() - interval '3 days',
  'deactivating somebody already inactive keeps their moment');
update public.profiles set deactivated_at = null where id = :'STAFF_KAL';
select public.account_stamp_deactivated(:'STAFF_KAL');
select is((select deactivated_at from public.profiles where id = :'STAFF_KAL'), now(),
  'the original Mark as left dates an undated departure now');
select ok(
  not has_function_privilege('authenticated', 'public.account_set_active(uuid,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.account_stamp_deactivated(uuid)', 'execute'),
  'and only the account function writes it'
);

select * from finish();
rollback;
