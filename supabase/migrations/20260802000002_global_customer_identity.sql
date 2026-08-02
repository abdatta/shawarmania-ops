-- global-customer-identity: one phone, one customer, across the whole business.
--
-- `customers` was outlet-scoped from #2, with outlet-local spend aggregates and
-- a `(outlet_id, phone)` unique index — the same person at both shops was two
-- records, recorded as a known limitation. The owner has now chosen one global
-- identity per normalized phone, so a returning customer is recognised at
-- either counter.
--
-- The dangerous part is not the merge; it is what a global table does to
-- tenancy. A directory readable by an outlet role is a business-wide PII list
-- one `select *` away from any manager's token. So the exception is drawn as
-- narrowly as it can be drawn:
--
--   * no outlet role and no device holds ANY privilege on the table — not
--     select, not insert. The grant is revoked, and RLS with no policy says the
--     same thing a second time.
--   * the only billing path in is an exact, complete, canonical phone through a
--     security-definer function that returns three columns and rate-limits the
--     caller. There is no prefix, no wildcard, no list, no count.
--   * the Super Admin's directory read is a SEPARATE function with a separate
--     authority check, so widening the owner's path can never widen billing's.
--   * bills stay outlet-scoped and untouched. Holding a customer id proves
--     nothing about which bills you may read.
--
-- Read read-only against production on 2026-08-02 before writing this:
--
--   customers ...................................  0 rows
--   bills carrying a customer_id ................  0
--
-- Nothing to merge, so the merge below runs against synthetic data only. It is
-- nevertheless written to carry real rows, per the precedent set by #21 and
-- #22, and it ABORTS rather than guessing if it ever meets an ambiguity.
--
-- Rollback is safe only while no global identity has been written. Afterwards,
-- reverting means rebuilding outlet-local rows from each outlet's bills and
-- deliberately discarding business-wide identity; prefer forward repair.

-- ---------------------------------------------------------------------------
-- 1. Canonical phone.
--
-- One function, used by the constraint, the lookup, the create path, the
-- migration below and the TypeScript mirror in src/domain/phone.ts. Immutable
-- because a check constraint may only call an immutable function — which is
-- also the honest description: the same input has always the same canonical
-- form.
--
-- Deliberately strict. Three accepted shapes — ten digits, `91` + ten, `+91` +
-- ten — with spaces, hyphens, brackets and dots allowed anywhere as
-- presentation. A leading zero trunk prefix is NOT accepted: refusing an
-- unusual input costs one retype, while a wrong normalization would merge two
-- strangers into one identity. Anything unrecognised returns null, and null is
-- the signal for "this matches and creates nothing".

create or replace function public.normalize_indian_phone(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  with stripped as (
    select translate(coalesce(p_input, ''), ' -().' || chr(9) || chr(160), '') as s
  )
  select case
    when s ~ '^\+91[6-9][0-9]{9}$' then '+91' || right(s, 10)
    when s ~ '^91[6-9][0-9]{9}$'   then '+91' || right(s, 10)
    when s ~ '^[6-9][0-9]{9}$'     then '+91' || s
    else null
  end
  from stripped
$$;

comment on function public.normalize_indian_phone(text) is
  'Canonical +91XXXXXXXXXX form of an Indian mobile, or null if the input is not one.';

-- ---------------------------------------------------------------------------
-- 2. Preflight, in the migration itself.
--
-- The read-only rehearsal lives in scripts/preflight-customer-migration.mjs and
-- is what an operator runs against production first. This block is the same
-- question asked again at the only moment that counts — inside the transaction
-- that is about to change the table — because a rehearsal is a photograph and
-- this is the shutter.
--
-- Counts only. A migration log is a place phone numbers must never appear.

do $$
declare
  v_invalid bigint;
  v_conflicts bigint;
begin
  select count(*) into v_invalid
    from public.customers
   where public.normalize_indian_phone(phone) is null;

  if v_invalid > 0 then
    raise exception
      'customer migration halted: % row(s) carry a phone that is missing or not a recognisable Indian mobile. Repair or remove them first.',
      v_invalid
      using errcode = 'check_violation';
  end if;

  -- Rows that normalize to one phone may merge only when their nonblank names
  -- agree. Two different names on one number is a question about who this
  -- person is, and a migration is the worst possible place to answer it.
  select count(*) into v_conflicts
    from (
      select public.normalize_indian_phone(phone) as canonical
        from public.customers
       where nullif(btrim(coalesce(name, '')), '') is not null
       group by 1
      having count(distinct btrim(name)) > 1
    ) conflicting;

  if v_conflicts > 0 then
    raise exception
      'customer migration halted: % phone number(s) carry conflicting names across outlets. Resolve each by hand before migrating.',
      v_conflicts
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Merge equivalent duplicates, then rewire what pointed at them.
--
-- Deterministic retention: the lowest id wins, so a rerun against the same data
-- keeps the same row. The surviving row takes the earliest first_seen_at, the
-- latest last_seen_at, and whichever nonblank name exists — which is
-- unambiguous, because the block above proved there is at most one.

create temporary table customer_merge_map as
  select c.id as old_id,
         public.normalize_indian_phone(c.phone) as canonical,
         first_value(c.id) over (
           partition by public.normalize_indian_phone(c.phone)
           order by c.id
         ) as keep_id
    from public.customers c;

update public.customers c
   set phone = m.canonical,
       name = coalesce(
         nullif(btrim(coalesce(c.name, '')), ''),
         (select nullif(btrim(coalesce(o.name, '')), '')
            from public.customers o
            join customer_merge_map mm on mm.old_id = o.id
           where mm.canonical = m.canonical
             and nullif(btrim(coalesce(o.name, '')), '') is not null
           order by o.id
           limit 1)
       ),
       first_seen_at = (
         select min(o.first_seen_at) from public.customers o
           join customer_merge_map mm on mm.old_id = o.id
          where mm.canonical = m.canonical),
       last_seen_at = (
         select max(o.last_seen_at) from public.customers o
           join customer_merge_map mm on mm.old_id = o.id
          where mm.canonical = m.canonical)
  from customer_merge_map m
 where m.old_id = c.id
   and m.keep_id = c.id;

-- Every reference follows the retained id. `bills` is the only table with a
-- customer foreign key today; #33 adds orders and must extend this pattern
-- rather than assume there was never anything to rewire.
--
-- `bills_append_only` refuses every update except settled → void, which is
-- exactly right for a running system and exactly wrong for this statement — a
-- rehearsal against duplicate rows aborts on it. So the trigger is lifted for
-- the length of one rewire and put back immediately, and the narrowness matters:
--
--   * only `customer_id` moves, and only onto a row that IS the same customer
--     under the new identity rule. Nothing about the money changes — not a
--     total, not a line, not a payment method, not a business date.
--   * the whole migration is one transaction, so an abort anywhere below
--     restores the trigger along with everything else. There is no window in
--     which a deployed database has an append-only table that is not.
--
-- Anything that ever needs this again should have to write this comment again.
alter table public.bills disable trigger bills_append_only;

update public.bills b
   set customer_id = m.keep_id
  from customer_merge_map m
 where b.customer_id = m.old_id
   and m.keep_id <> m.old_id;

alter table public.bills enable trigger bills_append_only;

delete from public.customers c
 using customer_merge_map m
 where m.old_id = c.id
   and m.keep_id <> m.old_id;

drop table customer_merge_map;

-- ---------------------------------------------------------------------------
-- 4. The table becomes a global identity, and stops being anything else.
--
-- `outlet_id` goes because the row is no longer an outlet's. The two aggregate
-- columns go because a cached total is both a correction-drift bug waiting to
-- happen and, worse, activity from ONE outlet readable at ANOTHER through an
-- exact lookup — the precise leak this change exists to avoid. Outlet reporting
-- reads bills, which are outlet-scoped and always were.

-- The policy from #2 scoped reads by `outlet_id`, so it has to go before the
-- column can. Section 5 is where the decision not to replace it is argued.
drop policy customers_select on public.customers;

drop index if exists public.customers_outlet_phone_key;
drop index if exists public.customers_outlet_id_idx;

alter table public.customers
  drop column outlet_id,
  drop column bill_count,
  drop column total_spend_paise;

-- The timestamps are internal facts about the identity, not about trading:
-- when it was first created, and when a transaction last used it. Neither is
-- returned to a billing caller.
alter table public.customers rename column first_seen_at to created_at;
alter table public.customers rename column last_seen_at to last_used_at;

alter table public.customers
  alter column phone set not null,
  add constraint customers_phone_canonical
    check (phone = public.normalize_indian_phone(phone)),
  add constraint customers_name_not_blank
    check (name is null or btrim(name) <> '');

-- A named table CONSTRAINT rather than a bare unique index, so the create-or-get
-- path can say `on conflict on constraint customers_phone_key`. It cannot say
-- `on conflict (phone)`: that function returns a column called `phone`, and a
-- bare conflict target would be ambiguous between the output variable and the
-- column — which Postgres refuses at call time rather than at creation time.
alter table public.customers
  add constraint customers_phone_key unique (phone);

comment on table public.customers is
  'Business-wide customer identity keyed by canonical phone. Global by design '
  'and by classification in supabase/tests/01_schema_coverage.sql: it is the '
  'single deliberate exception to outlet scoping, and it carries identity only '
  '— never transactions, aggregates or outlet facts.';

-- ---------------------------------------------------------------------------
-- 5. Nobody reads the table.
--
-- The policy from #2 let a Franchise Admin and a device select their outlet's
-- customers. With the outlet column gone that policy would read the whole
-- directory, so it was dropped in section 4 and NOTHING REPLACES IT. RLS stays
-- enabled with zero policies (deny-all) AND the grant is revoked: two
-- independent statements of the same rule, which is what
-- `01_schema_coverage.sql` asks of any table it cannot classify as
-- outlet-scoped.

revoke all privileges on public.customers from authenticated, anon;
grant all on public.customers to service_role;

-- ---------------------------------------------------------------------------
-- 6. The lookup bound.
--
-- Ten digits with a known prefix is about 2^30 of search space, and an exact
-- lookup is an oracle over it. Rate-limiting is what turns "you would have to
-- ask a billion times" into a stated bound.
--
-- Modelled on invite_redemption_attempts (#16): a tenant-less counter that
-- stores WHO asked and WHEN, and nothing about WHAT was asked. There is no
-- phone column here and there must never be one — not raw, not hashed. A hash
-- of a ten-digit number is reversible in seconds, so "we hashed it" would be a
-- claim of privacy rather than privacy.

create table public.customer_lookup_attempts (
  id bigint generated always as identity primary key,
  -- The caller's auth uid: a device or a person, already known to the system.
  caller_id uuid,
  attempted_at timestamptz not null default now()
);

create index customer_lookup_attempts_caller_idx
  on public.customer_lookup_attempts (caller_id, attempted_at desc);

alter table public.customer_lookup_attempts enable row level security;

-- No policy, deliberately: nothing reads this table, including the owner.
grant all on public.customer_lookup_attempts to service_role;
revoke all privileges on public.customer_lookup_attempts from anon, authenticated;

-- 120 lookups per caller per quarter hour, 2000 across the endpoint.
--
-- A busy counter asks once per customer who offers a number — well under this
-- on the busiest day either shop has had. A guesser exhausts it in seconds and
-- learns nothing about whether any of the numbers existed. The global bound is
-- far looser than the per-caller one on purpose: a tight global bound is itself
-- an attack, since one device could stall every other counter with it.
create or replace function public.customer_lookup_exceeded(
  p_caller uuid,
  p_window interval default interval '15 minutes',
  p_per_caller integer default 120,
  p_global integer default 2000
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_global bigint;
  v_caller bigint;
begin
  select count(*),
         count(*) filter (where a.caller_id is not distinct from p_caller)
    into v_global, v_caller
    from public.customer_lookup_attempts a
   where a.attempted_at > now() - p_window;

  return v_global >= p_global or v_caller >= p_per_caller;
end;
$$;

create or replace function public.record_customer_lookup(
  p_caller uuid,
  p_window interval default interval '15 minutes'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Opportunistic pruning: the window is all anybody asks about, so anything
  -- older is dead weight and no scheduled job is needed to remove it.
  delete from public.customer_lookup_attempts
   where attempted_at <= now() - p_window;

  insert into public.customer_lookup_attempts (caller_id) values (p_caller);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Who may ask.
--
-- Today: an unrevoked enrolled counter device, or an active account holding a
-- live `biller` assignment — which is exactly the set of sessions that can ring
-- a bill, since counter devices are not yet enrolled in production and billers
-- still sign in personally (docs/LIMITATIONS.md).
--
-- #9 introduces the daily billing grant, and this function is where that
-- tightening lands: `and public.app_billing_grant_live()`. It is a separate
-- function rather than an inline clause precisely so that change is one edit in
-- one place rather than a search through three function bodies.
--
-- The Super Admin is NOT here. The owner's directory read is section 9, with
-- its own check — so no future widening of billing can widen the owner's path,
-- and no widening of the owner's path can widen billing's.

create or replace function public.app_may_look_up_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_account_active()
     and public.app_device_ok()
     and (
       exists (
         select 1 from public.counter_devices d
          where d.id = auth.uid() and d.revoked_at is null
       )
       or exists (
         select 1 from public.assignments a
          where a.person_id = auth.uid()
            and a.role = 'biller'
            and a.ended_on is null
       )
     )
$$;

-- ---------------------------------------------------------------------------
-- 8. The two billing paths.
--
-- Both take a complete phone and normalize it themselves. A caller cannot
-- opt out of normalization, cannot pass a pattern, and cannot ask for more
-- columns: the return type is the whole disclosure, and it holds no bill, no
-- outlet, no spend, no visit count and no timestamp.

create or replace function public.customer_lookup_by_phone(p_phone text)
returns table (id uuid, phone text, name text)
language plpgsql
-- Volatile, not stable: recording the attempt is a write, and a rate bound that
-- could be skipped by a planner that thought this function was read-only would
-- not be a rate bound.
security definer
set search_path = ''
as $$
declare
  v_canonical text;
begin
  if not public.app_may_look_up_customer() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- The bound is checked BEFORE the phone is even canonicalised, so a limited
  -- caller cannot learn from the shape of the refusal whether their input was
  -- well formed, let alone whether it matched.
  if public.customer_lookup_exceeded(auth.uid()) then
    raise exception 'too many lookups' using errcode = 'PT429';
  end if;

  v_canonical := public.normalize_indian_phone(p_phone);

  -- An incomplete or malformed number is not a lookup. It is refused without
  -- touching the table, and it does not spend the caller's budget: the counter
  -- mistypes, and the counter must not be punished for it.
  if v_canonical is null then
    raise exception 'phone is not a complete Indian mobile number'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.record_customer_lookup(auth.uid());

  return query
    select c.id, c.phone, c.name
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

-- Create-or-get. Concurrency-safe by the unique index rather than by a lock:
-- two counters ringing the same new customer at the same second both end up
-- pointing at one row, and neither waits for the other.
--
-- It never updates an existing profile. A bill whose form name differs from the
-- saved one snapshots its own name onto the bill — that is what the snapshot
-- columns are for — and the global identity is left exactly as it was.
create or replace function public.customer_create_or_get(
  p_phone text,
  p_name text default null
)
returns table (id uuid, phone text, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_name text;
begin
  if not public.app_may_look_up_customer() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if public.customer_lookup_exceeded(auth.uid()) then
    raise exception 'too many lookups' using errcode = 'PT429';
  end if;

  v_canonical := public.normalize_indian_phone(p_phone);

  if v_canonical is null then
    raise exception 'phone is not a complete Indian mobile number'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.record_customer_lookup(auth.uid());

  v_name := nullif(btrim(coalesce(p_name, '')), '');

  insert into public.customers (phone, name)
  values (v_canonical, v_name)
  on conflict on constraint customers_phone_key do nothing;

  -- `last_used_at` is the one thing a transaction moves, and it is an internal
  -- fact about the identity rather than a profile value: no billing caller can
  -- read it back, and no name or phone is rewritten by this path.
  update public.customers c
     set last_used_at = now()
   where c.phone = v_canonical;

  return query
    select c.id, c.phone, c.name
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The owner's separate boundary.
--
-- The Super Admin may read the directory. No editing path ships with this
-- change: a profile correction is a real flow with real questions (who may
-- rename a customer, and does the bill history follow?) and smuggling it in as
-- an update here would answer them by accident.

create or replace function public.customer_directory()
returns table (
  id uuid,
  phone text,
  name text,
  created_at timestamptz,
  last_used_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_account_active() and (select public.app_is_owner())) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  return query
    select c.id, c.phone, c.name, c.created_at, c.last_used_at
      from public.customers c
     order by c.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Execute grants. The counters are internal and stay that way.

revoke execute on function public.normalize_indian_phone(text) from public, anon;
revoke execute on function public.customer_lookup_exceeded(uuid, interval, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.record_customer_lookup(uuid, interval)
  from public, anon, authenticated;
revoke execute on function public.app_may_look_up_customer() from public, anon;
revoke execute on function public.customer_lookup_by_phone(text) from public, anon;
revoke execute on function public.customer_create_or_get(text, text) from public, anon;
revoke execute on function public.customer_directory() from public, anon;

grant execute on function public.normalize_indian_phone(text) to authenticated;
grant execute on function public.app_may_look_up_customer() to authenticated;
grant execute on function public.customer_lookup_by_phone(text) to authenticated;
grant execute on function public.customer_create_or_get(text, text) to authenticated;
grant execute on function public.customer_directory() to authenticated;
