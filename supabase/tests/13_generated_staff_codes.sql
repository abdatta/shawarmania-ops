-- The staff code the app issues, and who may change it afterwards.
--
-- Two claims. The first is that a staff account always ends up with a
-- sensible, outlet-scoped, unique code whether or not the caller supplied
-- one — a property of the table rather than a habit of one caller, which is
-- why it is a trigger and why it is tested here rather than only through the
-- form. The second is that changing a code afterwards is the owner's alone,
-- asserted from a Franchise Admin session by a hand-crafted `update`, because
-- `profiles_update_staff` is a row policy and a row policy permits every
-- column on a row it permits. A disabled form field proves nothing about that.
--
-- Codes are asserted by **shape, never by value**. The app picks them, so a
-- test that knew one in advance would be testing its own arithmetic.
--
-- Since staff-as-accounts a person is a profile, and a profile is keyed to an
-- auth user — so the file carries a helper that creates both, the same way
-- the privileged provision path does. Everything rolls back.

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

-- A person is an auth user plus a profile. `p_code` null lets the issue
-- trigger speak; a supplied value must be honoured.
create function pg_temp.mk_person(
  p_id uuid, p_outlet uuid, p_name text, p_code text default null,
  p_role text default 'employee'
)
returns void language plpgsql as $$
begin
  insert into auth.users
    (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token, is_sso_user)
  values
    ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
     'authenticated', p_id::text || '@codes.example.com', now(), 'x',
     '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', '', false);

  insert into public.profiles (id, full_name, role, outlet_id, staff_code)
  values (p_id, p_name, p_role::public.app_role, p_outlet, p_code);
end;
$$;

--                 outlet Kalyani       00000000-…0001  prefix KAL
--                 outlet Kanchrapara   00000000-…0002  prefix KAN
--                 owner                10000000-…0001
--                 admin Kalyani        10000000-…0002
--                 seeded staff account 10000000-…0006  KAL-E1

-- ── Issuing ──────────────────────────────────────────────────────────────────

select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c1'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Issued No Code');

select matches(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c1'),
  '^KAL-[0-9A-HJKMNP-TV-Z]{4}$',
  'a staff account created with no code is issued one in this outlet''s shape');

-- The prefix comes from the person's own outlet, not from anywhere ambient.
select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c2'::uuid,
  '00000000-0000-4000-a000-000000000002'::uuid, 'Issued Other Outlet');

select matches(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c2'),
  '^KAN-[0-9A-HJKMNP-TV-Z]{4}$',
  'a person at the other outlet is issued that outlet''s prefix');

-- A Franchise Admin is a person who works at the outlet, so they get a code
-- too. A counter device is not, and the owner has no outlet to prefix from.
select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c8'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Issued Admin', null, 'franchise_admin');

select matches(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c8'),
  '^KAL-[0-9A-HJKMNP-TV-Z]{4}$',
  'a franchise admin account is issued a staff code — admins are people');

select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c9'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Issued Device', null, 'biller');

select is(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c9'), null,
  'a counter-device account is issued nothing — a device is not a person');

-- A supplied code is stored unchanged. This is what keeps the seed working as
-- written and leaves an import path free to bring its own scheme.
select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c3'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Brought Own Code', 'LEGACY-77');

select is(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c3'),
  'LEGACY-77',
  'a code that was actually supplied is kept, not overwritten');

-- Blank and absent are the same thing on insert: '' and '   ' both mean
-- "issue me one" rather than being refused by profiles_staff_code_not_blank.
select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c4'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Empty String', '');

select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c5'::uuid,
  '00000000-0000-4000-a000-000000000001'::uuid, 'Whitespace', '   ');

select matches(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c4'),
  '^KAL-[0-9A-HJKMNP-TV-Z]{4}$',
  'an empty-string code is filled rather than refused');

select matches(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c5'),
  '^KAL-[0-9A-HJKMNP-TV-Z]{4}$',
  'a whitespace-only code is filled rather than refused');

-- ── Uniqueness under repetition ──────────────────────────────────────────────

select pg_temp.mk_person(gen_random_uuid(),
  '00000000-0000-4000-a000-000000000001'::uuid, 'Bulk ' || g)
  from generate_series(1, 20) g;

select is(
  (select count(distinct staff_code)::int from public.profiles
    where outlet_id = '00000000-0000-4000-a000-000000000001'
      and staff_code is not null),
  (select count(*)::int from public.profiles
    where outlet_id = '00000000-0000-4000-a000-000000000001'
      and staff_code is not null),
  'twenty consecutive creations at one outlet all carry distinct codes');

-- ── The retry, made deterministic ────────────────────────────────────────────
--
-- Randomness cannot demonstrate its own collision path, so the generator is
-- replaced with a counter for these two assertions. Everything rolls back.

create sequence pg_temp.suffix_seq;

create or replace function public.random_staff_suffix()
returns text language sql volatile set search_path = ''
as $$ select (array['AAAA','BBBB','CCCC'])[
       least(nextval('pg_temp.suffix_seq')::int, 3)] $$;

-- The first code the generator will offer is already taken, so issuing has to
-- notice and try again rather than failing or duplicating.
select pg_temp.mk_person(gen_random_uuid(),
  '00000000-0000-4000-a000-000000000002'::uuid, 'Holder', 'KAN-AAAA');

select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c6'::uuid,
  '00000000-0000-4000-a000-000000000002'::uuid, 'Collides First');

select is(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c6'),
  'KAN-BBBB',
  'issuing skips a code already taken at that outlet and takes the next');

-- And the bound is real: a generator that can only ever offer a taken code
-- raises after its ten attempts rather than looping forever.
create or replace function public.random_staff_suffix()
returns text language sql volatile set search_path = ''
as $$ select 'ZZZZ'::text $$;

select pg_temp.mk_person(gen_random_uuid(),
  '00000000-0000-4000-a000-000000000002'::uuid, 'Blocker', 'KAN-ZZZZ');

select throws_ok($$
  select pg_temp.mk_person(gen_random_uuid(),
    '00000000-0000-4000-a000-000000000002'::uuid, 'Cannot Be Issued')
$$, null, null,
  'a generator that can only collide raises rather than spinning');

-- Put the real generator back before anything else runs.
create or replace function public.random_staff_suffix()
returns text language sql volatile set search_path = ''
as $$
  select string_agg(
    substring('0123456789ABCDEFGHJKMNPQRSTVWXYZ'
              from (floor(random() * 32)::int + 1) for 1),
    '')
    from generate_series(1, 4);
$$;

-- ── Who may change a code ────────────────────────────────────────────────────

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($$
  update public.profiles set staff_code = 'KAL-HACK'
   where id = '10000000-0000-4000-a000-000000000006'
$$, '42501', null,
  'a franchise admin cannot change a staff code, even at their own outlet');

reset role;
select is(
  (select staff_code from public.profiles
    where id = '10000000-0000-4000-a000-000000000006'),
  'KAL-E1',
  'and the record keeps the code it had');

-- The guard is about one column, not the row. A manager still maintains the
-- staff facts around it.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($$
  update public.profiles
     set full_name = 'Renamed By Manager',
         role_title = 'Shift lead',
         left_on = current_date
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'the same manager still edits name, job title and departure date');

-- Writing the same value back is not a change, so it must not trip the guard —
-- otherwise every ordinary edit that echoes the field would be refused.
select lives_ok($$
  update public.profiles set staff_code = 'KAL-E1'
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'writing a code back unchanged is not a change and is not refused');

reset role;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select lives_ok($$
  update public.profiles set staff_code = 'KAL-OWNR'
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'the owner may change a staff code');

-- Blanking is still refused, for the owner as much as anyone: the record
-- already has a code, so clearing it is a mistake rather than a request to
-- re-issue. The guard answers before the check constraint can.
select throws_ok($$
  update public.profiles set staff_code = ''
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'P0001', null, 'the owner cannot blank a staff code either');

select throws_ok($$
  update public.profiles set staff_code = '   '
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'P0001', null, 'nor blank it with whitespace');

select throws_ok($$
  update public.profiles set staff_code = null
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'P0001', null, 'nor clear it to null');

-- Per-outlet uniqueness still governs what the owner may set by hand.
select throws_ok($$
  update public.profiles set staff_code = 'KAL-E2'
   where id = '10000000-0000-4000-a000-000000000006'
$$, '23505', null, 'a code already used at the same outlet is refused');

reset role;
select pg_temp.mk_person('20000000-0000-4000-a000-0000000000c7'::uuid,
  '00000000-0000-4000-a000-000000000002'::uuid, 'Same Code Elsewhere', 'KAL-E2');

select is(
  (select staff_code from public.profiles
    where id = '20000000-0000-4000-a000-0000000000c7'),
  'KAL-E2',
  'the same code at a different outlet is fine — uniqueness is per outlet');

-- ── The prefix ───────────────────────────────────────────────────────────────

select throws_ok($$
  insert into public.outlets (code, name, location_label, staff_code_prefix)
  values ('taken-prefix', 'Prefix Clash', 'Nowhere', 'KAL')
$$, '23505', null, 'a second outlet cannot take a prefix another outlet holds');

select throws_ok($$
  insert into public.outlets (code, name, location_label, staff_code_prefix)
  values ('bad-prefix', 'Bad Prefix', 'Nowhere', 'ab')
$$, '23514', null, 'a prefix that is not three uppercase alphanumerics is refused');

-- Free to change before the first code is issued — which is exactly when an
-- owner notices they would rather have something else.
insert into public.outlets (id, code, name, location_label, staff_code_prefix)
values ('00000000-0000-4000-a000-0000000000d1',
        'fresh', 'Fresh Outlet', 'Nowhere', 'FRS');

select lives_ok($$
  update public.outlets set staff_code_prefix = 'FR2'
   where id = '00000000-0000-4000-a000-0000000000d1'
$$, 'an outlet with no issued staff codes may still change its prefix');

-- And frozen the moment a code has been issued from it.
select pg_temp.mk_person(gen_random_uuid(),
  '00000000-0000-4000-a000-0000000000d1'::uuid, 'First Hire');

select throws_ok($$
  update public.outlets set staff_code_prefix = 'FR3'
   where id = '00000000-0000-4000-a000-0000000000d1'
$$, null, null,
  'once a staff code exists the prefix is frozen — issued codes read from it');

select is(
  (select staff_code_prefix from public.outlets
    where id = '00000000-0000-4000-a000-0000000000d1'),
  'FR2',
  'and the prefix is unchanged after the refusal');

-- Editing an outlet without touching the prefix must stay possible forever.
select lives_ok($$
  update public.outlets set name = 'Fresh Outlet Renamed'
   where id = '00000000-0000-4000-a000-0000000000d1'
$$, 'an outlet with staff can still be edited in every other respect');

-- ── Seeds and service-role writes ────────────────────────────────────────────
--
-- The owner-only gate is wrapped in `auth.uid() is not null` for this reason:
-- a seed carries no role claim, and without the wrapper seeding would break.

reset role;
select lives_ok($$
  update public.profiles set staff_code = 'KAL-SEED'
   where id = '10000000-0000-4000-a000-000000000006'
$$, 'a write with no session at all — a seed — may still set a code');

select * from finish();
rollback;
