-- Multi-outlet hiring: assignment changes replace a pending invite visibly,
-- atomically, and only through the service-role account-admin path.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.h(code text) returns text
language sql immutable as $$
  select encode(extensions.digest(code, 'sha256'), 'hex')
$$;

create function pg_temp.live_invite(p_profile uuid) returns bigint
language sql as $$
  select count(*) from public.account_invites
   where profile_id = p_profile
     and consumed_at is null
     and superseded_at is null
$$;

create function pg_temp.redeem(
  p_code text,
  p_username text default 'pending.kalyani'
) returns text
language sql as $$
  select status
    from public.redeem_account_invite(pg_temp.h(p_code), p_username, null)
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set STAFF_KAL '10000000-0000-4000-a000-000000000006'
\set PENDING_KAL '10000000-0000-4000-a000-00000000000c'
\set PENDING_KPA '10000000-0000-4000-a000-00000000000d'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- ---------------------------------------------------------------------------
-- 1. A grant leaves the changed authority in place and exactly one new code.

savepoint grant_reissues;

select ok(
  (
    select invite_id is not null and invite_expires_at > now()
      from public.grant_assignment_with_invite(
        :'PENDING_KAL'::uuid,
        'employee',
        :'KPA'::uuid,
        null,
        :'OWNER'::uuid,
        pg_temp.h('GRANTCODE1'),
        interval '7 days'
      )
  ),
  'granting to a person with a pending invite returns its replacement'
);
select is(
  (
    select count(*)
      from public.assignments
     where person_id = :'PENDING_KAL'
       and outlet_id in (:'KAL'::uuid, :'KPA'::uuid)
       and ended_on is null
  ),
  2::bigint,
  'both assignments exist before the replacement is handed back'
);
select is(
  pg_temp.live_invite(:'PENDING_KAL'::uuid),
  1::bigint,
  'the grant leaves exactly one live invite'
);
select is(pg_temp.redeem('ABCDEFGHJK'), 'invalid', 'the pre-grant code is dead');
select is(
  pg_temp.redeem('GRANTCODE1', 'pending.kalyani'),
  'ok',
  'the replacement grant code works'
);

rollback to grant_reissues;

-- ---------------------------------------------------------------------------
-- 2. Ending also replaces, and an activated person gets no unsolicited code.

savepoint end_reissues;

select ok(
  (
    select invite_id is not null and invite_expires_at > now()
      from public.end_assignment_with_invite(
        (
          select id
            from public.assignments
           where person_id = :'PENDING_KPA'
             and ended_on is null
           limit 1
        ),
        :'OWNER'::uuid,
        pg_temp.h('ENDCODE111'),
        interval '7 days'
      )
  ),
  'ending for a person with a pending invite returns its replacement'
);
select ok(
  (
    select ended_on = current_date
      from public.assignments
     where person_id = :'PENDING_KPA'
     order by created_at
     limit 1
  ),
  'the assignment is ended, not deleted'
);
select is(
  pg_temp.live_invite(:'PENDING_KPA'::uuid),
  1::bigint,
  'the end leaves exactly one live invite'
);
select is(pg_temp.redeem('KMNPQRSTVW'), 'invalid', 'the pre-end code is dead');
select is(
  pg_temp.redeem('ENDCODE111', 'pending.kanchrapara'),
  'ok',
  'the replacement end code works'
);

rollback to end_reissues;

savepoint no_pending_invite;

select ok(
  (
    select invite_id is null and invite_expires_at is null
      from public.grant_assignment_with_invite(
        :'STAFF_KAL'::uuid,
        'employee',
        :'KPA'::uuid,
        null,
        :'OWNER'::uuid,
        pg_temp.h('DISCARDED1'),
        interval '7 days'
      )
  ),
  'granting an already activated person returns no code'
);
select is(
  pg_temp.live_invite(:'STAFF_KAL'::uuid),
  0::bigint,
  'and creates no unsolicited reset invite'
);

rollback to no_pending_invite;

-- ---------------------------------------------------------------------------
-- 3. A replacement failure rolls the assignment mutation back too.
--
-- Each call uses the other pending person's live hash. The global live-hash
-- unique index rejects the replacement insert after the assignment trigger
-- has superseded the old invite; the surrounding function transaction must
-- restore both facts.

savepoint grant_rolls_back;

select throws_ok(
  format(
    $q$
      select * from public.grant_assignment_with_invite(
        %L, 'employee', %L, null, %L, %L, interval '7 days'
      )
    $q$,
    :'PENDING_KAL',
    :'KPA',
    :'OWNER',
    pg_temp.h('KMNPQRSTVW')
  ),
  '23505',
  null,
  'a replacement failure aborts the grant function'
);
select is(
  (
    select count(*)
      from public.assignments
     where person_id = :'PENDING_KAL'
       and outlet_id = :'KPA'
       and ended_on is null
  ),
  0::bigint,
  'the failed replacement leaves no granted assignment'
);
select is(
  pg_temp.live_invite(:'PENDING_KAL'::uuid),
  1::bigint,
  'and restores the original pending invite'
);
select is(pg_temp.redeem('ABCDEFGHJK'), 'ok', 'the original code still works after rollback');

rollback to grant_rolls_back;

savepoint end_rolls_back;

select throws_ok(
  format(
    $q$
      select * from public.end_assignment_with_invite(
        %L, %L, %L, interval '7 days'
      )
    $q$,
    (
      select id::text
        from public.assignments
       where person_id = :'PENDING_KPA'
         and ended_on is null
       limit 1
    ),
    :'OWNER',
    pg_temp.h('ABCDEFGHJK')
  ),
  '23505',
  null,
  'a replacement failure aborts the end function'
);
select is(
  (
    select count(*)
      from public.assignments
     where person_id = :'PENDING_KPA'
       and ended_on is null
  ),
  1::bigint,
  'the failed replacement leaves the assignment live'
);
select is(
  pg_temp.live_invite(:'PENDING_KPA'::uuid),
  1::bigint,
  'and restores the original pending invite after a failed end'
);
select is(
  pg_temp.redeem('KMNPQRSTVW', 'pending.kanchrapara'),
  'ok',
  'the pre-end code still works after rollback'
);

rollback to end_rolls_back;

-- ---------------------------------------------------------------------------
-- 4. This is privileged machinery, never a browser RPC.
--
-- Kept outside the scenario savepoints so pgTAP's final counter describes
-- these durable assertions; scenario counters are intentionally rolled back
-- with their data, following the existing invite-suite pattern.

select ok(
  has_function_privilege(
    'service_role',
    'public.grant_assignment_with_invite(uuid,public.app_role,uuid,text,uuid,text,interval)',
    'EXECUTE'
  ),
  'the service role may call the transactional grant function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.grant_assignment_with_invite(uuid,public.app_role,uuid,text,uuid,text,interval)',
    'EXECUTE'
  ),
  'an authenticated browser may not call the transactional grant function'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.grant_assignment_with_invite(uuid,public.app_role,uuid,text,uuid,text,interval)',
    'EXECUTE'
  ),
  'an anonymous caller may not call the transactional grant function'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.end_assignment_with_invite(uuid,uuid,text,interval)',
    'EXECUTE'
  ),
  'the service role may call the transactional end function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.end_assignment_with_invite(uuid,uuid,text,interval)',
    'EXECUTE'
  ),
  'an authenticated browser may not call the transactional end function'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.end_assignment_with_invite(uuid,uuid,text,interval)',
    'EXECUTE'
  ),
  'an anonymous caller may not call the transactional end function'
);

select * from finish();
rollback;
