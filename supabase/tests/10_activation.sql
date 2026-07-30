-- Activation by code alone: the code is the key, the address is derived, and
-- the guessing bound lives on the endpoint instead of the invite row.
--
-- What is asserted here is the half that has to hold when the screens are
-- bypassed entirely — which is the half that matters, because the endpoint
-- these functions sit behind takes no session at all.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- Claims carry `sub` and nothing about authority (multi-outlet-people): scope
-- is resolved from the seeded `assignments` rows, exactly as a real session's
-- is.
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

create function pg_temp.hash(p_code text)
returns text language sql immutable as $$
  select encode(extensions.digest(p_code, 'sha256'), 'hex')
$$;

-- Independence from whatever ran before: supabase/tests/rest/ writes real
-- failure rows to this same local database, and the counting assertions below
-- are absolute. The table is service-role-only and holds nothing but hashes
-- and timestamps, so clearing it costs nothing and the file rolls back anyway.
delete from public.invite_redemption_attempts;

-- ---------------------------------------------------------------------------
-- The address-keyed redemption path is gone, not merely unused.

select is((select count(*) from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname = 'redeem_account_invite'
             and pg_catalog.pg_get_function_identity_arguments(p.oid)
                 = 'p_email text, p_code_hash text, p_max_attempts integer'), 0::bigint,
  'the address-keyed redemption function no longer exists');

-- ---------------------------------------------------------------------------
-- A live code identifies exactly one invite.

select throws_ok($q$
  insert into public.account_invites
    (profile_id, code_hash, issued_by, expires_at)
  values ('10000000-0000-4000-a000-000000000006',
          encode(extensions.digest('ABCDEFGHJK', 'sha256'), 'hex'),
          '10000000-0000-4000-a000-000000000002', now() + interval '7 days')
$q$, '23505', null,
  'two live invites cannot share a code hash, so lookup by code is unambiguous');

-- ---------------------------------------------------------------------------
-- Preview: a live code resolves to its username, and consumes nothing.

select is((select status from public.preview_account_invite(pg_temp.hash('ABCDEFGHJK'), 'ip-a')),
  'ok', 'a live code previews');

select is((select username from public.preview_account_invite(pg_temp.hash('ABCDEFGHJK'), 'ip-a')),
  'pending.kalyani',
  'and resolves to the current canonical username');

select is((select consumed_at from public.account_invites
            where id = '80000000-0000-4000-a000-000000000001'), null,
  'previewing twice consumed nothing — somebody may look and walk away');

select is((select count(*) from public.invite_redemption_attempts), 0::bigint,
  'and a successful preview costs the caller nothing');

select is((select status from public.preview_account_invite(pg_temp.hash('NOTACODE00'), 'ip-a')),
  'invalid', 'an unknown code previews as invalid');

select is((select username from public.preview_account_invite(pg_temp.hash('NOTACODE00'), 'ip-a')),
  null, 'and discloses no username');

select is((select count(*) from public.invite_redemption_attempts), 2::bigint,
  'each failed preview is recorded, because that is what bounds guessing now');

-- An expired code is refused exactly like an unknown one. The uniformity is
-- the whole reason this endpoint is not an account-enumeration oracle.
update public.account_invites set expires_at = now() - interval '1 minute'
 where id = '80000000-0000-4000-a000-000000000002';

select is((select status from public.preview_account_invite(pg_temp.hash('KMNPQRSTVW'), 'ip-a')),
  'invalid', 'an expired code is refused');

select is((select username from public.preview_account_invite(pg_temp.hash('KMNPQRSTVW'), 'ip-a')),
  null, 'and is indistinguishable from a code that never existed');

update public.account_invites set expires_at = now() + interval '7 days'
 where id = '80000000-0000-4000-a000-000000000002';

-- A deactivated account's code stops working without saying that is why.
update public.profiles set is_active = false
 where id = '10000000-0000-4000-a000-00000000000d';

select is((select status from public.preview_account_invite(pg_temp.hash('KMNPQRSTVW'), 'ip-a')),
  'invalid', 'a deactivated account''s code is refused');

update public.profiles set is_active = true
 where id = '10000000-0000-4000-a000-00000000000d';

-- ---------------------------------------------------------------------------
-- Redemption verifies the shown username before consuming the code.

delete from public.invite_redemption_attempts;

select is((
    select status
      from public.redeem_account_invite(
        pg_temp.hash('ABCDEFGHJK'),
        'different.person',
        'ip-b'
      )
  ),
  'username_mismatch',
  'a different valid username is refused specifically');

select is((select consumed_at from public.account_invites
            where id = '80000000-0000-4000-a000-000000000001'), null,
  'a username mismatch does not consume the invite');

select is((
    select status
      from public.redeem_account_invite(
        pg_temp.hash('ABCDEFGHJK'),
        'PENDING.KALYANI',
        'ip-b'
      )
  ),
  'ok',
  'the canonical username match redeems case-insensitively');

select is((
    select user_id
      from public.redeem_account_invite(
        pg_temp.hash('KMNPQRSTVW'),
        'pending.kanchrapara',
        'ip-b'
      )
  ),
  '10000000-0000-4000-a000-00000000000d'::uuid,
  'and returns the account the code identifies, derived rather than claimed');

select isnt((select consumed_at from public.account_invites
              where id = '80000000-0000-4000-a000-000000000001'), null,
  'redemption consumes the invite');

select is((
    select status
      from public.redeem_account_invite(
        pg_temp.hash('ABCDEFGHJK'),
        'pending.kalyani',
        'ip-b'
      )
  ),
  'invalid', 'a spent code cannot be redeemed twice');

select is((select status from public.preview_account_invite(pg_temp.hash('ABCDEFGHJK'), 'ip-b')),
  'invalid', 'nor previewed afterwards, so a spent link discloses nothing either');

-- ---------------------------------------------------------------------------
-- The endpoint's bound. Only failures count, which is why a real onboarding
-- never spends any of it.

delete from public.invite_redemption_attempts;

select ok(not public.invite_attempts_exceeded('ip-c'),
  'a caller that has failed nothing is not limited');

-- Nineteen failures from one address: under the bound of twenty.
insert into public.invite_redemption_attempts (ip_hash)
select 'ip-c' from generate_series(1, 19);

select ok(not public.invite_attempts_exceeded('ip-c'),
  'nineteen failures from one address is still allowed');

insert into public.invite_redemption_attempts (ip_hash) values ('ip-c');

select ok(public.invite_attempts_exceeded('ip-c'),
  'the twentieth refuses that address');

select ok(not public.invite_attempts_exceeded('ip-d'),
  'and refuses only that address — a different caller is unaffected');

select is((select status from public.preview_account_invite(pg_temp.hash('KMNPQRSTVW'), 'ip-c')),
  'rate_limited',
  'a limited caller is told so, distinctly from a bad code — it says nothing about any account');

-- Enough from other addresses to reach the endpoint's global five hundred.
insert into public.invite_redemption_attempts (ip_hash)
select 'ip-' || i from generate_series(1, 480) i;

select ok(public.invite_attempts_exceeded('ip-d'),
  'past the global bound, a caller who has failed nothing is refused too');

select ok(public.invite_attempts_exceeded(null),
  'including a caller whose address could not be determined');

-- Old failures fall out of the window rather than accumulating forever.
update public.invite_redemption_attempts set attempted_at = now() - interval '20 minutes';

select ok(not public.invite_attempts_exceeded('ip-c'),
  'failures older than the window stop counting');

-- ---------------------------------------------------------------------------
-- What an admin may see of it. The pressure function refuses on role rather
-- than on grant, so even the owner of the table has to hold a token to ask.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select is(public.invite_failure_pressure(), 0,
  'the pressure an admin sees is the window, not all history');

reset role;
delete from public.invite_redemption_attempts;
insert into public.invite_redemption_attempts (ip_hash)
select 'ip-e' from generate_series(1, 7);

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select is(public.invite_failure_pressure(), 7,
  'the super admin is told how many failures the window holds');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select throws_ok($q$ select public.invite_failure_pressure() $q$,
  '42501', null, 'a franchise admin is refused the count');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select throws_ok($q$ select public.invite_failure_pressure() $q$,
  '42501', null, 'and so is a biller on the shared counter tablet');

-- The rows themselves are nobody's to read. RLS with no policy is deny-all,
-- and the revoked grants say the same thing again.
select throws_ok($q$ select * from public.invite_redemption_attempts $q$,
  '42501', null, 'the attempts table is unreadable even by a signed-in caller');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$ select * from public.invite_redemption_attempts $q$,
  '42501', null, 'including by the super admin, who gets the count and nothing else');

-- Redemption itself stays out of every client's hands: PostgREST would expose
-- any of these as an RPC to whoever held execute.
select throws_ok($q$
  select public.redeem_account_invite('whatever', 'some.username', 'ip-x')
$q$, '42501', null, 'redemption is not callable by a signed-in client');

select throws_ok($q$
  select public.preview_account_invite('whatever', 'ip-x')
$q$, '42501', null, 'nor is preview, which would otherwise be an address oracle');

reset role;

select * from finish();
rollback;
