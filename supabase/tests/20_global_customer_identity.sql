-- Global customer identity: one phone is one customer for the whole business,
-- and that is the ONLY thing it is.
--
-- The interesting assertions here are the negative ones. A global table in a
-- multi-tenant schema is a standing invitation to a leak, so this file spends
-- most of its length proving what a Franchise Admin, a Biller and a counter
-- device CANNOT do: list the directory, match a prefix, select the table
-- directly, or turn a customer id they legitimately hold into another outlet's
-- bills.

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

-- The seeded cast, by the names the rest of the suite uses.
--   ...0001 owner (Super Admin)      ...0002 fa_kalyani
--   ...0004 device_kalyani           ...0006 employee_kalyani
--   ...000a biller_kalyani           ...000b biller_kanchrapara

-- ---------------------------------------------------------------------------
-- 1. Normalization. THE SAME TABLE OF CASES as src/lib/phone.test.ts, because
-- the client and the database are two implementations of one rule and a
-- disagreement between them is a customer split in two.

select is(public.normalize_indian_phone('9876543210'), '+919876543210',
  'bare ten digits');
select is(public.normalize_indian_phone('98765 43210'), '+919876543210',
  'the way it is read out loud');
select is(public.normalize_indian_phone('98765-43210'), '+919876543210',
  'hyphenated');
select is(public.normalize_indian_phone('919876543210'), '+919876543210',
  'country code, no plus');
select is(public.normalize_indian_phone('+919876543210'), '+919876543210',
  'already canonical');
select is(public.normalize_indian_phone('+91-98765-43210'), '+919876543210',
  'plus, country code and separators');
select is(public.normalize_indian_phone('+91 (98765) 43210'), '+919876543210',
  'brackets');
select is(public.normalize_indian_phone('  9876543210  '), '+919876543210',
  'surrounding whitespace');
select is(public.normalize_indian_phone('98765.43210'), '+919876543210',
  'dots');
select is(public.normalize_indian_phone('+91' || chr(160) || '9876543210'), '+919876543210',
  'a non-breaking space from a paste');

select is(public.normalize_indian_phone(null), null, 'null');
select is(public.normalize_indian_phone(''), null, 'nothing typed');
select is(public.normalize_indian_phone('98765'), null, 'half a number');
select is(public.normalize_indian_phone('987654321'), null, 'nine digits');
select is(public.normalize_indian_phone('98765432101'), null, 'eleven digits');
select is(public.normalize_indian_phone('1234567890'), null, 'does not start 6-9');
select is(public.normalize_indian_phone('5876543210'), null, 'landline-shaped');
select is(public.normalize_indian_phone('09876543210'), null,
  'a leading zero trunk prefix, deliberately refused');
select is(public.normalize_indian_phone('+449876543210'), null, 'another country');
select is(public.normalize_indian_phone('+91987654321a'), null, 'a letter');
select is(public.normalize_indian_phone('abcdefghij'), null, 'not a number at all');

-- ---------------------------------------------------------------------------
-- 2. The column is the identity, and the database enforces it rather than
-- trusting whoever wrote the insert.

select throws_ok($q$
  insert into public.customers (phone) values ('9876543210')
$q$, '23514', null, 'a non-canonical phone is refused by the check constraint');

select throws_ok($q$
  insert into public.customers (phone) values (null)
$q$, '23502', null, 'a customer without a phone has no identity and is refused');

select throws_ok($q$
  insert into public.customers (phone, name) values ('+919000000009', '   ')
$q$, '23514', null, 'a whitespace-only name is not a name');

select throws_ok($q$
  insert into public.customers (id, phone) values
    (gen_random_uuid(), '+919000000001')
$q$, '23505', null, 'one phone cannot become two customers');

-- The old shape is gone, not merely unused: an outlet column would make this
-- table outlet-scoped again in the eyes of every catalog-driven sweep.
select hasnt_column('public', 'customers', 'outlet_id',
  'customers no longer belongs to an outlet');
select hasnt_column('public', 'customers', 'bill_count',
  'no cached bill count to leak one outlet''s activity to another');
select hasnt_column('public', 'customers', 'total_spend_paise',
  'no cached spend, for the same reason');

-- The merge in this change's migration is the only statement in the schema that
-- has ever had to lift `bills_append_only`, and it puts it straight back. This
-- is the assertion that says so out loud: a migration that disabled it and
-- forgot would otherwise leave settled bills editable, and every other test in
-- this repo would keep passing.
select is(
  (select tgenabled::text from pg_trigger
    where tgrelid = 'public.bills'::regclass and tgname = 'bills_append_only'),
  'O',
  'bills are append-only again after the customer merge lifted the trigger');

-- ---------------------------------------------------------------------------
-- 3. The seeded customer really is one identity across two outlets. If this
-- fails, every isolation assertion below is testing nothing.

select is(
  (select count(distinct b.outlet_id) from public.bills b
    where b.customer_id = '80000000-0000-4000-a000-000000000001'),
  2::bigint,
  'one seeded customer has bills at BOTH outlets — the case this change exists for');

-- ---------------------------------------------------------------------------
-- 4. Nobody reads the table. Not the manager, not the biller, not the device,
-- not the employee — and not the owner either, whose access is section 7's
-- separate function rather than a grant.

create function pg_temp.direct_select_refused(p_sub uuid)
returns boolean language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.impersonate(p_sub);
  execute 'select count(*) from public.customers' into n;
  execute 'reset role';
  return false;  -- reaching here at all means the read succeeded
exception when insufficient_privilege then
  execute 'reset role';
  return true;
end;
$$;

select ok(pg_temp.direct_select_refused('10000000-0000-4000-a000-000000000002'),
  'fa_kalyani hand-crafting a direct SELECT is refused the customer table');
select ok(pg_temp.direct_select_refused('10000000-0000-4000-a000-00000000000a'),
  'biller_kalyani is refused the customer table');
select ok(pg_temp.direct_select_refused('10000000-0000-4000-a000-000000000004'),
  'device_kalyani is refused the customer table');
select ok(pg_temp.direct_select_refused('10000000-0000-4000-a000-000000000006'),
  'employee_kalyani is refused the customer table');
select ok(pg_temp.direct_select_refused('10000000-0000-4000-a000-000000000001'),
  'even the owner has no table grant — the directory is a function, not a table');

-- ---------------------------------------------------------------------------
-- 5. The billing path: exact, complete, and three columns wide.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a'::uuid);

select is(
  (select count(*) from public.customer_lookup_by_phone('98765 43210')),
  0::bigint,
  'a complete phone nobody has used returns nothing rather than an error');

select is(
  (select c.name from public.customer_lookup_by_phone('9000000001') c),
  'Test Customer (Synthetic)',
  'a returning customer is found from the phone typed without a country code');

select is(
  (select c.id from public.customer_lookup_by_phone('+91-90000-00001') c),
  '80000000-0000-4000-a000-000000000001'::uuid,
  'and from every other way of writing the same number');

-- The whole disclosure is the return type. No outlet, no bill, no spend, no
-- visit count, no timestamp — checked against the catalog so that adding a
-- column to the function fails here rather than in a code review nobody ran.
select is(
  (select string_agg(p.proargnames[i], ',' order by i)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace,
          generate_subscripts(p.proargnames, 1) i
    where n.nspname = 'public' and p.proname = 'customer_lookup_by_phone'
      and p.proargmodes[i] = 't'),
  'id,phone,name',
  'the lookup returns exactly id, phone and name');

select throws_ok($q$
  select * from public.customer_lookup_by_phone('98765')
$q$, '22023', null, 'an incomplete number is refused rather than matched loosely');

select throws_ok($q$
  select * from public.customer_lookup_by_phone('9876%')
$q$, '22023', null, 'a wildcard is not a phone number');

select throws_ok($q$
  select * from public.customer_lookup_by_phone('')
$q$, '22023', null, 'and neither is nothing at all');

-- There is no listing function to call. The strongest form of "cannot
-- enumerate" is that the verb does not exist.
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname ~ 'customer'
      and p.proname not in ('customer_lookup_by_phone', 'customer_create_or_get',
                            'customer_directory', 'customer_lookup_exceeded',
                            'record_customer_lookup', 'app_may_look_up_customer')),
  0::bigint,
  'no customer search, list, count or prefix function exists to be called');

reset role;

-- ---------------------------------------------------------------------------
-- 6. Create-or-get: creates once, and never rewrites what it finds.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a'::uuid);

select is(
  (select c.phone from public.customer_create_or_get('98765 43210', 'Brand New') c),
  '+919876543210',
  'a phone nobody has used creates one global customer');

select is(
  (select count(*) from public.customer_lookup_by_phone('9876543210')),
  1::bigint,
  'and exactly one');

-- The same phone reached from the other outlet's counter. One row, one id:
-- this is the whole point of the change, asserted rather than assumed.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000b'::uuid);

select is(
  (select c.id from public.customer_create_or_get('+91 98765 43210', 'Someone Else') c),
  (select c.id from public.customer_lookup_by_phone('9876543210') c),
  'the other outlet''s biller reaches the SAME customer, not a second one');

select is(
  (select c.name from public.customer_lookup_by_phone('9876543210') c),
  'Brand New',
  'and a differing form name does NOT overwrite the saved profile');

-- Second use of an existing phone is still one row.
select is(
  (select count(*) from public.customer_create_or_get('9876543210')),
  1::bigint,
  'reusing a phone returns the existing customer rather than creating another');

select throws_ok($q$
  select * from public.customer_create_or_get('98765', 'Half A Number')
$q$, '22023', null, 'an incomplete phone creates nothing');

reset role;

select is(
  (select count(*) from public.customers where phone = '+919876543210'),
  1::bigint,
  'after all of that, the database owner still sees exactly one such row');

-- ---------------------------------------------------------------------------
-- 7. Who may ask at all.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);
select throws_ok($q$
  select * from public.customer_lookup_by_phone('9000000001')
$q$, '42501', null, 'a Franchise Admin has no billing lookup');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);
select throws_ok($q$
  select * from public.customer_lookup_by_phone('9000000001')
$q$, '42501', null, 'nor does an Employee');

select throws_ok($q$
  select * from public.customer_create_or_get('9000000003', 'Invented')
$q$, '42501', null, 'and an Employee cannot create a customer either');

-- A revoked tablet keeps a valid session until its token expires. `app_device_ok`
-- is what makes revocation immediate, and the lookup must honour it.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000009'::uuid);
select throws_ok($q$
  select * from public.customer_lookup_by_phone('9000000001')
$q$, '42501', null, 'a revoked device is refused the moment it is revoked');

reset role;

-- ---------------------------------------------------------------------------
-- 8. The owner's directory is a separate door with a separate lock.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select ok(
  (select count(*) from public.customer_directory()) >= 2,
  'the owner reads the global directory');

reset role;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);
select throws_ok($q$ select * from public.customer_directory() $q$,
  '42501', null, 'a Franchise Admin calling the owner path is refused');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a'::uuid);
select throws_ok($q$ select * from public.customer_directory() $q$,
  '42501', null, 'a Biller calling the owner path is refused');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);
select throws_ok($q$ select * from public.customer_directory() $q$,
  '42501', null, 'a counter device calling the owner path is refused');

reset role;

-- ---------------------------------------------------------------------------
-- 9. THE ONE THAT MATTERS. Holding a global customer id must widen nothing.
--
-- The Kalyani manager can legitimately learn this customer's id — it is on a
-- bill they are entitled to read. The question is what else that id opens, and
-- the answer has to be nothing.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select is(
  (select count(*) from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  1::bigint,
  'fa_kalyani reads only the Kalyani bill of a customer who has two');

select is(
  (select count(*) from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001'
      and outlet_id = '00000000-0000-4000-a000-000000000002'),
  0::bigint,
  'naming the other outlet explicitly returns nothing, not even a count');

select is(
  (select count(*) from public.bill_items bi
     join public.bills b on b.id = bi.bill_id
    where b.customer_id = '80000000-0000-4000-a000-000000000001'
      and b.outlet_id = '00000000-0000-4000-a000-000000000002'),
  0::bigint,
  'and the line items of that bill are just as unreachable');

reset role;

-- The device at Kanchrapara, same question from the other side.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005'::uuid);

select is(
  (select count(*) from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001'
      and outlet_id = '00000000-0000-4000-a000-000000000001'),
  0::bigint,
  'the Kanchrapara device cannot read the Kalyani bill of the customer it shares');

reset role;

-- ---------------------------------------------------------------------------
-- 10. The rate bound exists and is spent by asking, not by matching.

-- The counter itself is internal: a caller that could ask "am I near the
-- limit?" could also measure the limit, and a caller that could WRITE to it
-- could exhaust somebody else's budget. Both are refused outright.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a'::uuid);

select throws_ok($q$
  select public.customer_lookup_exceeded('10000000-0000-4000-a000-00000000000a')
$q$, '42501', null, 'a billing session cannot interrogate the rate counter');

select throws_ok($q$
  select public.record_customer_lookup('10000000-0000-4000-a000-000000000004')
$q$, '42501', null, 'nor spend another caller''s budget for them');

reset role;

-- Asked as the database owner, which is the only principal that may.
select ok(
  not public.customer_lookup_exceeded('10000000-0000-4000-a000-00000000000a'),
  'a counter that has asked a handful of times is nowhere near the bound');

-- Simulated pressure rather than 120 real calls: the question is whether the
-- guard reads the window, and a loop of real lookups would test the loop.
select ok(
  public.customer_lookup_exceeded('10000000-0000-4000-a000-00000000000a',
                                  interval '15 minutes', 1, 2000),
  'a caller past its per-caller allowance is refused');

select ok(
  public.customer_lookup_exceeded('10000000-0000-4000-a000-00000000000a',
                                  interval '15 minutes', 120, 1),
  'and the endpoint has a global ceiling of its own');

-- An attempt was recorded for every lookup above, and it says who asked and
-- when — never what was asked.
select ok(
  (select count(*) from public.customer_lookup_attempts
    where caller_id = '10000000-0000-4000-a000-00000000000a') >= 1,
  'lookups are counted against the caller who made them');

select * from finish();
rollback;
