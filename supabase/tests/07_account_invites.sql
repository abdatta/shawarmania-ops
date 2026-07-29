-- Issuing a one-time code, and everything that quietly kills one: re-issue,
-- reassignment, deactivation, expiry, the one-live-invite invariant, and the
-- grants that keep both functions out of every client's hands.
--
-- Redemption itself moved to 10_activation.sql when the code became the lookup
-- key. What stays here is the invite's own lifecycle, which did not change —
-- the calls below simply name a code instead of an address.
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

create function pg_temp.redeem(p_code text)
returns text language sql as $$
  select status from public.redeem_account_invite(pg_temp.h(p_code))
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

select is(pg_temp.redeem('ABCDEFGHJK'), 'ok',
  'a live code redeems');

select is(
  (select user_id from public.redeem_account_invite(pg_temp.h('KMNPQRSTVW'))),
  :KPA::uuid,
  'and the code alone determines whose password is about to be set');

select ok(
  (select consumed_at is not null from public.account_invites where profile_id = :KAL),
  'the redeemed invite is stamped consumed');

rollback to happy;

-- ---------------------------------------------------------------------------
-- The ways an invite dies. Each returns the same 'invalid' as an unknown code;
-- these are separate cases only so a regression names which one broke.

savepoint expired;
update public.account_invites set expires_at = now() - interval '1 second'
 where profile_id = :KAL;
select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid',
  'an expired code is refused');
select ok(
  (select consumed_at is null from public.account_invites where profile_id = :KAL),
  'a refused redemption consumes nothing');
rollback to expired;

savepoint superseded;
update public.account_invites set superseded_at = now() where profile_id = :KAL;
select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid',
  'a superseded code is refused');
rollback to superseded;

savepoint deactivated;
update public.profiles set is_active = false where id = :KAL;
select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid',
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

select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid',
  'the superseded code stops working the moment a new one is issued');

select is(pg_temp.redeem('NEWCODE111'), 'ok',
  'the newly issued code works');
rollback to reissue;

savepoint two_live;
select throws_ok($q$
  insert into public.account_invites (profile_id, code_hash, issued_by, expires_at)
  values ('10000000-0000-4000-a000-00000000000c',
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

-- An invite carries no outlet since multi-outlet-people: it is about a person,
-- and a person may be at several outlets. Who may read it is answered by
-- `app_may_manage_person` instead, which 03_status_and_scope.sql proves.
savepoint invite_no_outlet;
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'account_invites'
      and column_name = 'outlet_id'),
  0::bigint,
  'an invite carries no outlet of its own');
rollback to invite_no_outlet;

-- ---------------------------------------------------------------------------
-- Reassignment kills outstanding codes, whoever performs the move — and
-- reassignment is now an assignment write, in both directions.

savepoint reassign_outlet;
insert into public.assignments (person_id, role, outlet_id)
values (:KAL, 'employee', '00000000-0000-4000-a000-000000000002');
select is(pg_temp.live_invite(:KAL::uuid), 0::bigint,
  'placing someone at another outlet supersedes their outstanding code');
select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid',
  'a code issued before the move no longer redeems');
rollback to reassign_outlet;

savepoint reassign_end;
update public.assignments set ended_on = current_date
 where person_id = :KAL and ended_on is null;
select is(pg_temp.live_invite(:KAL::uuid), 0::bigint,
  'ending someone''s assignment supersedes their outstanding code');
rollback to reassign_end;

savepoint touch_profile;
update public.profiles set full_name = full_name || ' (edited)' where id = :KAL;
select is(pg_temp.live_invite(:KAL::uuid), 1::bigint,
  'editing an unrelated column leaves the outstanding code alone');
rollback to touch_profile;

-- ---------------------------------------------------------------------------
-- Both functions are service-role-only. Redemption and preview would be
-- enumeration oracles in any other hands, and PostgREST exposes public
-- functions as RPCs to whoever holds execute.

select ok(
  not has_function_privilege('authenticated', 'public.redeem_account_invite(text, text)', 'execute'),
  'authenticated cannot execute redeem_account_invite');
select ok(
  not has_function_privilege('anon', 'public.redeem_account_invite(text, text)', 'execute'),
  'anon cannot execute redeem_account_invite');
select ok(
  not has_function_privilege('anon', 'public.preview_account_invite(text, text)', 'execute'),
  'anon cannot execute preview_account_invite');
select ok(
  not has_function_privilege('authenticated', 'public.issue_account_invite(uuid, uuid, text, interval)', 'execute'),
  'authenticated cannot execute issue_account_invite');
select ok(
  has_function_privilege('service_role', 'public.redeem_account_invite(text, text)', 'execute'),
  'service_role can execute redeem_account_invite');
select ok(
  has_function_privilege('service_role', 'public.issue_account_invite(uuid, uuid, text, interval)', 'execute'),
  'service_role can execute issue_account_invite');

select * from finish();
rollback;
