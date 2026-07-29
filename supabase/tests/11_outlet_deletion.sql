-- Deleting an outlet: who may, when the database refuses, and what survives a
-- refusal.
--
-- Two claims carry this file. The first is that `outlets` is deletable by the
-- Super Admin and by nobody else — asserted by hand-crafted statements from
-- every other role, because a disabled button proves nothing about a boundary.
-- The second is that **nothing cascades**: a refused delete must leave every
-- referencing row exactly where it was, and it is that absence, rather than
-- any flag, that makes "empty it and then delete it" work.
--
-- Outlets are created here rather than borrowed from the seed: the seeded two
-- carry a traded day each, so a test written against them would be asserting
-- against whatever the seed happens to contain rather than against the rule.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid, p_role text, p_outlet uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_sub, 'role', 'authenticated',
      'app_role', p_role, 'app_outlet_id', p_outlet
    )::text,
    true);
  execute 'set local role authenticated';
end;
$$;

-- The cast of outlets. Each one exists to be refused for a different reason,
-- except the first, which exists to succeed.
insert into public.outlets (id, code, name, location_label) values
  ('00000000-0000-4000-a000-0000000000f1', 'del-bare',    'Bare Outlet',    'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f2', 'del-roster',  'Roster Outlet',  'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f3', 'del-profile', 'Profile Outlet', 'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f4', 'del-device',  'Device Outlet',  'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f5', 'del-dead',    'Dormant Outlet', 'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f6', 'del-emptied', 'Emptied Outlet', 'Nowhere'),
  ('00000000-0000-4000-a000-0000000000f7', 'del-denied',  'Denied Outlet',  'Nowhere');

-- People, accounts and devices are moved rather than invented: a profile's id
-- is an auth user's id, and this file has no business creating those. Staff
-- are accounts now, so "a staff member at f2" and "an account at f3" are the
-- same kind of row wearing different roles — both are asserted anyway,
-- because each was once a separate table and each has its own count below.
update public.profiles set outlet_id = '00000000-0000-4000-a000-0000000000f2'
 where id = '10000000-0000-4000-a000-00000000000c';

update public.profiles set outlet_id = '00000000-0000-4000-a000-0000000000f6'
 where id = '10000000-0000-4000-a000-00000000000d';

update public.profiles set outlet_id = '00000000-0000-4000-a000-0000000000f3'
 where id = '10000000-0000-4000-a000-000000000003';

update public.counter_devices set outlet_id = '00000000-0000-4000-a000-0000000000f4'
 where id = '10000000-0000-4000-a000-000000000005';

-- f5's only reference is an account somebody has already switched off.
update public.profiles
   set outlet_id = '00000000-0000-4000-a000-0000000000f5', is_active = false
 where id = '10000000-0000-4000-a000-000000000008';

-- ---------------------------------------------------------------------------
-- The owner deletes an outlet nothing references.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f1';

select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f1'), 0::bigint,
  'the super admin deletes an outlet nothing references');

-- ---------------------------------------------------------------------------
-- A populated outlet refuses, and nothing of it is touched.

select throws_ok($q$
  delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f2'
$q$, '23503', null, 'an outlet with a staff member cannot be deleted');

reset role;

select is((select count(*) from public.profiles
            where outlet_id = '00000000-0000-4000-a000-0000000000f2'), 1::bigint,
  'and the person is still there — the refusal removed nothing');

select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f2'), 1::bigint,
  'as is the outlet itself');

-- The two whose absence would be least obvious: an app account, and a tablet.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

select throws_ok($q$
  delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f3'
$q$, '23503', null, 'an outlet with an app account attached cannot be deleted');

select throws_ok($q$
  delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f4'
$q$, '23503', null, 'nor one with a counter device enrolled against it');

reset role;

select is((select count(*) from public.profiles
            where outlet_id = '00000000-0000-4000-a000-0000000000f3'), 1::bigint,
  'the account survives its outlet''s refused deletion');

select is((select count(*) from public.counter_devices
            where outlet_id = '00000000-0000-4000-a000-0000000000f4'), 1::bigint,
  'and so does the device');

-- A deactivated account still blocks: "nothing references it" stays literally
-- true, with no exception to explain in the refusal (design D5).

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

select throws_ok($q$
  delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f5'
$q$, '23503', null,
  'an outlet whose only reference is a deactivated account is still refused');

-- ---------------------------------------------------------------------------
-- Emptying an outlet makes it deletable, with nothing else to re-mark. People
-- are not deletable, so emptying means reassigning them — which is the honest
-- shape of closing a shop that still employs somebody.

reset role;
update public.profiles set outlet_id = '00000000-0000-4000-a000-000000000002'
 where id = '10000000-0000-4000-a000-00000000000d';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f6';

select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f6'), 0::bigint,
  'reassigning the last person is the only step — no flag to update');

-- ---------------------------------------------------------------------------
-- Every other role, by hand-crafted statement rather than by a missing button.
--
-- A policy that grants no rows makes DELETE a silent no-op rather than an
-- error, so what is asserted is that the row is still there afterwards. That
-- is also why the adapter checks what came back instead of trusting silence.
--
-- Every count below is taken after `reset role`, deliberately. Asked as the
-- role that just tried the delete, `select count(*)` answers through
-- outlets_select — which shows a scoped role only its own outlet — so a row
-- that was never deleted would still read as absent. That assertion would
-- pass whether or not the delete worked, which makes it worse than no
-- assertion at all.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f7';
delete from public.outlets where id = '00000000-0000-4000-a000-000000000001';

reset role;
select is((select count(*) from public.outlets
            where id in ('00000000-0000-4000-a000-0000000000f7',
                         '00000000-0000-4000-a000-000000000001')), 2::bigint,
  'a franchise admin deletes no outlet — not a bare one, and not their own');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f7';

reset role;
select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f7'), 1::bigint,
  'nor does a biller on the counter tablet');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f7';

reset role;
select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f7'), 1::bigint,
  'nor an employee');

-- The account_active half of the policy, proved rather than assumed.

update public.profiles set is_active = false
 where id = '10000000-0000-4000-a000-000000000001';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f7';

reset role;
select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-0000000000f7'), 1::bigint,
  'a deactivated super admin deletes nothing, claim in hand or not');

update public.profiles set is_active = true
 where id = '10000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------------
-- What is still attached, in words the surface can render.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

select is(
  (select string_agg(table_name || '=' || row_count, ', ' order by table_name)
     from public.outlet_reference_counts('00000000-0000-4000-a000-0000000000f2')),
  'profiles=1',
  'a populated outlet reports what is attached and how much of it');

select is(
  (select count(*) from public.outlet_reference_counts('00000000-0000-4000-a000-0000000000f7')),
  0::bigint,
  'and a bare outlet reports nothing at all, rather than a row of zeroes');

-- The seeded outlet, where several things are attached at once: what matters
-- is that the tables named are exactly the ones actually carrying rows.
select is(
  (select bool_and(row_count > 0)
     from public.outlet_reference_counts('00000000-0000-4000-a000-000000000001')),
  true,
  'nothing is reported with a count of zero');

select ok(
  (select count(*) from public.outlet_reference_counts('00000000-0000-4000-a000-000000000001')) > 1,
  'a traded outlet names more than one thing');

-- The whole point of reading the catalog: a table nobody edited this function
-- for is still counted.
--
-- A real table in public rather than a temporary one, because Postgres refuses
-- a foreign key from a temp table to a permanent table ("constraints on
-- temporary tables may reference only temporary tables") — so a temp table
-- could never reference outlets and would have proved nothing. This whole file
-- runs inside a transaction that rolls back, which is what keeps it temporary
-- in the sense that matters.

reset role;
create table public.outlet_widgets (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id)
);
insert into public.outlet_widgets (outlet_id)
values ('00000000-0000-4000-a000-0000000000f7');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin', null);

select is(
  (select string_agg(table_name, ', ' order by table_name)
     from public.outlet_reference_counts('00000000-0000-4000-a000-0000000000f7')),
  'outlet_widgets',
  'a table added after this function was written is counted without editing it');

select throws_ok($q$
  delete from public.outlets where id = '00000000-0000-4000-a000-0000000000f7'
$q$, '23503', null, 'and it blocks the delete, exactly as the schema''s own tables do');

reset role;
drop table public.outlet_widgets;

-- Nobody but the owner may ask. The function refuses on role rather than on
-- grant, so a widened grant cannot quietly turn it into a census of the
-- business for whoever holds a token.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  select * from public.outlet_reference_counts('00000000-0000-4000-a000-000000000001')
$q$, '42501', null, 'a franchise admin cannot ask what is attached to an outlet');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  select * from public.outlet_reference_counts('00000000-0000-4000-a000-000000000001')
$q$, '42501', null, 'nor can a biller');

reset role;

select * from finish();
rollback;
