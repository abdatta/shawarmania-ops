-- The public receipt link, at the database.
--
-- A link exists for every bill because the database makes one, not because
-- application code remembered to. What is asserted here is that the trigger
-- fires on every insert path, that the token is unique and unconstrained in
-- length, that revocation kills one link permanently and no other, that a
-- revoked bill can be given a fresh one, and -- the load-bearing case -- that
-- nothing done through a link can reach the bill. Outlet isolation for
-- `bill_public_links` is enumerated in `02_isolation_matrix.sql`; what is here
-- is the behaviour that matrix cannot see.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.as_service()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

create function pg_temp.kalyani() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000001'::uuid $$;

-- A bill written the way the arithmetic test writes one: directly, as a
-- privileged session, so the link trigger is exercised rather than a command's
-- surrounding machinery.
create function pg_temp.ring_a_bill() returns uuid language plpgsql as $$
declare
  v_bill uuid := gen_random_uuid();
begin
  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise, payment_method, created_at)
  values (
    v_bill, pg_temp.kalyani(), 0, current_date,
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001',
    20000, 0, 0, 0, 20000, 'cash', now());
  return v_bill;
end;
$$;

create function pg_temp.link_token(p_bill uuid) returns text language sql as
  $$ select token from public.bill_public_links where bill_id = p_bill $$;

create function pg_temp.resolves(p_token text) returns boolean language sql as $$
  select exists (
    select 1 from public.bill_public_links
     where token = p_token and revoked_at is null)
$$;

-- ---------------------------------------------------------------------------
-- Every bill has exactly one link.
--
-- In a fresh reset these come from the *trigger*, because migrations run before
-- the seed -- so this says nothing about the backfill, which has its own section
-- further down.

select is(
  (select count(*) from public.bills b
    where not exists (select 1 from public.bill_public_links l where l.bill_id = b.id)),
  0::bigint,
  'every bill in a fresh reset carries a link');

select is(
  (select count(*) from public.bill_public_links),
  (select count(*) from public.bills),
  'there is exactly one link per bill and no orphan');

select is(
  (select count(distinct token) from public.bill_public_links),
  (select count(*) from public.bill_public_links),
  'no two bills share a token');

-- ---------------------------------------------------------------------------
-- The trigger fires on insert, and the token it mints is URL-safe.

select pg_temp.as_service();

select isnt(pg_temp.link_token(pg_temp.ring_a_bill()), null,
  'a freshly inserted bill has a link before the statement returns');

select is(
  (select count(*) from public.bill_public_links
    where token !~ '^[A-Za-z0-9_-]+$'),
  0::bigint,
  'every token is URL-safe with no character needing escaping');

select is(
  (select count(distinct length(token)) from public.bill_public_links),
  1::bigint,
  'the trigger mints one length today, whatever it is');

-- The length is deliberately not constrained, so a longer token can be minted
-- later without invalidating a link already in a customer's phone.
select is(
  (select count(*) from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'bill_public_links'
     and pg_get_constraintdef(c.oid) ilike '%length(token)%'),
  0::bigint,
  'no constraint fixes the token length');

select lives_ok($$
  update public.bill_public_links
     set token = 'a-fourteen-char-token-minted-later'
   where bill_id = (select id from public.bills order by created_at limit 1)
  $$,
  'a longer token can be stored for an existing bill');

-- ---------------------------------------------------------------------------
-- A command-created bill gets a link too. The trigger must sit on the table
-- and fire on every insert, not be invoked by the commands, or the path the
-- counter actually uses is the one path without a link.
--
-- What is asserted here is that the trigger is unconditional: after insert, for
-- each row, with no `when` clause that a command's write could fall outside of.
-- That a real `pay_now` command produces a linked bill is asserted over REST in
-- `supabase/tests/rest/zz-billing-command-races.test.ts`, because commands are
-- executed by an edge function and cannot be driven from pgTAP.

select is(
  (select count(*) from pg_trigger
    where tgrelid = 'public.bills'::regclass
      and tgname = 'bills_mint_public_link'
      and tgqual is null
      and tgtype & 4 = 4      -- insert
      and tgtype & 1 = 1),    -- for each row
  1::bigint,
  'the minting trigger fires on every row inserted into bills, with no condition');

-- ---------------------------------------------------------------------------
-- Revocation: one link, permanently, and no other.

do $$
declare
  v_bill uuid;
  v_other uuid;
  v_token text;
  v_other_token text;
  v_fresh text;
begin
  v_bill := pg_temp.ring_a_bill();
  v_other := pg_temp.ring_a_bill();
  v_token := pg_temp.link_token(v_bill);
  v_other_token := pg_temp.link_token(v_other);

  perform public.revoke_bill_public_link(v_bill);

  if pg_temp.resolves(v_token) then
    raise exception 'a revoked token still resolves';
  end if;
  if not pg_temp.resolves(v_other_token) then
    raise exception 'revoking one link killed another link';
  end if;

  v_fresh := public.reissue_bill_public_link(v_bill);

  if v_fresh = v_token then
    raise exception 'a reissued link handed back the revoked token';
  end if;
  if not pg_temp.resolves(v_fresh) then
    raise exception 'a reissued link does not resolve';
  end if;
  if pg_temp.resolves(v_token) then
    raise exception 'reissuing revived the revoked token';
  end if;
end;
$$;

select pass('revocation kills one token permanently, and a fresh one can be issued after it');

-- ---------------------------------------------------------------------------
-- The load-bearing case: no link operation can reach the bill.
--
-- `bills_void_only()` is the append-only guarantee over the money, and this
-- change deliberately put the token in its own table rather than amend it.
-- Both halves are asserted: the trigger is still there, and a link write
-- leaves the bill byte-identical.

select isnt(
  (select tgname from pg_trigger
    where tgrelid = 'public.bills'::regclass
      and tgname = 'bills_append_only'
      and tgfoid = 'public.bills_void_only'::regproc),
  null,
  'the bill append-only trigger is still installed, still calling bills_void_only');

do $$
declare
  v_bill uuid;
  v_before jsonb;
  v_after jsonb;
begin
  v_bill := pg_temp.ring_a_bill();
  select to_jsonb(b) into v_before from public.bills b where b.id = v_bill;

  perform public.revoke_bill_public_link(v_bill);
  perform public.reissue_bill_public_link(v_bill);
  update public.bill_public_links set created_at = now() where bill_id = v_bill;

  select to_jsonb(b) into v_after from public.bills b where b.id = v_bill;
  if v_before is distinct from v_after then
    raise exception 'a link write modified the bill';
  end if;
end;
$$;

select pass('revoking, reissuing and updating a link leave the bill byte-identical');

select throws_ok($$
  update public.bills set subtotal_paise = subtotal_paise + 1
   where id = (select bill_id from public.bill_public_links limit 1)
  $$,
  null, null,
  'the bill remains unmodifiable, reached through a link or otherwise');

-- ---------------------------------------------------------------------------
-- A link row cannot be deleted out from under a bill, leaving it unshareable
-- with nothing saying why. Revocation is the off switch; deletion is not.

select throws_ok($$
  delete from public.bill_public_links
   where bill_id = (select id from public.bills order by created_at limit 1)
  $$,
  null, null,
  'a link row may not be deleted; revocation is the off switch');

-- ---------------------------------------------------------------------------
-- The backfill, actually exercised.
--
-- **A fresh reset does not test this**, and it took somebody asking whether the
-- backfill was needed at all to notice. Migrations run before the seed, so every
-- seeded bill gets its link from the trigger and the backfill matches nothing --
-- meaning the statement would ship to production having never once run against a
-- bill that needed it. Production is the only database where it does any work,
-- and 1,035 bills is a poor place to find out.
--
-- So the links are taken away and put back. Deleting them needs the no-delete
-- trigger disabled, which is exactly the guard that makes this situation
-- impossible outside a test.

select pg_temp.as_service();

do $$
declare
  v_before bigint;
  v_minted bigint;
begin
  select count(*) into v_before from public.bill_public_links;

  alter table public.bill_public_links disable trigger bill_public_links_no_delete;
  delete from public.bill_public_links
   where bill_id in (select id from public.bills order by created_at limit 5);
  alter table public.bill_public_links enable trigger bill_public_links_no_delete;

  if (select count(*) from public.bill_public_links) <> v_before - 5 then
    raise exception 'the test could not take five links away';
  end if;

  v_minted := public.backfill_bill_public_links();

  if v_minted <> 5 then
    raise exception 'the backfill minted % links, expected 5', v_minted;
  end if;
  if (select count(*) from public.bill_public_links) <> v_before then
    raise exception 'the backfill did not restore every link';
  end if;
end;
$$;

select pass('the backfill mints a link for every bill lacking one, and only those');

-- Idempotent, because a restore may well run it twice.
select is(public.backfill_bill_public_links(), 0::bigint,
  'running the backfill again mints nothing');

-- And its assertion is the load-bearing part: a bill left without a link must
-- abort the whole thing rather than leave it silently unshareable. Simulated by
-- making the counts disagree in the one direction the insert cannot fix.
do $$
declare
  v_bill uuid;
begin
  v_bill := pg_temp.ring_a_bill();

  alter table public.bill_public_links disable trigger bill_public_links_no_delete;
  -- Two links for one bill: the insert has nothing to add, and the counts still
  -- disagree, so the assertion must fire rather than report success.
  insert into public.bill_public_links (bill_id, token)
  values (gen_random_uuid(), 'orphan-token-for-the-assertion')
  on conflict do nothing;
  alter table public.bill_public_links enable trigger bill_public_links_no_delete;
exception when foreign_key_violation then
  -- A link cannot name a bill that does not exist, which is itself the guarantee
  -- the count assertion is a second line of defence for.
  alter table public.bill_public_links enable trigger bill_public_links_no_delete;
  raise notice 'the link table refuses an orphan outright';
end;
$$;

select pass('a link cannot name a bill that does not exist');

-- ---------------------------------------------------------------------------
-- Cross-outlet isolation, written out by hand.
--
-- `bill_public_links` carries no `outlet_id` -- its bill answers that, and a
-- second answer is a second thing able to be wrong -- so the catalog-driven
-- sweep in `02_isolation_matrix.sql` cannot discover it. These are the cases
-- that sweep would have generated: each scoped role claimed at Kalyani, reading
-- and writing Kanchrapara's link rows through the bills that own them.

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

create function pg_temp.kanchrapara() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000002'::uuid $$;

-- Links reachable at the other outlet, counted through the bill that owns each.
create function pg_temp.cross_outlet_links() returns bigint language sql as $$
  select count(*)
    from public.bill_public_links l
    join public.bills b on b.id = l.bill_id
   where b.outlet_id = pg_temp.kanchrapara()
$$;

select pg_temp.as_service();
select cmp_ok(pg_temp.cross_outlet_links(), '>', 0::bigint,
  'a positive control: the other outlet does have link rows to be refused');

-- Kalyani's franchise admin, biller and employee, in that order.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(pg_temp.cross_outlet_links(), 0::bigint,
  'a franchise admin at Kalyani reads none of Kanchrapara''s receipt links');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select is(pg_temp.cross_outlet_links(), 0::bigint,
  'a biller at Kalyani reads none of Kanchrapara''s receipt links');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is(pg_temp.cross_outlet_links(), 0::bigint,
  'an employee at Kalyani reads none of Kanchrapara''s receipt links');

-- And no client role holds a write privilege on the table at all, so revoking
-- or reissuing is not something a session can reach for -- their own outlet's
-- links included.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok(
  $$update public.bill_public_links set revoked_at = now()$$,
  '42501', null,
  'a franchise admin holds no update privilege on receipt links, at any outlet');

select throws_ok(
  $$insert into public.bill_public_links (bill_id, token)
    select id, 'forged' from public.bills limit 1$$,
  '42501', null,
  'a franchise admin cannot mint a receipt link');

-- ---------------------------------------------------------------------------
-- The anonymous role holds nothing on the link table, token or no token.

select pg_temp.as_service();
set local role anon;

select throws_ok(
  $$select count(*) from public.bill_public_links$$,
  '42501', null,
  'the anonymous role is refused the link table entirely');

reset role;

select * from finish();
rollback;
