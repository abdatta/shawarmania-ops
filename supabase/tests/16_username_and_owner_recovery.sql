-- Username identity and owner recovery are privileged plumbing. This suite
-- proves the canonical namespace, required Super Admin account email,
-- enumeration-safe sign-in/recovery resolvers, and the independent privilege
-- boundary.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

\set OWNER '''10000000-0000-4000-a000-000000000001'''
\set ADMIN '''10000000-0000-4000-a000-000000000002'''
\set BILLER '''10000000-0000-4000-a000-000000000004'''
\set EMPLOYEE '''10000000-0000-4000-a000-000000000006'''

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- The browser and database share exactly one username grammar.

select is(
  public.app_normalize_username('  Rahul.K_2  '),
  'rahul.k_2',
  'username normalization trims and lowercases ASCII'
);

select is(
  public.app_username_valid(input),
  expected,
  description
)
from (
  values
    ('abc', true, 'the three-character boundary is accepted'),
    (repeat('a', 30), true, 'the thirty-character boundary is accepted'),
    ('rahul.k_2', true, 'periods and underscores are accepted'),
    ('ab', false, 'two characters are refused'),
    (repeat('a', 31), false, 'thirty-one characters are refused'),
    ('@rahul', false, 'an at sign is refused'),
    ('rahul k', false, 'spaces are refused'),
    ('rahul-k', false, 'hyphens are refused'),
    ('rāhul', false, 'Unicode lookalikes are refused'),
    ('.rahul', false, 'a leading period is refused'),
    ('rahul.', false, 'a trailing period is refused'),
    ('rahul..k', false, 'consecutive periods are refused')
) cases(input, expected, description);

select is(
  public.app_username_from_auth_alias('Rahul.K@LOGIN.SHAWARMANIA.INVALID'),
  'rahul.k',
  'the reserved alias parser returns only the canonical username'
);
select is(
  public.app_username_from_auth_alias('rahul.k@example.com'),
  null,
  'a legacy or deliverable address never parses as a product username'
);

-- ---------------------------------------------------------------------------
-- Account email is optional generally and required for every live owner.

select is(
  (select count(*) from public.account_emails),
  1::bigint,
  'the seed contains exactly one private account email'
);
select is(
  (
    select count(*)
      from public.account_emails c
      join public.assignments a
        on a.person_id = c.profile_id
       and a.role = 'super_admin'
       and a.ended_on is null
  ),
  1::bigint,
  'that account email belongs to a live Super Admin'
);
select is(
  (
    select count(*)
      from public.assignments a
     where a.role = 'super_admin'
       and a.ended_on is null
       and not exists (
         select 1
           from public.account_emails c
          where c.profile_id = a.person_id
       )
  ),
  0::bigint,
  'no live Super Admin is missing an account email'
);

savepoint ordinary_account_email;
insert into public.account_emails (profile_id, email)
values (:EMPLOYEE, 'staff.account@example.com');
select lives_ok(
  'set constraints all immediate',
  'a non-owner may carry one private account email'
);
rollback to ordinary_account_email;
set constraints all deferred;

savepoint owner_without_account_email;
delete from public.account_emails where profile_id = :OWNER;
select throws_ok(
  'set constraints all immediate',
  '23514',
  null,
  'a live owner cannot lose the required account email'
);
rollback to owner_without_account_email;
set constraints all deferred;

select throws_ok(
  format(
    'insert into public.account_emails (profile_id, email) '
    'values (%L, %L)',
    :EMPLOYEE,
    'owner.account@example.com'
  ),
  '23505',
  null,
  'account emails are unique after normalization'
);

select throws_ok(
  format(
    'update public.assignments set ended_on = current_date '
    'where person_id = %L and role = ''super_admin'' and ended_on is null',
    :OWNER
  ),
  'P0001',
  null,
  'the existing last-owner guard still refuses ending the final owner'
);
select is(
  (
    select count(*)
      from public.account_emails
     where profile_id = :OWNER
  ),
  1::bigint,
  'a refused last-owner write leaves the account email intact'
);

-- ---------------------------------------------------------------------------
-- No client role can inspect the private tables, including the owner.

select pg_temp.impersonate(:OWNER);
select throws_ok(
  'select * from public.account_emails',
  '42501',
  null,
  'a Super Admin cannot read account emails through the client role'
);
select throws_ok(
  'select * from public.email_sign_in_attempts',
  '42501',
  null,
  'a Super Admin cannot read email sign-in attempt hashes'
);
select throws_ok(
  'select * from public.owner_recovery_attempts',
  '42501',
  null,
  'a Super Admin cannot read recovery attempt hashes'
);

select pg_temp.impersonate(:ADMIN);
select throws_ok(
  'select * from public.account_emails',
  '42501',
  null,
  'a Franchise Admin cannot read account emails'
);

select pg_temp.impersonate(:BILLER);
select throws_ok(
  'select * from public.account_emails',
  '42501',
  null,
  'a Biller cannot read account emails'
);

select pg_temp.impersonate(:EMPLOYEE);
select throws_ok(
  'select * from public.account_emails',
  '42501',
  null,
  'an Employee cannot read account emails'
);

reset role;

select ok(
  not has_table_privilege('anon', 'public.account_emails', 'select'),
  'anon has no account-email table privilege'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.account_emails',
    'select'
  ),
  'authenticated has no account-email table privilege'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_email_sign_in(text,text,interval,integer,integer,integer)',
    'execute'
  ),
  'a browser cannot invoke the private email sign-in resolver'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_owner_recovery(text,text,interval,integer,integer,integer)',
    'execute'
  ),
  'a browser cannot invoke the private owner resolver'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.username_rollout_ready()',
    'execute'
  ),
  'an anonymous browser cannot invoke the rollout invariant directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.username_rollout_ready()',
    'execute'
  ),
  'an authenticated browser cannot invoke the rollout invariant directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.username_rollout_ready()',
    'execute'
  ),
  'the service role can run the rollout invariant for the Edge Function'
);

-- ---------------------------------------------------------------------------
-- Resolution is private, rate-limited, and stores no raw email or IP.

delete from public.email_sign_in_attempts;

select is(
  public.resolve_email_sign_in(
    '  OWNER.ACCOUNT@EXAMPLE.COM ',
    encode(extensions.digest('203.0.113.9', 'sha256'), 'hex')
  ),
  'owner@login.shawarmania.invalid',
  'an associated email resolves privately to the active account Auth alias'
);
select is(
  public.resolve_email_sign_in(
    'nobody@example.com',
    encode(extensions.digest('203.0.113.8', 'sha256'), 'hex')
  ),
  null,
  'an unknown sign-in email resolves to no alias'
);
select is(
  (
    select count(*)
      from public.email_sign_in_attempts
     where email_hash like '%@%'
        or ip_hash like '%.%'
  ),
  0::bigint,
  'the email sign-in ledger contains hashes rather than raw identifiers'
);

delete from public.owner_recovery_attempts;

select is(
  public.resolve_owner_recovery(
    '  OWNER.ACCOUNT@EXAMPLE.COM ',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex')
  ),
  :OWNER::uuid,
  'the normalized active-owner recovery address resolves privately'
);
select is(
  public.resolve_owner_recovery(
    'nobody@example.com',
    encode(extensions.digest('203.0.113.11', 'sha256'), 'hex')
  ),
  null,
  'an unknown recovery address resolves to no target'
);
select is(
  (
    select count(*)
      from public.owner_recovery_attempts
     where email_hash like '%@%'
        or ip_hash like '%.%'
  ),
  0::bigint,
  'the recovery ledger contains hashes rather than raw addresses'
);

select public.resolve_owner_recovery('owner.account@example.com', 'ip-2');
select public.resolve_owner_recovery('owner.account@example.com', 'ip-3');
select is(
  public.resolve_owner_recovery('owner.account@example.com', 'ip-4'),
  null,
  'the per-address recovery limit refuses the fourth request in the window'
);

-- ---------------------------------------------------------------------------
-- Static frontend publication fails closed until live identity is coherent.

select is(
  public.username_rollout_ready(),
  true,
  'the canonical seeded identity state is ready for username deployment'
);

create function pg_temp.readiness_with_legacy_alias(p_profile_id uuid)
returns boolean language plpgsql as $$
declare
  v_original text;
  v_ready boolean;
begin
  select email into v_original from auth.users where id = p_profile_id;
  update auth.users set email = 'legacy.owner@example.com' where id = p_profile_id;
  v_ready := public.username_rollout_ready();
  update auth.users set email = v_original where id = p_profile_id;
  return v_ready;
end;
$$;

select is(
  pg_temp.readiness_with_legacy_alias(:OWNER),
  false,
  'one legacy Auth identifier makes the rollout unready'
);

create function pg_temp.readiness_with_identity_mismatch(p_profile_id uuid)
returns boolean language plpgsql as $$
declare
  v_original jsonb;
  v_ready boolean;
begin
  select identity_data
    into v_original
    from auth.identities
   where user_id = p_profile_id
     and provider = 'email';
  update auth.identities
     set identity_data = jsonb_set(
       identity_data,
       '{email}',
       to_jsonb('different@login.shawarmania.invalid'::text)
     )
   where user_id = p_profile_id
     and provider = 'email';
  v_ready := public.username_rollout_ready();
  update auth.identities
     set identity_data = v_original
   where user_id = p_profile_id
     and provider = 'email';
  return v_ready;
end;
$$;

select is(
  pg_temp.readiness_with_identity_mismatch(:OWNER),
  false,
  'a mismatched email-provider identity makes the rollout unready'
);

create function pg_temp.readiness_without_owner_email(p_profile_id uuid)
returns boolean language plpgsql as $$
declare
  v_email text;
  v_ready boolean;
begin
  delete from public.account_emails
   where profile_id = p_profile_id
   returning email into v_email;
  v_ready := public.username_rollout_ready();
  insert into public.account_emails (profile_id, email)
  values (p_profile_id, v_email);
  return v_ready;
end;
$$;

select is(
  pg_temp.readiness_without_owner_email(:OWNER),
  false,
  'a live Super Admin without private account email makes rollout unready'
);

select * from finish();
rollback;
