-- a-gold-member-is-a-label (#57).
--
-- Four things this file has to prove, and each fails differently:
--
--   * membership is a history of spells, ended and never deleted — a flag would
--     pass most of what follows and forget how it got there;
--   * the tier on an order and a bill is what was true at the moment of sale,
--     and stays true after a revocation — a live join would pass on day one;
--   * the counter learns gold-or-not and nothing more — the widening is one
--     column, and a second one would be the next leak;
--   * the management path reaches exactly the customers the reader may know,
--     and a manager changes exactly those no other outlet serves.

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

-- The server itself: no role, and no session identity left over from the last
-- impersonation, which `reset role` alone would keep.
create function pg_temp.as_server()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

--   ...0001 owner         ...0002 fa_kalyani      ...0003 fa_kanchrapara
--   ...0004 device_kalyani (live shift 90000000-…0001)
--   ...0005 device_kanchrapara (live shift 90000000-…0002)
--   ...000a biller_kalyani ...0006 employee_kalyani
--   80000000-…0001 +919000000001 'Test Customer (Synthetic)' — bills at BOTH outlets
--   80000000-…0002 +919000000002 no name, no bills

create function pg_temp.order_payload(
  p_order_id uuid, p_line_id uuid, p_item uuid, p_phone text, p_name text)
returns jsonb language sql volatile as $$
  select jsonb_build_object(
    'orderId', p_order_id,
    'businessDate', public.app_business_date(now(), time '04:00'),
    'customerId', null,
    'customerName', p_name,
    'customerPhone', p_phone,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0,
    'totalPaise', 13900, 'pricingMode', 'no_tax',
    'roundingPaise', 0, 'discounts', '[]'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'id', p_line_id, 'menuItemId', p_item,
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)));
$$;

-- Ring an order as whichever device is impersonated, on that device's shift.
create function pg_temp.ring(
  p_command uuid, p_order uuid, p_line uuid, p_shift uuid, p_item uuid,
  p_phone text, p_name text)
returns text language sql volatile as $$
  select public.create_billing_order(
    p_command, 2,
    public.billing_payload_hash(pg_temp.order_payload(p_order, p_line, p_item, p_phone, p_name)),
    now(), p_shift,
    pg_temp.order_payload(p_order, p_line, p_item, p_phone, p_name)
  ) ->> 'status';
$$;

-- ---------------------------------------------------------------------------
-- 1. The table is the same deliberate exception `customers` is.

select has_table('public', 'customer_memberships', 'membership is a table of records');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'customer_memberships'),
  0::bigint,
  'the membership table carries no policy');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.customer_memberships'::regclass),
  'and has row-level security switched on, so an accidental grant still reads nothing');

select ok(
  not has_table_privilege('authenticated', 'public.customer_memberships', 'SELECT')
  and not has_table_privilege('authenticated', 'public.customer_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.customer_memberships', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.customer_memberships', 'DELETE'),
  'no client session holds any privilege on the membership table');

-- The internal pieces take a scope as an argument. A client that could call
-- them could name a scope it does not hold.
select ok(
  not has_function_privilege('authenticated', f, 'execute'),
  format('%s is not a client surface', f))
  from unnest(array[
    'public.customer_tier_at(uuid,timestamptz)',
    'public.customer_is_member(uuid)',
    'public.customer_directory_reach(uuid[])',
    'public.customer_directory_activity(uuid[])',
    'public.customer_directory_may_edit(uuid,uuid[])',
    'public.customer_directory_require_editable(uuid)',
    'public.app_customer_directory_outlets()'
  ]) f;

-- The unpaged owner read is gone rather than left beside its replacement.
select hasnt_function('public', 'customer_directory', array[]::text[],
  'the unpaged directory read no longer exists');

-- ---------------------------------------------------------------------------
-- 2. The counter learns one more fact, and only one.

select is(
  (select array_agg(a order by n) from unnest(
     (select proargnames from pg_proc where oid = 'public.customer_lookup_by_phone(text)'::regprocedure)
   ) with ordinality as t(a, n)),
  array['p_phone', 'id', 'phone', 'name', 'is_member'],
  'the exact lookup returns id, phone, name and gold-or-not, and nothing else');

select is(
  (select array_agg(a order by n) from unnest(
     (select proargnames from pg_proc where oid = 'public.customer_suggest_at_outlet(text)'::regprocedure)
   ) with ordinality as t(a, n)),
  array['p_partial', 'id', 'phone', 'name', 'other_matches', 'is_member'],
  'the outlet-scoped suggestion gains gold-or-not and nothing else');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select is(
  (select is_member from public.customer_lookup_by_phone('9000000001')),
  false,
  'a customer nobody has made gold reads as not a member at the counter');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Membership is a history: granted, ended, granted again, never deleted.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

select is(
  (select member_since is not null
     from public.customer_membership_grant('80000000-0000-4000-a000-000000000001')),
  true,
  'the owner makes a customer gold');

select is(
  (select count(*) from public.customer_membership_grant('80000000-0000-4000-a000-000000000001')),
  1::bigint,
  'a second tap answers with the card');

reset role;
select is(
  (select count(*) from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  1::bigint,
  'and writes no second spell');
select is(
  (select granted_by from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  '10000000-0000-4000-a000-000000000001'::uuid,
  'the grant records who made it');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select is(
  (select is_member from public.customer_lookup_by_phone('9000000001')),
  true,
  'the counter now reads them as gold');
reset role;

-- A sale rung now carries it.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.ring('a1000000-0000-4000-a000-000000000571', 'a2000000-0000-4000-a000-000000000571',
    'a3000000-0000-4000-a000-000000000571', '90000000-0000-4000-a000-000000000001',
    '31000000-0000-4000-a000-000000000001', '9000000001', 'Test Customer (Synthetic)'),
  'accepted',
  'an order is rung for the member');
reset role;

select is(
  (select customer_tier from public.orders where id = 'a2000000-0000-4000-a000-000000000571'),
  'gold'::public.customer_tier,
  'the order snapshots gold, set by the server from the history');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select member_since from public.customer_membership_revoke('80000000-0000-4000-a000-000000000001')),
  null,
  'the owner takes gold back');
reset role;

select is(
  (select count(*) from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  1::bigint,
  'the revocation ends the spell and keeps it');
select ok(
  (select revoked_at is not null and revoked_by = '10000000-0000-4000-a000-000000000001'
     from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  'with who ended it and when');

-- THE snapshot assertion. A live join passes everything above and fails here.
select is(
  (select customer_tier from public.orders where id = 'a2000000-0000-4000-a000-000000000571'),
  'gold'::public.customer_tier,
  'an order rung for a member still reads as a member''s after the revocation');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select set_config('test.regranted_since',
  (select member_since::text
     from public.customer_membership_grant('80000000-0000-4000-a000-000000000001')),
  true);
reset role;

select is(
  (select count(*) from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001'),
  2::bigint,
  'a re-grant is a new spell, and the earlier one is still recorded');

-- Every `now()` in one transaction is the same instant, so "newer" cannot be
-- seen here; what can is WHICH spell the card reads from — the one in force.
select is(
  current_setting('test.regranted_since')::timestamptz,
  (select granted_at from public.customer_memberships
    where customer_id = '80000000-0000-4000-a000-000000000001' and revoked_at is null),
  'the card reads "member since" from the spell in force, not the first one');

-- The guard, as the server itself: even the service role may not rewrite
-- history or delete it.
select throws_ok($q$
  delete from public.customer_memberships
   where customer_id = '80000000-0000-4000-a000-000000000001'
$q$, 'P0001', 'a membership is ended, never deleted', 'a spell cannot be deleted');

select throws_ok($q$
  update public.customer_memberships set granted_at = now() - interval '1 year'
   where customer_id = '80000000-0000-4000-a000-000000000001' and revoked_at is not null
$q$, 'P0001', 'an ended membership is history and does not change',
  'an ended spell cannot be rewritten');

select throws_ok($q$
  update public.customer_memberships set granted_at = now() - interval '1 year'
   where customer_id = '80000000-0000-4000-a000-000000000001' and revoked_at is null
$q$, 'P0001', 'the only change a membership accepts is its end',
  'a spell in force accepts only its end');

-- ---------------------------------------------------------------------------
-- 4. The tier is the history at the moment of sale — for a bill too.

-- A direct bill, written as the server writes one, at two instants either side
-- of a spell that began ten minutes ago.
select pg_temp.as_server();
insert into public.customers (id, phone, name)
values ('80000000-0000-4000-a000-000000000591', '+919000000591', 'Instant Test');
insert into public.customer_memberships (customer_id, granted_at, granted_by)
values ('80000000-0000-4000-a000-000000000591', now() - interval '10 minutes',
        '10000000-0000-4000-a000-000000000001');

select is(
  public.customer_tier_at('80000000-0000-4000-a000-000000000591', now() - interval '20 minutes'),
  null,
  'before the grant, the history says not a member');
select is(
  public.customer_tier_at('80000000-0000-4000-a000-000000000591', now()),
  'gold'::public.customer_tier,
  'after it, gold');

-- A bill settling an order takes the order's tier, whatever the history says
-- now: the kitchen and the receipt agree.
select pg_temp.as_server();
insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id, shift_id,
   order_id, customer_id, customer_name, customer_phone,
   subtotal_paise, discount_paise, total_paise, payment_method, status, created_at)
select 'b5000000-0000-4000-a000-000000000591', o.outlet_id,
       public.app_business_date(now(), time '04:00'),
       '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
       '40000000-0000-4000-a000-000000000002',
       o.id, o.customer_id, o.customer_name, o.customer_phone,
       13900, 0, 13900, 'cash', 'settled', now()
  from public.orders o where o.id = 'a2000000-0000-4000-a000-000000000571';

select is(
  (select customer_tier from public.bills where id = 'b5000000-0000-4000-a000-000000000591'),
  'gold'::public.customer_tier,
  'a bill settling an order carries the order''s tier');

-- A revision that names the same customer keeps the tier; one that names a
-- different customer takes that customer's.
select set_config('app.billing_command', '1', true);
update public.orders set customer_name = 'Renamed At The Till',
       changed_at = now(), changed_by = '10000000-0000-4000-a000-00000000000a',
       changed_shift_id = '90000000-0000-4000-a000-000000000001'
 where id = 'a2000000-0000-4000-a000-000000000571';
select is(
  (select customer_tier from public.orders where id = 'a2000000-0000-4000-a000-000000000571'),
  'gold'::public.customer_tier,
  'revising an order for the same customer keeps the tier it was rung under');

update public.orders set customer_id = '80000000-0000-4000-a000-000000000002',
       changed_at = now(), changed_by = '10000000-0000-4000-a000-00000000000a',
       changed_shift_id = '90000000-0000-4000-a000-000000000001'
 where id = 'a2000000-0000-4000-a000-000000000571';
select is(
  (select customer_tier from public.orders where id = 'a2000000-0000-4000-a000-000000000571'),
  null,
  'revising it to a different customer takes theirs');
select set_config('app.billing_command', '', true);

-- And nothing a command writes can set it: the order guard refuses a revision
-- that touches the tier, before the snapshot trigger even runs.
select set_config('app.billing_command', '1', true);
select throws_ok($q$
  update public.orders set customer_tier = 'gold'
   where id = 'a2000000-0000-4000-a000-000000000571'
$q$, 'P0001', 'revision changed immutable order facts',
  'a write naming a tier is refused');
select set_config('app.billing_command', '', true);

-- ---------------------------------------------------------------------------
-- 5. Counter roles have no management path at all.

select pg_temp.impersonate(p) from unnest(array[
  '10000000-0000-4000-a000-00000000000a'::uuid]) p;
select throws_ok($q$ select * from public.customer_directory_list('regulars', 0) $q$,
  '42501', null, 'a Biller cannot list customers');
select throws_ok($q$ select * from public.customer_directory_search('test') $q$,
  '42501', null, 'a Biller cannot search customers');
select throws_ok($q$ select * from public.customer_directory_card('80000000-0000-4000-a000-000000000001') $q$,
  '42501', null, 'a Biller cannot open a card');
select throws_ok($q$ select * from public.customer_membership_grant('80000000-0000-4000-a000-000000000002') $q$,
  '42501', null, 'a Biller cannot grant gold');
select throws_ok($q$ select * from public.customer_rename('80000000-0000-4000-a000-000000000001', 'X') $q$,
  '42501', null, 'a Biller cannot rename a customer');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$ select * from public.customer_directory_list('members', 0) $q$,
  '42501', null, 'an Employee cannot list customers');
select throws_ok($q$ select * from public.customer_membership_revoke('80000000-0000-4000-a000-000000000001') $q$,
  '42501', null, 'an Employee cannot revoke gold');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($q$ select * from public.customer_directory_search('9000') $q$,
  '42501', null, 'a counter device cannot search customers');
select throws_ok($q$ select * from public.customer_directory_card('80000000-0000-4000-a000-000000000001') $q$,
  '42501', null, 'a counter device cannot open a card');

select throws_ok($q$ select * from public.customer_memberships $q$,
  '42501', null, 'no client reads the membership table directly');
reset role;

-- ---------------------------------------------------------------------------
-- 6. A manager's directory is their own outlets', and a shared customer is
--    read-only to them.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select is(
  (select scope from public.customer_directory_card('80000000-0000-4000-a000-000000000001')),
  'outlets',
  'a manager reads a customer their outlet served');
select is(
  (select editable from public.customer_directory_card('80000000-0000-4000-a000-000000000001')),
  false,
  'but a customer another outlet also serves is read-only to them');
select throws_ok($q$ select * from public.customer_membership_revoke('80000000-0000-4000-a000-000000000001') $q$,
  '42501', null, 'and a hand-crafted revoke of that shared customer is refused');
select throws_ok($q$ select * from public.customer_rename('80000000-0000-4000-a000-000000000001', 'Changed') $q$,
  '42501', null, 'as is a rename');

-- Somebody no outlet of theirs has served is somebody they cannot know exists.
-- 'Instant Test' (…0591) is in the directory and has never been served anywhere.
select is(
  (select count(*) from public.customer_directory_card('80000000-0000-4000-a000-000000000591')),
  0::bigint,
  'a customer no outlet of theirs has served answers as nobody');
select throws_ok($q$ select * from public.customer_membership_grant('80000000-0000-4000-a000-000000000591') $q$,
  'P0002', null, 'and a grant to them is refused exactly as a grant to nobody');
reset role;

-- A customer only Kalyani has served.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.ring('a1000000-0000-4000-a000-000000000572', 'a2000000-0000-4000-a000-000000000572',
    'a3000000-0000-4000-a000-000000000572', '90000000-0000-4000-a000-000000000001',
    '31000000-0000-4000-a000-000000000001', '9000000572', 'Kalyani Only'),
  'accepted',
  'a new customer is rung at Kalyani');
reset role;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select editable from public.customer_directory_card(
     (select customer_id from public.orders where id = 'a2000000-0000-4000-a000-000000000572'))),
  true,
  'the Kalyani manager may change a customer only Kalyani has served');
reset role;

-- Read the id as the server, and hand it to the manager's session in a setting.
select set_config('test.kalyani_only',
  (select customer_id::text from public.orders where id = 'a2000000-0000-4000-a000-000000000572'),
  true);

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select member_since is not null
     from public.customer_membership_grant(current_setting('test.kalyani_only')::uuid)),
  true,
  'and makes them gold');
select is(
  (select name from public.customer_rename(current_setting('test.kalyani_only')::uuid, '  Kalyani Regular  ')),
  'Kalyani Regular',
  'and corrects their name, trimmed');
select throws_ok($q$ select * from public.customer_rename(current_setting('test.kalyani_only')::uuid, '   ') $q$,
  '22023', null, 'but cannot erase it');
reset role;

select is(
  (select granted_by from public.customer_memberships
    where customer_id = current_setting('test.kalyani_only')::uuid),
  '10000000-0000-4000-a000-000000000002'::uuid,
  'the grant records the manager who made it');

-- The other outlet's manager cannot see them at all.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  (select count(*) from public.customer_directory_card(current_setting('test.kalyani_only')::uuid)),
  0::bigint,
  'Kanchrapara''s manager cannot open a customer only Kalyani served');
select is(
  (select count(*) from public.customer_directory_search('Kalyani Regular')),
  0::bigint,
  'nor find them by name');
select is(
  (select count(*) from public.customer_directory_list('members', 0) l
    where l.id = current_setting('test.kalyani_only')::uuid),
  0::bigint,
  'nor see them among the gold members');
reset role;

-- The customer is served at Kanchrapara for the first time. From that moment
-- the Kalyani manager may no longer change them — decided at the write, not by
-- the card they read earlier.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  pg_temp.ring('a1000000-0000-4000-a000-000000000573', 'a2000000-0000-4000-a000-000000000573',
    'a3000000-0000-4000-a000-000000000573', '90000000-0000-4000-a000-000000000002',
    '32000000-0000-4000-a000-000000000001', '9000000572', 'Kalyani Regular'),
  'accepted',
  'the same customer is rung at Kanchrapara');
reset role;

select is(
  (select customer_tier from public.orders where id = 'a2000000-0000-4000-a000-000000000573'),
  'gold'::public.customer_tier,
  'membership is business-wide: the other outlet''s order carries gold too');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$ select * from public.customer_membership_revoke(current_setting('test.kalyani_only')::uuid) $q$,
  '42501', null, 'once another outlet serves them, the Kalyani manager is refused');
reset role;

-- ---------------------------------------------------------------------------
-- 7. The figures are read from bills, one bill a visit, a void counting for
--    nothing — and a manager counts only their own outlets' bills.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select visits_30d from public.customer_directory_card('80000000-0000-4000-a000-000000000001')),
  (select count(*)::integer from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001' and status = 'settled'),
  'the owner''s visit count is the customer''s settled bills');
reset role;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select visits_30d from public.customer_directory_card('80000000-0000-4000-a000-000000000001')),
  (select count(*)::integer from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001' and status = 'settled'
      and outlet_id = '00000000-0000-4000-a000-000000000001'),
  'the Kalyani manager''s counts only Kalyani''s');
reset role;

-- A void, written as the server writes one.
select pg_temp.as_server();
update public.bills
   set status = 'void', voided_at = now(), void_reason = 'test (synthetic)',
       voided_by = '10000000-0000-4000-a000-000000000002', void_kind = 'manager_void'
 where id = '50000000-0000-4000-a000-000000000002';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select spend_30d_paise from public.customer_directory_card('80000000-0000-4000-a000-000000000001')),
  (select coalesce(sum(total_paise), 0)::bigint from public.bills
    where customer_id = '80000000-0000-4000-a000-000000000001' and status = 'settled'),
  'a voided bill counts for neither a visit nor spend');
reset role;

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'),
  array['created_at', 'id', 'last_used_at', 'name', 'phone'],
  'no visit, spend or membership column was added to the customer record');

-- ---------------------------------------------------------------------------
-- 8. Search: a name, part of a number, and nothing a caller types is a pattern.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

select is(
  (select id from public.customer_directory_search('synthetic')),
  '80000000-0000-4000-a000-000000000001'::uuid,
  'a name is found by any part of it, in any case');
select is(
  (select id from public.customer_directory_search('90000 00001')),
  '80000000-0000-4000-a000-000000000001'::uuid,
  'a number is found however it is spaced');
select is(
  (select count(*) from public.customer_directory_search('te')),
  0::bigint,
  'fewer than three characters answer nothing rather than everybody');
select is(
  (select count(*) from public.customer_directory_search('%%%')),
  0::bigint,
  'a percent sign is a percent sign, not a wildcard');
select is(
  (select id from public.customer_directory_search('tcsm')),
  '80000000-0000-4000-a000-000000000001'::uuid,
  'the same letters in order with gaps are found when nothing matches exactly');
reset role;

-- ---------------------------------------------------------------------------
-- 9. The lists page twenty at a time, nobody twice and nobody missed.

insert into public.customers (id, phone, name)
select ('80000000-0000-4000-a000-' || lpad((700 + n)::text, 12, '0'))::uuid,
       '+9198765' || lpad(n::text, 5, '0'),
       'Paged Member ' || n
  from generate_series(1, 30) n;
insert into public.customer_memberships (customer_id, granted_at, granted_by)
select ('80000000-0000-4000-a000-' || lpad((700 + n)::text, 12, '0'))::uuid,
       now() - make_interval(mins => n),
       '10000000-0000-4000-a000-000000000001'
  from generate_series(1, 30) n;

select set_config('test.members',
  (select count(*)::text from public.customer_memberships where revoked_at is null), true);

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select count(*) from public.customer_directory_list('members', 0)),
  21::bigint,
  'a full page comes back with one more row, which says there is a next page');
select is(
  (select count(distinct paged.id) from (
     select l.id from public.customer_directory_list('members', 0) l
     union all
     select l.id from public.customer_directory_list('members', 20) l
   ) paged),
  current_setting('test.members')::bigint,
  'two pages reach every member exactly once');
reset role;

-- ---------------------------------------------------------------------------
-- 10. The snapshot columns open nothing across outlets.
--
-- `customer_tier` sits on outlet-scoped rows and inherits their policies. Asking
-- for every gold order and bill as Kanchrapara's manager must return only
-- Kanchrapara's — never the Kalyani member's order rung in section 3.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  (select count(*) from public.orders
    where customer_tier = 'gold' and outlet_id <> '00000000-0000-4000-a000-000000000002'),
  0::bigint,
  'a neighbouring outlet reads no gold order that is not its own');
select is(
  (select count(*) from public.bills
    where customer_tier = 'gold' and outlet_id <> '00000000-0000-4000-a000-000000000002'),
  0::bigint,
  'nor any gold bill that is not its own');
select ok(
  (select count(*) from public.orders where customer_tier = 'gold') >= 1,
  'while its own gold order is there to read');
reset role;

select * from finish();
rollback;
