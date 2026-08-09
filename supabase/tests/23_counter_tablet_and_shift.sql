-- The counter tablet, and the two-device handshake that opens a shift on it.
--
-- Everything this change claims about who may open a counter is claimed here,
-- with no UI in the picture. The reason it is worth this much SQL is that every
-- one of these refusals is silent when it goes wrong: a tablet that could open a
-- shift for somebody who never touched it looks exactly like a tablet that
-- works.
--
-- Four properties carry the whole design, and each is asserted from both sides:
--
--   1. **No password reaches the tablet.** Setup is a one-time code, and opening
--      a shift is a username plus a code the person reads OFF the tablet. There
--      is nothing here that takes a password, so there is nothing to assert
--      about one; what is asserted is that neither code is ever readable.
--   2. **Only the named person may confirm.** Not their manager, not the owner,
--      not a colleague at the same outlet, with or without the correct code.
--   3. **The tablet learns nothing.** An unknown username produces the same
--      request, the same code and the same timeout as a real one, so the counter
--      cannot be used to find out who works here.
--   4. **One active tablet per outlet**, in the database rather than in a
--      screen, because two tablets at one counter is a money-attribution
--      problem before it is a UI problem.

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

-- Back to `postgres` with no session identity at all. `reset role` alone is not
-- enough: the claim is transaction-local rather than role-local, so it survives
-- the role change and `auth.uid()` keeps answering with whoever was last
-- impersonated.
create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.hash(p_code text)
returns text language sql immutable as $$
  select encode(extensions.digest(p_code, 'sha256'), 'hex')
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set DEVICE_GONE '10000000-0000-4000-a000-000000000009'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- ---------------------------------------------------------------------------
-- 0. The tablet is a machine, not a person.
--
-- The seed used to give each tablet a profile and a Biller assignment, which
-- meant every policy that asked "is this an active account" said yes to a piece
-- of hardware. These two assertions are the whole point of the separation, and
-- they are first because everything below depends on them.

select is(
  (select count(*) from public.profiles where id in (:'DEVICE_KAL', :'DEVICE_KPA', :'DEVICE_GONE')),
  0::bigint,
  'a counter tablet has no profile');

select is(
  (select count(*) from public.assignments
    where person_id in (:'DEVICE_KAL', :'DEVICE_KPA', :'DEVICE_GONE')),
  0::bigint,
  'a counter tablet holds no assignment');

-- ---------------------------------------------------------------------------
-- 1. One active tablet per outlet, in the database.

select has_index('public', 'counter_devices', 'counter_devices_one_active_per_outlet',
  'the one-active-tablet-per-outlet invariant is an index, not a convention');

select pg_temp.unimpersonate();

select throws_ok($$
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new,
                          email_change_token_current, email_change, phone_change,
                          phone_change_token, reauthentication_token, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000',
          'dddddddd-0000-4000-a000-000000000001', 'authenticated', 'authenticated',
          'second.tablet.kalyani@login.shawarmania.invalid', now(),
          '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false);
  insert into public.counter_devices (id, outlet_id, label, set_up_by)
  values ('dddddddd-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001', 'Second Kalyani tablet',
          '10000000-0000-4000-a000-000000000002')
$$, '23505', null, 'a second active tablet at one outlet is refused by the database');

-- The removed Kalyani tablet proves the index is partial rather than a plain
-- unique constraint: history keeps as many removed tablets as an outlet has had.
select is(
  (select count(*) from public.counter_devices
    where outlet_id = :'KAL' and removed_at is not null),
  1::bigint,
  'a removed tablet stays in the table and does not block the active one');

-- ---------------------------------------------------------------------------
-- 2. The setup code.
--
-- Issued by an admin from their own device, hashed at rest, single-use, and
-- readable by nobody.

select is(
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'counter_device_setup_codes'
      and grantee in ('authenticated', 'anon')),
  0::bigint,
  'no client role holds any privilege on the setup codes at all');

select pg_temp.unimpersonate();

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KPA', :'FA_KAL', 'Hand-crafted', pg_temp.hash('NOPE'), interval '10 minutes')),
  'not_authorised',
  'a manager cannot issue a setup code for an outlet they do not manage');

select is(
  (select count(*) from public.counter_device_setup_codes where outlet_id = :'KPA'),
  0::bigint,
  'the refused cross-outlet issue left no row behind');

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'FA_KAL', 'Replacement Kalyani tablet', pg_temp.hash('SETUP1'),
     interval '10 minutes')),
  'tablet_exists',
  'a setup code is refused while the outlet already has an active tablet');

-- Remove the Kalyani tablet so the rest of this section has an outlet to set up.
select is(
  public.remove_counter_device(:'DEVICE_KAL', :'BILLER_KAL'),
  'not_authorised',
  'a Biller cannot remove the tablet they bill on');

select is(
  public.remove_counter_device(:'DEVICE_KAL', :'FA_KPA'),
  'not_authorised',
  'a manager cannot remove the other outlet''s tablet');

select is(
  public.remove_counter_device(:'DEVICE_KAL', :'FA_KAL'),
  'ok',
  'the outlet''s own manager removes its tablet');

select isnt(
  (select removed_at from public.counter_devices where id = :'DEVICE_KAL'),
  null,
  'removal is recorded on the tablet row');

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'FA_KAL', 'Replacement Kalyani tablet', pg_temp.hash('SETUP1'),
     interval '10 minutes')),
  'ok',
  'the outlet''s manager issues a setup code once the outlet has no active tablet');

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'OWNER', 'Owner-issued Kalyani tablet', pg_temp.hash('SETUP2'),
     interval '10 minutes')),
  'ok',
  'the owner issues a setup code for any outlet');

select is(
  (select count(*) from public.counter_device_setup_codes
    where outlet_id = :'KAL' and consumed_at is null and superseded_at is null),
  1::bigint,
  'issuing supersedes the outstanding code rather than leaving two live');

-- A fresh machine identity for the replacement tablet. In production the Edge
-- Function creates this immediately before redeeming, and deletes it again if
-- redemption refuses — which is what makes a failed setup leave nothing that can
-- authenticate.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change_token_current, email_change, phone_change,
                        phone_change_token, reauthentication_token, is_sso_user)
values ('00000000-0000-0000-0000-000000000000',
        'dddddddd-0000-4000-a000-000000000002', 'authenticated', 'authenticated',
        'new.tablet.kalyani@login.shawarmania.invalid', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false),
       ('00000000-0000-0000-0000-000000000000',
        'dddddddd-0000-4000-a000-000000000003', 'authenticated', 'authenticated',
        'spare.tablet.kalyani@login.shawarmania.invalid', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false);

select is(
  (select status from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP1'), 'dddddddd-0000-4000-a000-000000000002')),
  'invalid',
  'a superseded code is refused, and says only that it is invalid');

select is(
  (select status from public.redeem_counter_device_setup_code(
     pg_temp.hash('WRONG'), 'dddddddd-0000-4000-a000-000000000002')),
  'invalid',
  'an unknown code is refused with the same answer as a superseded one');

select is(
  (select outlet_id from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP2'), 'dddddddd-0000-4000-a000-000000000002')),
  :'KAL'::uuid,
  'the live code sets the tablet up at the outlet it was issued for');

select is(
  (select count(*) from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002' and removed_at is null),
  1::bigint,
  'the tablet row exists and is active');

select is(
  (select status from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP2'), 'dddddddd-0000-4000-a000-000000000003')),
  'invalid',
  'a consumed code cannot set up a second tablet');

-- The one refusal that is allowed to be specific, because it describes the
-- OUTLET rather than the code, and the caller already holds a live code for that
-- outlet and therefore already knows which outlet it is.
select pg_temp.unimpersonate();
select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'OWNER', 'Third Kalyani tablet', pg_temp.hash('SETUP3'), interval '10 minutes')),
  'tablet_exists',
  'the outlet is full again, so no further code is issued');

-- ---------------------------------------------------------------------------
-- 3. The shift request.
--
-- From here on the Kalyani tablet is the replacement one.

\set TABLET 'dddddddd-0000-4000-a000-000000000002'

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('1111'), interval '2 minutes')),
  'ok',
  'the tablet opens a shift request from a username alone');

select is(
  (select person_id from public.counter_shift_requests
    where device_id = :'TABLET' and resolution is null),
  :'BILLER_KAL'::uuid,
  'the request names the person the username identifies');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'nobody.at.all', pg_temp.hash('2222'), interval '2 minutes')),
  'ok',
  'an unknown username produces exactly the same answer as a real one');

select is(
  (select person_id from public.counter_shift_requests
    where device_id = :'TABLET' and resolution is null),
  null,
  'the request for an unknown username names nobody and still exists');

select is(
  (select count(*) from public.counter_shift_requests
    where device_id = :'TABLET' and resolution is null),
  1::bigint,
  'a tablet holds at most one pending request');

select is(
  (select resolution from public.counter_shift_requests
    where device_id = :'TABLET' and person_id = :'BILLER_KAL'),
  'superseded',
  'the earlier request is superseded rather than left open');

select has_index('public', 'counter_shift_requests',
  'counter_shift_requests_one_pending_per_device',
  'one-pending-request-per-tablet is an index, not a convention');

-- Cancellation, the ordinary case of a mistyped name.
select is(
  public.cancel_counter_shift_request(:'TABLET'),
  'ok',
  'the tablet cancels its own pending request');

select is(
  (select resolution from public.counter_shift_requests
    where device_id = :'TABLET' and person_id is null),
  'cancelled',
  'the cancelled request is resolved, so the card can be withdrawn from the phone');

select is(
  public.cancel_counter_shift_request(:'TABLET'),
  'none',
  'cancelling with nothing pending is not an error and changes nothing');

-- ---------------------------------------------------------------------------
-- 4. Confirmation.

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('4821'), interval '2 minutes')),
  'ok',
  'a fresh request for the outlet''s Biller');

\set REQ_SQL 'select id from public.counter_shift_requests where device_id = ''dddddddd-0000-4000-a000-000000000002'' and resolution is null'

create function pg_temp.pending_request()
returns uuid language sql stable as $$
  select id from public.counter_shift_requests
   where device_id = 'dddddddd-0000-4000-a000-000000000002' and resolution is null
$$;

select is(
  (select status from public.confirm_counter_shift(
     :'FA_KAL', pg_temp.pending_request(), pg_temp.hash('4821'))),
  'invalid',
  'the outlet''s manager cannot confirm a request naming somebody else, correct code and all');

select is(
  (select status from public.confirm_counter_shift(
     :'OWNER', pg_temp.pending_request(), pg_temp.hash('4821'))),
  'invalid',
  'nor can the owner: there is no fallback approver, by decision');

select is(
  (select count(*) from public.counter_shifts where device_id = :'TABLET'),
  0::bigint,
  'neither attempt opened a shift');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('0000'))),
  'wrong_code',
  'a wrong code from the right person opens nothing');

select is(
  (select attempts from public.counter_shift_requests where id = pg_temp.pending_request()),
  1,
  'the wrong code is counted');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('0001'))),
  'wrong_code',
  'a second wrong code is still only a wrong code');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('0002'))),
  'exhausted',
  'the third wrong code destroys the request');

select is(
  (select count(*) from public.counter_shift_requests
    where device_id = :'TABLET' and resolution is null),
  0::bigint,
  'an exhausted request is resolved, so the tablet asks again with a new code');

-- The real thing.
select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'BILLER.KALYANI', pg_temp.hash('4821'), interval '2 minutes')),
  'ok',
  'the username is matched case-insensitively, as it is at sign-in');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('4821'))),
  'ok',
  'the named person enters the tablet''s code and the shift opens');

create function pg_temp.live_shift()
returns uuid language sql stable as $$
  select id from public.counter_shifts
   where device_id = 'dddddddd-0000-4000-a000-000000000002'
     and ended_at is null and expires_at > now()
$$;

select is(
  (select person_id from public.counter_shifts where id = pg_temp.live_shift()),
  :'BILLER_KAL'::uuid,
  'the shift is attributed to the person who confirmed it');

select is(
  (select outlet_id from public.counter_shifts where id = pg_temp.live_shift()),
  :'KAL'::uuid,
  'the shift belongs to the tablet''s outlet');

select is(
  (select business_date from public.counter_shifts where id = pg_temp.live_shift()),
  public.app_business_date(now(), time '04:00'),
  'the shift carries an explicit business date resolved from the outlet cutover');

select ok(
  (select expires_at from public.counter_shifts where id = pg_temp.live_shift()) > now(),
  'the shift is live');

select ok(
  (select expires_at from public.counter_shifts where id = pg_temp.live_shift())
    <= now() + interval '24 hours',
  'and expires at the outlet''s next cutover rather than lasting indefinitely');

-- The code is consumed by its first correct use.
select is(
  (select resolution from public.counter_shift_requests
    where device_id = :'TABLET' and resolution = 'confirmed'),
  'confirmed',
  'the request is consumed by the confirmation');

-- ---------------------------------------------------------------------------
-- 5. Who may hold a shift, and who may not.

select is(
  public.end_counter_shift(:'BILLER_KAL', pg_temp.live_shift()),
  'ok',
  'the operator ends their own shift from their own device');

select is(
  (select ended_reason from public.counter_shifts
    where device_id = :'TABLET' and ended_at is not null),
  'operator',
  'and the end is recorded as theirs');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'staff.kalyani', pg_temp.hash('3333'), interval '2 minutes')),
  'ok',
  'an ordinary Employee''s username produces an ordinary-looking request');

select is(
  (select status from public.confirm_counter_shift(
     :'EMPLOYEE_KAL', pg_temp.pending_request(), pg_temp.hash('3333'))),
  'not_eligible',
  'an Employee with no Biller assignment cannot hold a shift');

select is(
  (select count(*) from public.counter_shifts
    where device_id = :'TABLET' and ended_at is null and expires_at > now()),
  0::bigint,
  'and no shift opened');

-- The other outlet's Biller, with the correct code, at the wrong counter.
select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kanchrapara', pg_temp.hash('5555'), interval '2 minutes')),
  'ok',
  'the other outlet''s Biller may be named on this tablet');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KPA', pg_temp.pending_request(), pg_temp.hash('5555'))),
  'not_eligible',
  'but they hold no assignment at this outlet, so no shift opens');

-- The manager and the owner may cover the counter themselves.
select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'admin.kalyani', pg_temp.hash('6666'), interval '2 minutes')),
  'ok',
  'the outlet''s manager asks for the counter');

select is(
  (select status from public.confirm_counter_shift(
     :'FA_KAL', pg_temp.pending_request(), pg_temp.hash('6666'))),
  'ok',
  'the outlet''s manager may cover the counter');

select is(
  public.end_counter_shift(:'FA_KPA', pg_temp.live_shift()),
  'invalid',
  'nobody ends a shift they do not hold');

select is(
  public.end_counter_shift(:'FA_KAL', pg_temp.live_shift()),
  'ok',
  'the holder ends it');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'owner', pg_temp.hash('7777'), interval '2 minutes')),
  'ok',
  'the owner asks for the counter');

select is(
  (select status from public.confirm_counter_shift(
     :'OWNER', pg_temp.pending_request(), pg_temp.hash('7777'))),
  'ok',
  'the owner may cover any counter');

-- An assignment that ended between the request and the confirmation. Eligibility
-- is re-derived at confirmation rather than at request time, which is the only
-- moment that matters.
select is(
  public.end_counter_shift(:'OWNER', pg_temp.live_shift()),
  'ok',
  'the owner steps off the counter');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('8888'), interval '2 minutes')),
  'ok',
  'the Biller asks again');

update public.assignments
   set ended_on = current_date
 where person_id = :'BILLER_KAL' and role = 'biller' and ended_on is null;

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('8888'))),
  'not_eligible',
  'an assignment that ended between the request and the code is refused at the code');

-- Rehired, which is a new assignment rather than an un-ended one: an ended
-- assignment is history and history is not editable.
insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'BILLER_KAL', 'biller', :'KAL', current_date);

-- ---------------------------------------------------------------------------
-- 6. Expiry, both kinds.

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('9999'), interval '2 minutes')),
  'ok',
  'a request to expire');

update public.counter_shift_requests
   set expires_at = now() - interval '1 second'
 where id = pg_temp.pending_request();

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('9999'))),
  'invalid',
  'an expired request cannot be confirmed, correct code and all');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('1234'), interval '2 minutes')),
  'ok',
  'the tablet asks again after the expiry');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('1234'))),
  'ok',
  'and the shift opens');

-- Cutover. Nothing sweeps: a shift is live only while its expiry is ahead of
-- the clock, so reaching the cutover ends it with no job to run and nothing to
-- go wrong at 04:00.
update public.counter_shifts
   set expires_at = now() - interval '1 second'
 where device_id = :'TABLET' and ended_at is null;

select is(
  (select count(*) from public.counter_shifts
    where device_id = :'TABLET' and ended_at is null and expires_at > now()),
  0::bigint,
  'at cutover the shift stops being live without anything having to run');

select is(
  (select count(*) from public.counter_shifts
    where device_id = :'TABLET' and person_id = :'BILLER_KAL'),
  2::bigint,
  'and the expired shift stays on the record, so old work stays attributable');

-- ---------------------------------------------------------------------------
-- 7. Removal ends everything on the tablet, immediately.

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('2468'), interval '2 minutes')),
  'ok',
  'one more request, to be caught by the removal');

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KAL', pg_temp.pending_request(), pg_temp.hash('2468'))),
  'ok',
  'and one more live shift');

select is(
  public.remove_counter_device(:'TABLET', :'OWNER'),
  'ok',
  'the owner removes the tablet');

select is(
  (select count(*) from public.counter_shifts
    where device_id = :'TABLET' and ended_at is null),
  0::bigint,
  'removing the tablet ends the shift on it');

-- Counted rather than ordered: every row in this test file carries the same
-- `now()`, so "the most recent shift" is not a question this transaction can
-- answer.
select is(
  (select count(*) from public.counter_shifts
    where device_id = :'TABLET' and ended_reason = 'device_removed'),
  1::bigint,
  'and says why');

select is(
  (select status from public.request_counter_shift(
     :'TABLET', 'biller.kalyani', pg_temp.hash('1357'), interval '2 minutes')),
  'device_unknown',
  'a removed tablet cannot ask for another shift');

select is(
  public.remove_counter_device(:'TABLET', :'OWNER'),
  'invalid',
  'and removing it twice is not a second removal');

-- ---------------------------------------------------------------------------
-- 8. What each session can read.
--
-- The Kanchrapara tablet is untouched by everything above, so it is the one
-- used to assert reach.

select pg_temp.unimpersonate();

select is(
  (select status from public.request_counter_shift(
     :'DEVICE_KPA', 'biller.kanchrapara', pg_temp.hash('3691'), interval '2 minutes')),
  'ok',
  'the Kanchrapara tablet asks for its Biller');

create function pg_temp.kpa_request()
returns uuid language sql stable as $$
  select id from public.counter_shift_requests
   where device_id = '10000000-0000-4000-a000-000000000005' and resolution is null
$$;

-- The code, from every angle.
select pg_temp.impersonate(:'BILLER_KPA'::uuid);

select is(
  (select count(*) from public.counter_shift_requests where id = pg_temp.kpa_request()),
  1::bigint,
  'the named person sees the request waiting for them');

select throws_ok(
  'select code_hash from public.counter_shift_requests',
  '42501',
  null,
  'and cannot read the code, because no client role holds that column');

select pg_temp.impersonate(:'BILLER_KAL'::uuid);

select is(
  (select count(*) from public.counter_shift_requests where id = pg_temp.kpa_request()),
  0::bigint,
  'a colleague sees nothing of a request naming somebody else');

select pg_temp.impersonate(:'FA_KPA'::uuid);

select is(
  (select count(*) from public.counter_shift_requests where id = pg_temp.kpa_request()),
  0::bigint,
  'nor does the outlet''s own manager: a request is between one tablet and one person');

select pg_temp.impersonate(:'OWNER'::uuid);

select is(
  (select count(*) from public.counter_shift_requests where id = pg_temp.kpa_request()),
  0::bigint,
  'nor the owner, for the same reason');

select pg_temp.impersonate(:'DEVICE_KPA'::uuid);

select is(
  (select count(*) from public.counter_shift_requests where id = pg_temp.kpa_request()),
  1::bigint,
  'the tablet watches its own request, which is how it notices the shift open');

select is(
  (select count(*) from public.counter_shift_requests
    where device_id = '10000000-0000-4000-a000-000000000004'),
  0::bigint,
  'and sees no other tablet''s requests');

-- No client writes any of this. Every state change goes through the privileged
-- functions, which is what makes "only the named person may confirm" a boundary
-- rather than an application rule.
select pg_temp.impersonate(:'BILLER_KPA'::uuid);

select throws_ok(
  format('update public.counter_shift_requests set resolution = ''confirmed'' where id = %L',
         pg_temp.kpa_request()),
  '42501',
  null,
  'nobody updates a shift request directly, not even its subject');

select throws_ok(
  'insert into public.counter_shifts (device_id, outlet_id, person_id, business_date, expires_at) '
  'values (''10000000-0000-4000-a000-000000000005'', ''00000000-0000-4000-a000-000000000002'', '
  '''10000000-0000-4000-a000-00000000000b'', current_date, now() + interval ''1 hour'')',
  '42501',
  null,
  'and nobody hand-writes themselves a shift');

select pg_temp.unimpersonate();

select is(
  (select status from public.confirm_counter_shift(
     :'BILLER_KPA', pg_temp.kpa_request(), pg_temp.hash('3691'))),
  'ok',
  'the Kanchrapara Biller opens their counter');

select pg_temp.impersonate(:'BILLER_KPA'::uuid);

select is(
  (select count(*) from public.counter_shifts
    where person_id = :'BILLER_KPA' and ended_at is null),
  1::bigint,
  'the operator sees the shift they hold, which is what the end button acts on');

select pg_temp.impersonate(:'FA_KPA'::uuid);

select is(
  (select count(*) from public.counter_shifts where outlet_id = :'KPA' and ended_at is null),
  1::bigint,
  'the outlet''s manager sees who is on the counter');

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select count(*) from public.counter_shifts where outlet_id = :'KPA'),
  0::bigint,
  'and the other outlet''s manager sees none of it');

select * from finish();
rollback;
