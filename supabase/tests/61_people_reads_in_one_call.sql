-- people-shows-names-first, design D3.
--
-- account_identifier_facts() must answer, in one call, exactly what the
-- admin-accounts function used to assemble from the Auth user list, three table
-- reads and a fingerprint per account — and must be unreachable by any client.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

\set OWNER '10000000-0000-4000-a000-000000000001'
\set MANAGER_KAL '10000000-0000-4000-a000-000000000002'
\set TWO_OUTLETS '10000000-0000-4000-a000-00000000000e'

-- One row per profile that has an Auth user, and no other.
select is(
  (select count(*) from public.account_identifier_facts()),
  (select count(*) from public.profiles p join auth.users u on u.id = p.id),
  'one row per profile with an auth user'
);

-- The fingerprint is the one definition, for every account.
select is(
  (select count(*) from public.account_identifier_facts() f
    where f.state_fingerprint is distinct from public.account_state_fingerprint(f.profile_id)),
  0::bigint,
  'every fingerprint equals account_state_fingerprint'
);

-- The sign-in alias and the last sign-in come from auth.users.
select is(
  (select auth_email from public.account_identifier_facts() where profile_id = :'OWNER'),
  (select email::text from auth.users where id = :'OWNER'),
  'the auth alias is the auth user''s email'
);

-- Live assignments only, as role and outlet.
update public.assignments set ended_on = current_date
 where person_id = :'TWO_OUTLETS' and outlet_id = '00000000-0000-4000-a000-000000000002';
select is(
  (select jsonb_array_length(live_assignments) from public.account_identifier_facts()
    where profile_id = :'TWO_OUTLETS'),
  1,
  'an ended assignment is not live'
);
select is(
  (select live_assignments -> 0 ->> 'outlet_id' from public.account_identifier_facts()
    where profile_id = :'TWO_OUTLETS'),
  '00000000-0000-4000-a000-000000000001',
  'the remaining live assignment is named by outlet'
);

-- The live invite, and only a live one.
update public.account_invites set superseded_at = now()
 where profile_id = :'TWO_OUTLETS' and consumed_at is null and superseded_at is null;
insert into public.account_invites (profile_id, code_hash, issued_by, expires_at, purpose)
values (:'TWO_OUTLETS', 'test-hash-live', :'OWNER', now() + interval '1 day', 'password_reset');
select is(
  (select invite_purpose from public.account_identifier_facts() where profile_id = :'TWO_OUTLETS'),
  'password_reset',
  'a live invite is reported with its purpose'
);
update public.account_invites set expires_at = now() - interval '1 minute'
 where profile_id = :'TWO_OUTLETS' and code_hash = 'test-hash-live';
select ok(
  (select invite_purpose is null and invite_expires_at is null
     from public.account_identifier_facts() where profile_id = :'TWO_OUTLETS'),
  'an expired invite is not reported'
);

-- Service-only.
select ok(
  not has_function_privilege('anon', 'public.account_identifier_facts()', 'execute'),
  'anon cannot execute it'
);
select ok(
  not has_function_privilege('authenticated', 'public.account_identifier_facts()', 'execute'),
  'authenticated cannot execute it'
);
select ok(
  has_function_privilege('service_role', 'public.account_identifier_facts()', 'execute'),
  'service_role can'
);

select * from finish();
rollback;
