-- Account lifecycle truth and safe transitions: purpose-bearing live invites,
-- complete intended assignment-set edits, stale refusal, rollback, authority,
-- history preservation and explicit departure.

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
\set PENDING_KAL '10000000-0000-4000-a000-00000000000c'
\set SPLIT '10000000-0000-4000-a000-00000000000e'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

create function pg_temp.h(value text) returns text
language sql immutable as $$
  select encode(extensions.digest(value, 'sha256'), 'hex')
$$;

create function pg_temp.one_assignment(
  p_person uuid,
  p_role public.app_role,
  p_outlet uuid,
  p_started date default current_date
) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'assignmentId', a.id,
    'role', p_role,
    'outletId', p_outlet,
    'startedOn', p_started
  ))
    from public.assignments a
   where a.person_id = p_person and a.ended_on is null
   order by a.started_on
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Purpose is constrained, non-null and behaviorally live only before expiry.

select is(
  (select purpose::text from public.account_invites where profile_id = :'PENDING_KAL'),
  'activation',
  'seeded first-run handovers retain activation purpose'
);
select throws_ok(
  format('update public.account_invites set purpose = null where profile_id = %L', :'PENDING_KAL'),
  '23502', null, 'invite purpose cannot be null'
);

savepoint expired_invite;
update public.account_invites set expires_at = now() - interval '1 minute'
 where profile_id = :'PENDING_KAL';
select is(
  (
    select count(*) from public.account_invites
     where profile_id = :'PENDING_KAL'
       and consumed_at is null and superseded_at is null and expires_at > now()
  ),
  0::bigint,
  'an expired unused invite is not behaviorally live'
);
rollback to expired_invite;

-- ---------------------------------------------------------------------------
-- Promotion is one transaction: immutable history, one live replacement, and
-- no account-access change.

savepoint promotion;
create temp table promotion_before as
select public.account_state_fingerprint(:'STAFF_KAL') as fingerprint,
       id as assignment_id,
       started_on
  from public.assignments
 where person_id = :'STAFF_KAL' and ended_on is null;

select lives_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, %L, 'Synthetic Staff Promoted', '911111111006', 'Counter staff',
      null, %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', (select fingerprint from promotion_before),
    pg_temp.one_assignment(:'STAFF_KAL', 'biller', :'KAL', current_date)::text,
    :'OWNER', pg_temp.h('PROMOTION1')
  ),
  'the owner promotes Employee to Biller through one intended-set command'
);
select is(
  (select role::text from public.assignments
    where person_id = :'STAFF_KAL' and ended_on is null),
  'biller',
  'promotion leaves one live Biller assignment'
);
select ok(
  (select ended_on = current_date from public.assignments
    where id = (select assignment_id from promotion_before)),
  'the former Employee assignment is historically ended'
);
select is(
  (select count(*) from public.assignments where person_id = :'STAFF_KAL'),
  2::bigint,
  'promotion inserts history rather than rewriting the former row'
);
select ok(
  (select is_active from public.profiles where id = :'STAFF_KAL'),
  'ordinary assignment editing never deactivates sign-in'
);
select isnt(
  public.account_state_fingerprint(:'STAFF_KAL'),
  (select fingerprint from promotion_before),
  'the opaque state fingerprint changes after a committed edit'
);
rollback to promotion;

-- ---------------------------------------------------------------------------
-- Stale and invalid commands change nothing, including profile facts.

savepoint stale_edit;
create temp table stale_before as
select public.account_state_fingerprint(:'STAFF_KAL') as fingerprint;
select lives_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, %L, 'First committed name', '911111111006', 'Counter staff', null,
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', (select fingerprint from stale_before),
    pg_temp.one_assignment(:'STAFF_KAL', 'employee', :'KAL',
      (select started_on from public.assignments where person_id = :'STAFF_KAL' and ended_on is null))::text,
    :'OWNER', pg_temp.h('STALECODE1')
  ),
  'the first editor commits against the current fingerprint'
);
select throws_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, %L, 'Stale overwrite', '911111111006', 'Counter staff', null,
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', (select fingerprint from stale_before),
    pg_temp.one_assignment(:'STAFF_KAL', 'employee', :'KAL', current_date)::text,
    :'OWNER', pg_temp.h('STALECODE2')
  ),
  'P0001', 'stale account state',
  'a second editor using stale state is refused by the transaction'
);
select is(
  (select full_name from public.profiles where id = :'STAFF_KAL'),
  'First committed name',
  'stale refusal preserves the first committed profile facts'
);
rollback to stale_edit;

savepoint rollback_all;
select throws_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, public.account_state_fingerprint(%L), 'Should roll back',
      '911111111006', 'Changed title', null, '[]'::jsonb,
      %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', :'STAFF_KAL', :'OWNER', pg_temp.h('ROLLBACK01')
  ),
  '23514', null,
  'an empty ordinary intended set is refused'
);
select is(
  (select full_name from public.profiles where id = :'STAFF_KAL'),
  'Synthetic Staff Kal',
  'a refused command rolls profile facts back completely'
);
select is(
  (select count(*) from public.assignments
    where person_id = :'STAFF_KAL' and ended_on is null),
  1::bigint,
  'a refused command preserves the complete assignment set'
);
rollback to rollback_all;

-- ---------------------------------------------------------------------------
-- Current AND desired sets are authority inputs. UI omissions confer nothing.

select ok(
  public.account_actor_may_replace_set(
    :'FA_KAL', :'STAFF_KAL', pg_temp.one_assignment(:'STAFF_KAL', 'biller', :'KAL')
  ),
  'a Kalyani FA may switch their Employee to Biller'
);
select ok(
  not public.account_actor_may_replace_set(
    :'FA_KAL', :'SPLIT',
    jsonb_build_array(jsonb_build_object(
      'assignmentId', (select id from public.assignments
        where person_id = :'SPLIT' and outlet_id = :'KAL' and ended_on is null),
      'role', 'employee', 'outletId', :'KAL'::uuid, 'startedOn', current_date
    ))
  ),
  'omitting the target current assignment outside the FA scope does not make it removable'
);
select ok(
  not public.account_actor_may_replace_set(
    :'FA_KAL', :'STAFF_KAL',
    jsonb_build_array(jsonb_build_object(
      'assignmentId', null, 'role', 'employee',
      'outletId', :'KPA'::uuid, 'startedOn', current_date
    ))
  ),
  'an FA cannot forge a desired placement outside their managed outlet'
);
select ok(
  not public.account_actor_may_replace_set(
    :'FA_KAL', :'FA_KPA', pg_temp.one_assignment(:'FA_KPA', 'employee', :'KAL')
  ),
  'an FA cannot alter another FA even by requesting an ordinary desired role'
);
select ok(
  not public.account_actor_may_replace_set(
    :'FA_KAL', :'OWNER', '[]'::jsonb
  ),
  'an FA cannot alter a Super Admin'
);
select ok(
  not public.account_actor_may_replace_set(
    :'OWNER', :'OWNER', '[]'::jsonb
  ),
  'the administrative path refuses self-edit even for the owner'
);
select ok(
  not public.account_actor_may_replace_set(
    :'STAFF_KAL', :'STAFF_KPA', pg_temp.one_assignment(:'STAFF_KPA', 'employee', :'KPA')
  ),
  'an Employee has no account-management authority'
);

savepoint duplicate_outlet;
select throws_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, public.account_state_fingerprint(%L), 'Synthetic Staff Kal',
      '911111111006', 'Counter staff', null,
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', :'STAFF_KAL',
    jsonb_build_array(
      jsonb_build_object('assignmentId', null, 'role', 'employee',
        'outletId', :'KAL'::uuid, 'startedOn', current_date),
      jsonb_build_object('assignmentId', null, 'role', 'biller',
        'outletId', :'KAL'::uuid, 'startedOn', current_date)
    )::text,
    :'OWNER', pg_temp.h('DUPLICATE1')
  ),
  '23505', null,
  'Employee and Biller cannot be stacked at one outlet'
);
rollback to duplicate_outlet;

-- ---------------------------------------------------------------------------
-- Owner access requires private email and demotion retains it.

savepoint owner_transition;
select throws_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, public.account_state_fingerprint(%L), 'Synthetic Staff Kal',
      '911111111006', 'Counter staff', null,
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', :'STAFF_KAL',
    jsonb_build_array(jsonb_build_object(
      'assignmentId', (select id from public.assignments
        where person_id = :'STAFF_KAL' and ended_on is null),
      'role', 'super_admin', 'outletId', null, 'startedOn', current_date
    ))::text,
    :'OWNER', pg_temp.h('NOEMAIL001')
  ),
  '23514', null,
  'granting Super Admin without private email is refused atomically'
);

select lives_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, public.account_state_fingerprint(%L), 'Synthetic Staff Kal',
      '911111111006', 'Counter staff', 'staff.owner@example.com',
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', :'STAFF_KAL',
    jsonb_build_array(jsonb_build_object(
      'assignmentId', (select id from public.assignments
        where person_id = :'STAFF_KAL' and ended_on is null),
      'role', 'super_admin', 'outletId', null, 'startedOn', current_date
    ))::text,
    :'OWNER', pg_temp.h('WITHEMAIL1')
  ),
  'owner access and its private email commit together'
);
select is(
  (select email from public.account_emails where profile_id = :'STAFF_KAL'),
  'staff.owner@example.com',
  'the guarded owner transition stores the normalized private email'
);

select lives_ok(
  format(
    $q$select * from public.edit_account_assignment_set(
      %L, %L, public.account_state_fingerprint(%L), 'Synthetic Staff Kal',
      '911111111006', 'Counter staff', null,
      %L::jsonb, %L, %L, interval '7 days')$q$,
    :'OWNER', :'STAFF_KAL', :'STAFF_KAL',
    jsonb_build_array(jsonb_build_object(
      'assignmentId', (select id from public.assignments
        where person_id = :'STAFF_KAL' and ended_on is null),
      'role', 'employee', 'outletId', :'KAL'::uuid, 'startedOn', current_date
    ))::text,
    :'OWNER', pg_temp.h('DEMOTION01')
  ),
  'another owner may demote a Super Admin while one remains'
);
select is(
  (select email from public.account_emails where profile_id = :'STAFF_KAL'),
  'staff.owner@example.com',
  'demotion retains the private account email'
);
rollback to owner_transition;

select throws_ok(
  format(
    'update public.assignments set ended_on = current_date '
    'where person_id = %L and role = ''super_admin'' and ended_on is null',
    :'OWNER'
  ),
  'P0001', null,
  'the database still refuses removing the final live Super Admin'
);

-- ---------------------------------------------------------------------------
-- Assignment transitions replace activation only; reset and expiry survive.

savepoint activation_replacement;
create temp table activation_before as
select id from public.account_invites where profile_id = :'PENDING_KAL'
 and consumed_at is null and superseded_at is null;
select ok(
  (
    select invite_id is not null and invite_expires_at > now()
      from public.edit_account_assignment_set(
        :'OWNER', :'PENDING_KAL', public.account_state_fingerprint(:'PENDING_KAL'),
        'Pending Staff Kal', '911111111014', 'Prep', null,
        pg_temp.one_assignment(:'PENDING_KAL', 'biller', :'KAL'),
        :'OWNER', pg_temp.h('ACTREPLACE'), interval '7 days'
      )
  ),
  'editing a person with live activation returns its replacement after final placement'
);
select ok(
  (select superseded_at is not null from public.account_invites
    where id = (select id from activation_before)),
  'the former activation handover is superseded'
);
select is(
  (select count(*) from public.account_invites where profile_id = :'PENDING_KAL'
    and purpose = 'activation' and consumed_at is null and superseded_at is null
    and expires_at > now()),
  1::bigint,
  'exactly one live replacement activation remains'
);
rollback to activation_replacement;

savepoint reset_preserved;
update public.account_invites set purpose = 'password_reset'
 where profile_id = :'PENDING_KAL' and consumed_at is null and superseded_at is null;
create temp table reset_before as
select id, expires_at from public.account_invites where profile_id = :'PENDING_KAL'
 and consumed_at is null and superseded_at is null;
select ok(
  (
    select invite_id is null and invite_expires_at is null
      from public.edit_account_assignment_set(
        :'OWNER', :'PENDING_KAL', public.account_state_fingerprint(:'PENDING_KAL'),
        'Pending Staff Kal', '911111111014', 'Prep', null,
        pg_temp.one_assignment(:'PENDING_KAL', 'biller', :'KAL'),
        :'OWNER', pg_temp.h('RESETSTAYS'), interval '7 days'
      )
  ),
  'assignment editing returns no replacement for a password-reset handover'
);
select ok(
  (select i.superseded_at is null and i.expires_at = b.expires_at
     from public.account_invites i join reset_before b on b.id = i.id),
  'the established password-reset handover remains live and unchanged'
);
rollback to reset_preserved;

savepoint expired_no_replacement;
update public.account_invites set expires_at = now() - interval '1 minute'
 where profile_id = :'PENDING_KAL' and consumed_at is null and superseded_at is null;
select ok(
  (
    select invite_id is null
      from public.edit_account_assignment_set(
        :'OWNER', :'PENDING_KAL', public.account_state_fingerprint(:'PENDING_KAL'),
        'Pending Staff Kal', '911111111014', 'Prep', null,
        pg_temp.one_assignment(:'PENDING_KAL', 'biller', :'KAL'),
        :'OWNER', pg_temp.h('EXPIREDNEW'), interval '7 days'
      )
  ),
  'an expired unused invite causes no unsolicited replacement'
);
rollback to expired_no_replacement;

-- ---------------------------------------------------------------------------
-- Explicit departure is atomic and retains all assignment history.

savepoint mark_left;
create temp table departure_before as
select public.account_state_fingerprint(:'SPLIT') as fingerprint,
       count(*) as history_count
  from public.assignments where person_id = :'SPLIT';
select lives_ok(
  format(
    'select * from public.mark_account_as_left(%L, %L, %L)',
    :'OWNER', :'SPLIT', (select fingerprint from departure_before)
  ),
  'Mark as left is one explicit transaction'
);
select is(
  (select count(*) from public.assignments
    where person_id = :'SPLIT' and ended_on is null),
  0::bigint,
  'Mark as left ends every live assignment'
);
select is(
  (select count(*) from public.assignments where person_id = :'SPLIT'),
  (select history_count from departure_before),
  'Mark as left deletes no assignment history'
);
select ok(
  not (select is_active from public.profiles where id = :'SPLIT'),
  'Mark as left deactivates sign-in atomically'
);
rollback to mark_left;

-- ---------------------------------------------------------------------------
-- Privilege boundaries: these commands and fingerprints never become browser RPCs.

select ok(
  has_function_privilege(
    'service_role',
    'public.edit_account_assignment_set(uuid,uuid,text,text,text,text,text,jsonb,uuid,text,interval)',
    'execute'
  ),
  'service_role may execute the atomic account edit'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.edit_account_assignment_set(uuid,uuid,text,text,text,text,text,jsonb,uuid,text,interval)',
    'execute'
  ),
  'an authenticated browser cannot execute the atomic account edit'
);
select ok(
  not has_function_privilege(
    'anon', 'public.mark_account_as_left(uuid,uuid,text)', 'execute'
  ),
  'an anonymous browser cannot execute Mark as left'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.account_state_fingerprint(uuid)', 'execute'
  ),
  'the opaque complete-state fingerprint is service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.issue_account_invite(uuid,uuid,text,interval,public.account_invite_purpose)',
    'execute'
  ),
  'service_role may issue a purpose-bearing handover'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.issue_account_invite(uuid,uuid,text,interval,public.account_invite_purpose)',
    'execute'
  ),
  'an authenticated browser cannot issue a purpose-bearing handover'
);

select * from finish();
rollback;
