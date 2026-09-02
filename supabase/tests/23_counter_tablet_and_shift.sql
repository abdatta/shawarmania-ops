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
--   4. **Several tablets per outlet, each proven and each labelled uniquely**,
--      in the database rather than in a screen. Until
--      multiple-billing-devices an outlet was held to one, because two tablets
--      at one counter was a money-attribution problem before it was a UI
--      problem; that attribution is now asserted rather than avoided, and what
--      the database enforces instead is that a redeemed code is not a counter
--      until a browser proves a session, and that no two live counters at one
--      outlet answer to the same label.

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
\set DEVICE_KAL2 '10000000-0000-4000-a000-00000000000f'
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
-- 1. Several tablets per outlet, and what the database enforces instead.
--
-- The seed is one active tablet per outlet, because that is the shape the
-- business runs and almost every other suite has to keep seeing it. The spare
-- is seeded removed; this section brings it back for the label rules that need
-- two live counters, and puts it away again before the handshake sections
-- below, which are about one tablet and a person's phone.

update public.counter_devices set removed_at = null
 where id = '10000000-0000-4000-a000-00000000000f';

select hasnt_index('public', 'counter_devices', 'counter_devices_one_active_per_outlet',
  'the one-active-tablet-per-outlet index is gone rather than merely unused');

select has_index('public', 'counter_devices', 'counter_devices_one_active_label_per_outlet',
  'what replaces it is label uniqueness among an outlet''s live counters');

select is(
  (select count(*) from public.counter_devices
    where outlet_id = :'KAL' and removed_at is null and session_proven_at is not null),
  2::bigint,
  'an outlet holds two active tablets at once');

select pg_temp.unimpersonate();

-- The identity has to exist before the row can reference it, exactly as the Edge
-- Function does it in production.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change_token_current, email_change, phone_change,
                        phone_change_token, reauthentication_token, is_sso_user)
values ('00000000-0000-0000-0000-000000000000',
        'dddddddd-0000-4000-a000-000000000001', 'authenticated', 'authenticated',
        'third.tablet.kalyani@login.shawarmania.invalid', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false);

select throws_ok($$
  insert into public.counter_devices (id, outlet_id, label, set_up_by, session_proven_at)
  values ('dddddddd-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001', 'kalyani SECOND counter',
          '10000000-0000-4000-a000-000000000002', now())
$$, '23505', null,
  'two live counters at one outlet cannot answer to the same label, whatever its case');

-- The same label at the OTHER outlet is not a collision: the label tells one
-- shop's counters apart and is not an identifier anything joins on.
select lives_ok($$
  insert into public.counter_devices (id, outlet_id, label, set_up_by, session_proven_at)
  values ('dddddddd-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000002', 'Kalyani second counter',
          '10000000-0000-4000-a000-000000000003', now())
$$, 'the same label at a different outlet is accepted');

select lives_ok($$
  update public.counter_devices set label = 'Kalyani old tablet (removed)'
   where id = 'dddddddd-0000-4000-a000-000000000001'
$$, 'a removed tablet''s label may be taken by a live counter elsewhere');

delete from public.counter_devices where id = 'dddddddd-0000-4000-a000-000000000001';

-- The index is partial, so history keeps as many removed tablets as an outlet
-- has had, and none of them holds a label against a live one.
select is(
  (select count(*) from public.counter_devices
    where outlet_id = :'KAL' and removed_at is not null),
  1::bigint,
  'a removed tablet stays in the table and blocks no label');

select lives_ok($$
  insert into public.counter_devices (id, outlet_id, label, set_up_by, session_proven_at)
  values ('dddddddd-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001', 'Kalyani old tablet (removed)',
          '10000000-0000-4000-a000-000000000002', now())
$$, 'a removed tablet''s own label is reusable at its own outlet');

delete from public.counter_devices where id = 'dddddddd-0000-4000-a000-000000000001';

-- Neither proven nor pending is not a state anything can read, so it cannot be
-- written either.
select throws_ok($$
  insert into public.counter_devices (id, outlet_id, label, set_up_by)
  values ('dddddddd-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001', 'Neither proven nor pending',
          '10000000-0000-4000-a000-000000000002')
$$, '23514', null, 'a tablet row is either proven or inside a proof window');

-- ---------------------------------------------------------------------------
-- 1a. Renaming a counter.
--
-- Label uniqueness turns renaming from an UPDATE into a path: an admin who
-- cannot rename cannot resolve a collision they created, and the refusal has to
-- be a value rather than an error because reusing a removed tablet's label is
-- legitimate.

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'BILLER_KAL', 'Anything'),
  'not_authorised',
  'a Biller cannot rename the tablet they bill on');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KPA', 'Anything'),
  'not_authorised',
  'a manager cannot rename the other outlet''s tablet');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KAL', 'kalyani COUNTER tablet'),
  'label_taken',
  'a rename onto a live sibling''s label is refused as a value, not an error');

select is(
  (select label from public.counter_devices where id = :'DEVICE_KAL2'),
  'Kalyani second counter',
  'the refused rename left the label alone');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KAL', '   '),
  'invalid',
  'a blank label is refused');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KAL', '  Kalyani till two  '),
  'ok',
  'the outlet''s own manager renames its counter');

select is(
  (select label from public.counter_devices where id = :'DEVICE_KAL2'),
  'Kalyani till two',
  'the new label is stored without its surrounding space');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KAL', 'Kalyani old tablet (removed)'),
  'ok',
  'a removed tablet''s label may be taken by a live counter');

select is(
  public.rename_counter_device(:'DEVICE_KAL2', :'FA_KAL', 'Kalyani second counter'),
  'ok',
  'and renaming it back leaves the spare as this file found it');

-- Put the spare away. Everything below is about one tablet, a username and four
-- digits on somebody's own phone, and it should read the ordinary shop.
update public.counter_devices set removed_at = now() - interval '1 day'
 where id = '10000000-0000-4000-a000-00000000000f';

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

-- An outlet holding counters is no longer a reason to refuse a code. The label
-- is, and it is refused here rather than at the counter so the admin reads it on
-- the phone they typed it on.
select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'FA_KAL', 'kalyani counter TABLET', pg_temp.hash('NOPE2'),
     interval '10 minutes')),
  'label_taken',
  'a code naming a label a live counter already holds is refused at the point of asking');

select is(
  (select count(*) from public.counter_device_setup_codes
    where outlet_id = :'KAL' and code_hash = pg_temp.hash('NOPE2')),
  0::bigint,
  'the refused label left no code behind');

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'FA_KAL', '   ', pg_temp.hash('NOPE3'), interval '10 minutes')),
  'invalid',
  'a blank label is refused rather than stored');

-- Remove the Kalyani tablet. Not because the outlet has to be emptied to accept
-- another one any more, but because the removal refusals below are asserted on a
-- tablet that is genuinely there, and because the rest of this file wants a
-- replacement tablet it set up itself.
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
  'the outlet''s manager issues a setup code under a label nothing live holds');

select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'OWNER', 'Owner-issued Kalyani tablet', pg_temp.hash('SETUP2'),
     interval '10 minutes')),
  'ok',
  'the owner issues a setup code for any outlet');

-- Two admins setting a tablet up each is the case the old one-live-code index
-- made unreachable: the second issue silently voided the first, and the admin
-- holding it was told only that their code was invalid.
select is(
  (select count(*) from public.counter_device_setup_codes
    where outlet_id = :'KAL' and consumed_at is null and superseded_at is null),
  2::bigint,
  'two live codes coexist at one outlet, and neither issue voided the other');

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
     pg_temp.hash('WRONG'), 'dddddddd-0000-4000-a000-000000000002')),
  'invalid',
  'an unknown code is refused, and says only that it is invalid');

select is(
  (select outlet_id from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP2'), 'dddddddd-0000-4000-a000-000000000002')),
  :'KAL'::uuid,
  'the live code sets the tablet up at the outlet it was issued for');

-- ---------------------------------------------------------------------------
-- 2a. A redeemed code is not yet a counter.
--
-- Redemption and the browser establishing its session cannot share one
-- transaction, so the row that redemption writes reaches nothing until the
-- browser proves it holds a session. This is the failure the backlog note
-- described: a lost response here used to spend the outlet's only counter and
-- need an admin to clear it. It is injected genuinely below -- a redemption that
-- committed followed by a sign-in that has not happened -- rather than asserted
-- from the code path that handles it.

select is(
  (select count(*) from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002' and removed_at is null),
  1::bigint,
  'redemption wrote a row');

select is(
  (select count(*) from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002'
      and removed_at is null and session_proven_at is not null),
  0::bigint,
  'the row it wrote is not a counter yet');

select isnt(
  (select proof_expires_at from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002'),
  null,
  'it carries the redeemed code''s own expiry as its proof window');

select is(
  (select proof_expires_at from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002'),
  (select expires_at from public.counter_device_setup_codes
    where code_hash = pg_temp.hash('SETUP2')),
  'that window is the code''s expiry rather than a second duration');

select is(
  (select status from public.request_counter_shift(
     'dddddddd-0000-4000-a000-000000000002', 'biller.kalyani',
     pg_temp.hash('9999'), interval '2 minutes')),
  'device_unknown',
  'an unproven tablet cannot open a shift, so nothing downstream of a shift can reach it');

select pg_temp.impersonate('dddddddd-0000-4000-a000-000000000002');

select is(public.app_device_ok(), false,
  'an unproven tablet is refused by the predicate every policy asks');

select is(public.app_counter_device(), null,
  'and it is not a tablet as far as any policy is concerned');

-- The browser signs in and says so. This is the whole of the proof: it holds a
-- session, so the row it names may become a counter.
select is(public.prove_counter_device_session(), 'ok',
  'the tablet proves its session and becomes a counter');

select is(public.prove_counter_device_session(), 'ok',
  'proving twice is success, because a lost response is the failure this survives');

select is(public.app_device_ok(), true,
  'a proven tablet passes the predicate it failed a moment ago');

select pg_temp.unimpersonate();

select is(
  (select count(*) from public.counter_devices
    where id = 'dddddddd-0000-4000-a000-000000000002'
      and removed_at is null and session_proven_at is not null),
  1::bigint,
  'the tablet row exists and is active');

select is(
  (select status from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP2'), 'dddddddd-0000-4000-a000-000000000003')),
  'invalid',
  'a consumed code cannot set up a second tablet');

-- An outlet is never full. A further code is issued for a further counter, and
-- the code SETUP1 that used to be superseded by this one is still live and still
-- redeemable, which is the whole of the second singleton going.
select pg_temp.unimpersonate();
select is(
  (select status from public.issue_counter_device_setup_code(
     :'KAL', :'OWNER', 'Third Kalyani tablet', pg_temp.hash('SETUP3'), interval '10 minutes')),
  'ok',
  'a further code is issued for a further counter');

select is(
  (select status from public.redeem_counter_device_setup_code(
     pg_temp.hash('SETUP1'), 'dddddddd-0000-4000-a000-000000000003')),
  'ok',
  'the code issued first is still live after two more were issued, and still sets a tablet up');

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

-- ---------------------------------------------------------------------------
-- 10. The tablet a person can see, and the tablet they cannot.
--
-- The approval card has to name the tablet, in the words somebody wrote on the
-- back of the hardware, or it reads "somebody wants you to open a counter" —
-- the exact shape of prompt people tap through without reading. So a person may
-- read a tablet that has asked for them, or one they are standing at, and the
-- reach starts and stops with the request and the shift rather than with the
-- employment.

select pg_temp.impersonate(:'BILLER_KPA'::uuid);

select is(
  (select count(*) from public.counter_devices
    where id = '10000000-0000-4000-a000-000000000005'),
  1::bigint,
  'the operator holding a shift can read the tablet they are standing at');

select is(
  (select count(*) from public.counter_devices
    where id = '10000000-0000-4000-a000-000000000004'),
  0::bigint,
  'and still cannot read the other outlet''s tablet');

-- The Kalyani Biller holds an assignment and no request and no shift, which is
-- the state the widening must NOT admit: employment alone reveals no hardware.
select pg_temp.impersonate(:'BILLER_KAL'::uuid);

select is(
  (select count(*) from public.counter_devices),
  0::bigint,
  'a Biller with no request and no shift sees no tablet at all');

select pg_temp.unimpersonate();

-- The owner is excluded from shift requests too, which is why the cross-outlet
-- sweep in 02 skips this table by name. Asserted here, where the reason lives,
-- rather than left as an absence somewhere else.
select pg_temp.impersonate(:'OWNER'::uuid);

-- Scoped to requests naming somebody else, because a request naming the owner is
-- theirs to read exactly as anybody's own is — the point is that seniority
-- confers nothing here.
select is(
  (select count(*) from public.counter_shift_requests where requested_username <> 'owner'),
  0::bigint,
  'the owner reads no request naming anybody but themselves: no fallback approver');

select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 11. What the adversarial review found, pinned so it cannot come back.
--
-- Every assertion below is written from the seat the finding was reproduced
-- from, rather than from the owner's, because four of the five were invisible
-- from anywhere else.

-- The tablet asks for a name that exists, and a name that does not, and must not
-- be able to tell which was which. This is the enumeration-safety property, and
-- it was FALSE at the boundary while being true of the screen: `person_id` was
-- in the column grant, so a real name read back a UUID and an invented one read
-- back NULL.
select is(
  (select status from public.request_counter_shift(
     :'DEVICE_KPA', 'biller.kanchrapara',
     pg_temp.hash('1111'), interval '2 minutes')),
  'ok',
  'the tablet asks for somebody who works here');

select pg_temp.impersonate(:'DEVICE_KPA'::uuid);

select throws_ok(
  'select person_id from public.counter_shift_requests',
  '42501',
  null,
  'and cannot read who, if anybody, that name resolved to');

select throws_ok(
  'select * from public.counter_shift_requests',
  '42501',
  null,
  'nor reach it through select *, which expands to the same column');

select lives_ok(
  'select id, device_id, outlet_id, requested_username, attempts, created_at, '
  'expires_at, resolution, resolved_at, shift_id from public.counter_shift_requests',
  'while everything the tablet actually needs is still readable');

select pg_temp.unimpersonate();

-- An eligibility oracle over the whole staff list, callable by anybody holding
-- any session — including a tablet that was removed. It is used from exactly one
-- SECURITY DEFINER function, so no client ever needed it.
select pg_temp.impersonate(:'DEVICE_GONE'::uuid);

select throws_ok(
  format('select public.app_may_hold_counter_shift(%L, %L)', :'BILLER_KPA', :'KPA'),
  '42501',
  null,
  'a removed tablet cannot ask whether somebody is allowed to bill somewhere');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);

select throws_ok(
  format('select public.app_may_hold_counter_shift(%L, %L)', :'BILLER_KPA', :'KPA'),
  '42501',
  null,
  'and neither can an ordinary Employee, about anybody, anywhere');

select pg_temp.unimpersonate();

-- The code is destroyed with its request, on every path out of pending rather
-- than only on the happy one. Four digits is 10,000 possibilities, so a retained
-- hash is the code written down.
select is(
  (select count(*) from public.counter_shift_requests
    where resolution is not null and code_hash is not null),
  0::bigint,
  'no resolved request anywhere still carries its code');

select throws_ok(
  'update public.counter_shift_requests set resolution = ''rejected'', '
  'resolved_at = now() where resolution is null',
  '23514',
  null,
  'and the table itself refuses a resolution that leaves the code behind');

-- The bounds are the database''s, not the calling layer''s.
select is(
  (select r.expires_at < now() + interval '10 minutes'
     from public.request_counter_shift(
       -- Kanchrapara's, because Kalyani's has been removed by the section above
       -- and a removed tablet is refused before the bound is ever reached.
       :'DEVICE_KPA', 'biller.kanchrapara',
       pg_temp.hash('2222'), interval '365 days') as r
    where r.status = 'ok'),
  true,
  'a request cannot be asked to live for a year, whatever the caller passes');

select pg_temp.unimpersonate();

select * from finish();
rollback;
