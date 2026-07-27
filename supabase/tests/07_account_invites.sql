-- The one-time code contract, proved where it is enforced. Every clause of
-- design D4 gets a case here: single use, expiry, attempt ceiling,
-- supersession by re-issue and by reassignment, deactivation, and the uniform
-- 'invalid' that makes the redemption path useless as an enumeration oracle.
--
-- Scenarios that mutate an invite are wrapped in savepoints, so each starts
-- from the seeded state rather than from whatever the previous one left.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.h(code text) returns text
language sql immutable as $$
  select encode(extensions.digest(code, 'sha256'), 'hex')
$$;

create function pg_temp.redeem(p_email text, p_code text)
returns text language sql as $$
  select status from public.redeem_account_invite(p_email, pg_temp.h(p_code))
$$;

create function pg_temp.live_invite(p_profile uuid) returns bigint
language sql as $$
  select count(*) from public.account_invites
   where profile_id = p_profile and consumed_at is null and superseded_at is null
$$;

-- Seeded: pending.kalyani@example.com holds ABCDEFGHJK (Kalyani),
-- pending.kanchrapara@example.com holds KMNPQRSTVW (Kanchrapara).
\set KAL '''10000000-0000-4000-a000-00000000000c'''
\set KPA '''10000000-0000-4000-a000-00000000000d'''

-- ---------------------------------------------------------------------------
-- The happy path, and that it happens exactly once.

savepoint happy;

select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'ok',
  'the right code for the right account redeems');

select is(
  (select user_id from public.redeem_account_invite(
     'pending.kanchrapara@example.com', pg_temp.h('KMNPQRSTVW'))),
  :KPA::uuid,
  'redemption returns the auth user whose password is to be set');

select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'a redeemed code cannot be redeemed a second time');

select ok(
  (select consumed_at is not null from public.account_invites where profile_id = :KAL),
  'the redeemed invite is stamped consumed');

rollback to happy;

-- Address matching tolerates case and stray whitespace: people retype what an
-- admin sent them on WhatsApp.
savepoint sloppy_email;
select is(pg_temp.redeem('  PENDING.Kalyani@Example.COM  ', 'ABCDEFGHJK'), 'ok',
  'the address is matched case-insensitively and trimmed');
rollback to sloppy_email;

-- ---------------------------------------------------------------------------
-- Every failure mode returns the same value. These are separate cases only so
-- a regression names which one broke.

select is(pg_temp.redeem('nobody@example.com', 'ABCDEFGHJK'), 'invalid',
  'an unknown address is invalid');

select is(pg_temp.redeem('owner@example.com', 'ABCDEFGHJK'), 'invalid',
  'a known address with no outstanding invite is invalid');

savepoint wrong_code;
select is(pg_temp.redeem('pending.kalyani@example.com', 'ZZZZZZZZZZ'), 'invalid',
  'a wrong code is invalid');
select is((select attempts from public.account_invites where profile_id = :KAL), 1,
  'a wrong code costs an attempt');
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'ok',
  'a wrong attempt does not burn a still-valid invite');
rollback to wrong_code;

-- The other account's code is just a wrong code — invites are not fungible.
savepoint cross_code;
select is(pg_temp.redeem('pending.kalyani@example.com', 'KMNPQRSTVW'), 'invalid',
  'another account''s code does not redeem this one');
rollback to cross_code;

savepoint exhausted;
update public.account_invites set attempts = 5 where profile_id = :KAL;
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'the correct code is refused once the attempt ceiling is reached');
rollback to exhausted;

savepoint expired;
update public.account_invites set expires_at = now() - interval '1 second'
 where profile_id = :KAL;
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'an expired code is refused');
select ok(
  (select consumed_at is null from public.account_invites where profile_id = :KAL),
  'a refused redemption consumes nothing');
rollback to expired;

savepoint superseded;
update public.account_invites set superseded_at = now() where profile_id = :KAL;
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'a superseded code is refused');
rollback to superseded;

savepoint deactivated;
update public.profiles set is_active = false where id = :KAL;
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'a deactivated account cannot activate itself with a valid code');
rollback to deactivated;

-- ---------------------------------------------------------------------------
-- Issuing: supersession is atomic and the one-live-invite invariant holds.

savepoint reissue;
select ok(
  public.issue_account_invite(:KAL::uuid, '10000000-0000-4000-a000-000000000002'::uuid,
    pg_temp.h('NEWCODE111'), interval '7 days') is not null,
  're-issuing returns the new invite id');

select is(pg_temp.live_invite(:KAL::uuid), 1::bigint,
  're-issuing leaves exactly one live invite');

select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'the superseded code stops working the moment a new one is issued');

select is(pg_temp.redeem('pending.kalyani@example.com', 'NEWCODE111'), 'ok',
  'the newly issued code works');
rollback to reissue;

savepoint two_live;
select throws_ok($q$
  insert into public.account_invites (profile_id, outlet_id, code_hash, issued_by, expires_at)
  values ('10000000-0000-4000-a000-00000000000c', '00000000-0000-4000-a000-000000000001',
          'second', '10000000-0000-4000-a000-000000000002', now() + interval '7 days')
$q$, '23505', null, 'a second live invite for the same profile is rejected by the index');
rollback to two_live;

savepoint no_profile;
select throws_ok($q$
  select public.issue_account_invite(
    '99999999-9999-4999-a999-999999999999', '10000000-0000-4000-a000-000000000002',
    'x', interval '7 days')
$q$, 'P0002', null, 'issuing against a profile that does not exist fails loudly');
rollback to no_profile;

savepoint invite_outlet;
select is(
  (select outlet_id from public.account_invites where profile_id = :KAL),
  '00000000-0000-4000-a000-000000000001'::uuid,
  'the invite carries the invited profile''s outlet, for the isolation policy');
rollback to invite_outlet;

-- ---------------------------------------------------------------------------
-- Reassignment kills outstanding codes, whoever performs the move.

savepoint reassign_outlet;
update public.profiles set outlet_id = '00000000-0000-4000-a000-000000000002'
 where id = :KAL;
select is(pg_temp.live_invite(:KAL::uuid), 0::bigint,
  'moving someone to another outlet supersedes their outstanding code');
select is(pg_temp.redeem('pending.kalyani@example.com', 'ABCDEFGHJK'), 'invalid',
  'a code issued before the move no longer redeems');
rollback to reassign_outlet;

savepoint reassign_role;
update public.profiles set role = 'biller' where id = :KAL;
select is(pg_temp.live_invite(:KAL::uuid), 0::bigint,
  'changing someone''s role supersedes their outstanding code');
rollback to reassign_role;

savepoint touch_profile;
update public.profiles set full_name = full_name || ' (edited)' where id = :KAL;
select is(pg_temp.live_invite(:KAL::uuid), 1::bigint,
  'editing an unrelated column leaves the outstanding code alone');
rollback to touch_profile;

-- ---------------------------------------------------------------------------
-- Both functions are service-role-only. `redeem_account_invite` would be an
-- address-enumeration oracle in any other hands, and PostgREST exposes public
-- functions as RPCs to whoever holds execute.

select ok(
  not has_function_privilege('authenticated', 'public.redeem_account_invite(text, text, integer)', 'execute'),
  'authenticated cannot execute redeem_account_invite');
select ok(
  not has_function_privilege('anon', 'public.redeem_account_invite(text, text, integer)', 'execute'),
  'anon cannot execute redeem_account_invite');
select ok(
  not has_function_privilege('authenticated', 'public.issue_account_invite(uuid, uuid, text, interval)', 'execute'),
  'authenticated cannot execute issue_account_invite');
select ok(
  has_function_privilege('service_role', 'public.redeem_account_invite(text, text, integer)', 'execute'),
  'service_role can execute redeem_account_invite');
select ok(
  has_function_privilege('service_role', 'public.issue_account_invite(uuid, uuid, text, interval)', 'execute'),
  'service_role can execute issue_account_invite');

select * from finish();
rollback;
