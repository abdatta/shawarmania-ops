-- a-gold-member-is-a-label (#57): a word beside a name, granted by a person.
--
-- Four things, in the order they depend on each other:
--
--   1. membership, as spells a revocation ends and never deletes;
--   2. the tier each order and bill was rung under, snapshotted by the server
--      from that history at the moment of sale;
--   3. the counter told whether an identified customer is gold, and nothing else;
--   4. the management path — the owner's over the whole business, a Franchise
--      Admin's over their own outlets — with its scope written once, and the
--      three writes behind a "wholly this reader's" check.
--
-- Nothing here computes money. A member's bill and a stranger's identical bill
-- come to the same total; a biller who gives a member something does it by hand
-- through the discount controls that already exist.

-- ---------------------------------------------------------------------------
-- 1. Membership.
--
-- **Records, not a flag.** A boolean on `customers` would forget how it got
-- there, and an automatic appointment rule is anticipated: it will need to know
-- that a person took a membership away, so it does not hand it straight back.
-- So a membership is a spell with a start and, perhaps, an end — each with who
-- and when — and the current state is derived from the spells. A re-grant is a
-- new spell. `reason` is written now and used by nothing yet: it is where a
-- future rule records why.
--
-- **Global, like `customers`, and treated like it.** The membership belongs to
-- the person, not to a shop: "a Shawarmania gold member" is a brand promise, and
-- the business trades from one outlet for the life of this version anyway, so a
-- per-outlet membership would have an isolation claim nobody could test. The
-- table is therefore the same deliberate exception `customers` is, with the same
-- two independent locks: no client privilege at all, and RLS with no policy.

create type public.customer_tier as enum ('gold');

comment on type public.customer_tier is
  'A customer''s membership level. One value, so a second tier is a type change '
  'rather than a redesign — and so nothing ships pretending there are two.';

create table public.customer_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  granted_at timestamptz not null default now(),
  granted_by uuid not null references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  reason text,
  constraint customer_memberships_revocation_pair
    check ((revoked_at is null) = (revoked_by is null)),
  constraint customer_memberships_ends_after_it_starts
    check (revoked_at is null or revoked_at >= granted_at),
  constraint customer_memberships_reason_not_blank
    check (reason is null or btrim(reason) <> '')
);

-- At most one spell in force per customer. Two open spells would make "member
-- since" ambiguous and a revocation half-done.
create unique index customer_memberships_one_in_force
  on public.customer_memberships (customer_id) where revoked_at is null;

create index customer_memberships_customer_idx
  on public.customer_memberships (customer_id, granted_at desc);

comment on table public.customer_memberships is
  'Spells of membership: granted, and perhaps ended. Never deleted and never '
  'rewritten, because the record is what a later rule and a later history screen '
  'read. Global like `customers`, and reachable only through security-definer '
  'functions.';

-- The guard: a spell may be ended once, and nothing else about it may change.
-- An ended spell is history. Deleting one is refused outright — it would destroy
-- the only fact that tells a future rule a person took this membership away.
create or replace function public.customer_memberships_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a membership is ended, never deleted';
  end if;
  if old.revoked_at is not null then
    raise exception 'an ended membership is history and does not change';
  end if;
  if new.revoked_at is null then
    raise exception 'the only change a membership accepts is its end';
  end if;
  if (to_jsonb(new) - 'revoked_at' - 'revoked_by')
     is distinct from (to_jsonb(old) - 'revoked_at' - 'revoked_by') then
    raise exception 'ending a membership may record its end and nothing else';
  end if;
  return new;
end;
$$;

create trigger customer_memberships_guard
  before update or delete on public.customer_memberships
  for each row execute function public.customer_memberships_guard();

alter table public.customer_memberships enable row level security;
revoke all privileges on public.customer_memberships from authenticated, anon;
grant all on public.customer_memberships to service_role;

-- Whether a customer held gold at an instant. The one reading of the history,
-- used by the snapshot below and by every current-state read.
create or replace function public.customer_tier_at(p_customer uuid, p_at timestamptz)
returns public.customer_tier
language sql
stable
security definer
set search_path = ''
as $$
  select 'gold'::public.customer_tier
   where exists (
     select 1 from public.customer_memberships m
      where m.customer_id = p_customer
        and m.granted_at <= p_at
        and (m.revoked_at is null or m.revoked_at > p_at)
   )
$$;

create or replace function public.customer_is_member(p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customer_memberships m
     where m.customer_id = p_customer and m.revoked_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. The tier a sale was rung under.
--
-- **A fact about the sale, like the price charged — never a join.** A live join
-- would change cards already being made when a membership is revoked mid-shift,
-- would answer "is gold now" when the kitchen acts on "was gold when they
-- ordered", and would rewrite a year-old receipt.
--
-- **The server decides it, from the membership history at the moment of sale**
-- (owner, 2026-09-24). The command's own `created_at` is when the sale was rung,
-- and the server already bounds it; `customer_tier_at` answers for that instant.
-- So a sale rung offline and delivered hours later records the membership as it
-- stood when the customer was at the counter, and nothing the tablet sends can
-- set it. The payload is unchanged: no new command version, no both-shapes
-- boundary at the money path.
--
-- This replaces a narrower rule the design first carried — an offline tablet
-- that had never seen a member, taking payment on the spot, would record no
-- membership because the counter did not know. Honouring that needed the tablet
-- to send what it knew, which meant a third payload version; the owner chose the
-- simpler, unforgeable rule knowing the case it changes is rare.
--
-- Written by trigger rather than inside the three sale functions, so this rule
-- lives in one place and the functions that carry the money are not reproduced
-- here to add one column each.

alter table public.orders add column customer_tier public.customer_tier;
alter table public.bills add column customer_tier public.customer_tier;

comment on column public.orders.customer_tier is
  'The customer''s membership when the order was rung — set by the server, '
  'never by a client, and read by every mark drawn against the order.';
comment on column public.bills.customer_tier is
  'The membership this bill was rung under: its order''s, or for a direct sale '
  'the history at the moment of sale. Final, like every settled bill fact.';

-- Orders: set on insert; on a revision, re-read only when the revision names a
-- different customer, so a revocation between two edits of one order does not
-- take its mark away mid-preparation.
--
-- **Named to fire after `orders_guard`.** Same-event triggers fire in name order,
-- and the guard refuses a revision that changes any column outside its list —
-- which does not include this one, deliberately. The guard inspects the row as
-- the command wrote it; this trigger then sets the tier. Renaming either so this
-- one sorts first would make every customer change on an open order fail.
create or replace function public.orders_snapshot_customer_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.customer_tier := case
      when new.customer_id is null then null
      else public.customer_tier_at(new.customer_id, new.ordered_at)
    end;
  elsif new.customer_id is distinct from old.customer_id then
    new.customer_tier := case
      when new.customer_id is null then null
      else public.customer_tier_at(new.customer_id, coalesce(new.changed_at, now()))
    end;
  else
    new.customer_tier := old.customer_tier;
  end if;
  return new;
end;
$$;

create trigger orders_snapshot_customer_tier
  before insert or update on public.orders
  for each row execute function public.orders_snapshot_customer_tier();

-- Bills: the order's, when the bill settles one — the kitchen and the receipt
-- agree — or the history at the moment of sale for a direct one. Insert only:
-- a bill is append-only, and a void moves nothing but its void attribution.
create or replace function public.bills_snapshot_customer_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_id is not null then
    select o.customer_tier into new.customer_tier
      from public.orders o where o.id = new.order_id;
  elsif new.customer_id is not null then
    new.customer_tier := public.customer_tier_at(
      new.customer_id, coalesce(new.ordered_at, new.paid_at, new.created_at, now()));
  else
    new.customer_tier := null;
  end if;
  return new;
end;
$$;

create trigger bills_snapshot_customer_tier
  before insert on public.bills
  for each row execute function public.bills_snapshot_customer_tier();

-- Nothing has ever queried bills by customer; the thirty-day figures do, across
-- outlets. Partial, because most bills carry no customer.
create index bills_customer_idx
  on public.bills (customer_id, business_date) where customer_id is not null;
create index orders_customer_idx
  on public.orders (customer_id, outlet_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The counter is told whether somebody is gold, and nothing else.
--
-- `global-customer-identity` said the billing response carries "only customer
-- ID, canonical phone, and saved billing name". It now carries `is_member` too,
-- and the widening is stated with its cost in that spec: a biller at one outlet
-- may learn that a customer who has only ever shopped at another is gold. No
-- date, no actor, no history, no spend. Nothing else about either boundary moves
-- — not the exactness of the lookup, not the outlet scope and one-match rule of
-- the suggestion, not the rate bound.
--
-- A return type cannot be altered in place, so each function is dropped and
-- recreated with its body unchanged but for the one column.

drop function public.customer_lookup_by_phone(text);

create function public.customer_lookup_by_phone(p_phone text)
returns table (id uuid, phone text, name text, is_member boolean)
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
    select c.id, c.phone, c.name, public.customer_is_member(c.id)
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

drop function public.customer_create_or_get(text, text);

-- Create-or-get. Concurrency-safe by the unique index rather than by a lock:
-- two counters ringing the same new customer at the same second both end up
-- pointing at one row, and neither waits for the other.
--
-- It never updates an existing profile. A bill whose form name differs from the
-- saved one snapshots its own name onto the bill — that is what the snapshot
-- columns are for — and the global identity is left exactly as it was.
create function public.customer_create_or_get(
  p_phone text,
  p_name text default null
)
returns table (id uuid, phone text, name text, is_member boolean)
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
    select c.id, c.phone, c.name, public.customer_is_member(c.id)
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

drop function public.customer_suggest_at_outlet(text);

-- A partial number, among the customers THIS OUTLET has served. See
-- 20260920000000 for why the outlet scope is the whole of its safety and the
-- three rules a later change must not relax. Unchanged here but for `is_member`,
-- which discloses strictly less than the exact lookup's: this path can only
-- reach somebody this counter already served.
create function public.customer_suggest_at_outlet(p_partial text)
returns table (id uuid, phone text, name text, other_matches integer, is_member boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_digits text;
begin
  if not public.app_may_look_up_customer() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  v_outlet := public.app_billing_outlet();
  if v_outlet is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- Digits only, so nothing a caller types can reach the LIKE below as a
  -- pattern. The last ten, because a caller may have sent `+91` with them.
  v_digits := right(regexp_replace(coalesce(p_partial, ''), '[^0-9]', '', 'g'), 10);
  if length(v_digits) < 4 then return; end if;

  if public.customer_lookup_exceeded(auth.uid()) then
    raise exception 'too many lookups' using errcode = 'PT429';
  end if;
  perform public.record_customer_lookup(auth.uid());

  return query
  with served as (
    select o.customer_id as cid, max(o.ordered_at) as served_at
      from public.orders o
     where o.outlet_id = v_outlet and o.customer_id is not null
     group by o.customer_id
    union all
    select b.customer_id as cid, max(b.created_at) as served_at
      from public.bills b
     where b.outlet_id = v_outlet and b.customer_id is not null
     group by b.customer_id
  ),
  latest as (
    select cid, max(served_at) as served_at from served group by cid
  ),
  matching as (
    select c.id as cid, c.phone as cphone, c.name as cname, l.served_at as served_at
      from latest l
      join public.customers c on c.id = l.cid
     where right(c.phone, 10) like v_digits || '%'
  ),
  counted as (
    select m.cid, m.cphone, m.cname, m.served_at, count(*) over () as total
      from matching m
  )
  select counted.cid, counted.cphone, counted.cname, (counted.total - 1)::integer,
         public.customer_is_member(counted.cid)
    from counted
   order by counted.served_at desc
   limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The management path: the owner's, and a manager's over their own outlets.
--
-- **One reader, two scopes, and the scope written once.** Every read below is
-- built on `app_customer_directory_outlets()` — null for the owner, meaning the
-- whole business; the outlets a Franchise Admin's assignments name otherwise;
-- a refusal for anybody else. Search, both lists and the card each ask it, and
-- none of them decides reach for itself, so none can forget to.
--
-- **Kept apart from the counter's path**, as #32 set it up: the counter's
-- functions check `app_may_look_up_customer()` and these check this. Widening one
-- can never widen the other, however alike their bodies come to look.
--
-- **Figures are read, never stored.** Visits and spend are summed from bills
-- when asked for; nothing aggregate is written to `customers` (#32 removed
-- `bill_count` and `total_spend_paise` from it so they could never ride along in
-- the counter's lookup). One settled bill is one visit; a void counts for
-- nothing. The window is the last thirty business days at each bill's outlet.

create or replace function public.app_customer_directory_outlets()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlets uuid[];
begin
  if not public.app_account_active() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if public.app_is_owner() then
    return null;
  end if;
  select array_agg(t.outlet_id) into v_outlets
    from public.app_outlets_for('franchise_admin') as t(outlet_id);
  if v_outlets is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  return v_outlets;
end;
$$;

-- The customers a reader may know exist: everybody for the owner; for a
-- manager, somebody their outlets have served on an order or a bill. Anybody
-- else answers exactly as a customer who does not exist.
create or replace function public.customer_directory_reach(p_outlets uuid[])
returns table (customer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.customers c where p_outlets is null
  union
  select b.customer_id from public.bills b
   where p_outlets is not null and b.customer_id is not null
     and b.outlet_id = any (p_outlets)
  union
  select o.customer_id from public.orders o
   where p_outlets is not null and o.customer_id is not null
     and o.outlet_id = any (p_outlets)
$$;

-- What each customer did, counted only from the bills this reader may count.
create or replace function public.customer_directory_activity(p_outlets uuid[])
returns table (
  customer_id uuid,
  visits_30d integer,
  spend_30d_paise bigint,
  last_seen_at timestamptz,
  first_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.customer_id,
         (count(*) filter (
            where b.business_date >= public.app_business_date(now(), o.business_day_cutover) - 29
         ))::integer,
         coalesce(sum(b.total_paise) filter (
            where b.business_date >= public.app_business_date(now(), o.business_day_cutover) - 29
         ), 0)::bigint,
         max(b.paid_at),
         min(b.paid_at)
    from public.bills b
    join public.outlets o on o.id = b.outlet_id
   where b.customer_id is not null
     and b.status = 'settled'
     and (p_outlets is null or b.outlet_id = any (p_outlets))
   group by b.customer_id
$$;

-- May this reader change this customer? The owner always. A manager only while
-- every order and bill the customer has ANYWHERE belongs to one of their outlets
-- (owner, 2026-09-24): the name and the membership are the same at every outlet,
-- so a manager changing a shared customer would be changing another outlet's.
--
-- Reads across outlets on purpose, and discloses one bit: "served elsewhere".
-- Never which outlet, when, or what. That bit is the unavoidable shadow of the
-- rule, and the spec states it.
create or replace function public.customer_directory_may_edit(p_customer uuid, p_outlets uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_outlets is null or (
    (exists (select 1 from public.bills b where b.customer_id = p_customer)
      or exists (select 1 from public.orders o where o.customer_id = p_customer))
    and not exists (
      select 1 from public.bills b
       where b.customer_id = p_customer and not (b.outlet_id = any (p_outlets)))
    and not exists (
      select 1 from public.orders o
       where o.customer_id = p_customer and not (o.outlet_id = any (p_outlets)))
  )
$$;

create or replace function public.customer_directory_card(p_customer uuid)
returns table (
  id uuid,
  phone text,
  name text,
  member_since timestamptz,
  visits_30d integer,
  spend_30d_paise bigint,
  last_seen_at timestamptz,
  customer_since timestamptz,
  scope text,
  editable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlets uuid[];
begin
  v_outlets := public.app_customer_directory_outlets();

  return query
    select c.id, c.phone, c.name,
           (select m.granted_at from public.customer_memberships m
             where m.customer_id = c.id and m.revoked_at is null),
           coalesce(a.visits_30d, 0),
           coalesce(a.spend_30d_paise, 0::bigint),
           a.last_seen_at,
           -- A manager's "since" is their own outlets' first sale: the
           -- business-wide date would say when somebody first bought elsewhere.
           case when v_outlets is null then c.created_at
                else coalesce(
                  a.first_seen_at,
                  (select min(o.ordered_at) from public.orders o
                    where o.customer_id = c.id and o.outlet_id = any (v_outlets)),
                  c.created_at)
           end,
           case when v_outlets is null then 'business' else 'outlets' end,
           public.customer_directory_may_edit(c.id, v_outlets)
      from public.customers c
      left join public.customer_directory_activity(v_outlets) a on a.customer_id = c.id
     where c.id = p_customer
       and c.id in (select r.customer_id from public.customer_directory_reach(v_outlets) r);
end;
$$;

-- A list, a page at a time. Twenty-one rows come back so the caller knows
-- whether there is a next page without a count. The order is total — ties down
-- to the id — so consecutive pages neither repeat nor skip anybody while the
-- list is unchanged.
--
--   regulars — everybody seen in the last thirty days, however few visits,
--              most visits first, then the most recent visit;
--   members  — everybody gold now, newest grant first.
create or replace function public.customer_directory_list(p_list text, p_offset integer default 0)
returns table (id uuid, phone text, name text, is_member boolean, visits_30d integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlets uuid[];
begin
  v_outlets := public.app_customer_directory_outlets();
  if p_list is null or p_list not in ('regulars', 'members')
     or p_offset is null or p_offset < 0 then
    raise exception 'unknown list or page' using errcode = 'invalid_parameter_value';
  end if;

  if p_list = 'members' then
    return query
      select c.id, c.phone, c.name, true, coalesce(a.visits_30d, 0)
        from public.customer_memberships m
        join public.customers c on c.id = m.customer_id
        left join public.customer_directory_activity(v_outlets) a on a.customer_id = c.id
       where m.revoked_at is null
         and c.id in (select r.customer_id from public.customer_directory_reach(v_outlets) r)
       order by m.granted_at desc, c.id
      offset p_offset limit 21;
  else
    return query
      select c.id, c.phone, c.name, public.customer_is_member(c.id), a.visits_30d
        from public.customer_directory_activity(v_outlets) a
        join public.customers c on c.id = a.customer_id
       where a.visits_30d > 0
       order by a.visits_30d desc, a.last_seen_at desc nulls last, c.id
      offset p_offset limit 21;
  end if;
end;
$$;

-- A name or part of a number, as `src/domain/customer-search.ts` reads one:
--
--   * digits (spaces, dashes and a `+91` tolerated) — three or more, as one run
--     anywhere in the ten digits;
--   * anything with a letter — three or more characters, anywhere in the saved
--     name, ignoring case; then, only while fewer than twenty match exactly, the
--     same characters in order with gaps, ranked after every exact match.
--
-- Never loosely for a number: three digits in order occur in most numbers.
-- Twenty results at most, each carrying how many matched in all, so the caller
-- can say "keep typing" without a way to page past them. Whatever is typed
-- reaches LIKE escaped: a `%` in a query is a percent sign, not a wildcard.
create or replace function public.customer_directory_search(p_query text)
returns table (
  id uuid, phone text, name text, is_member boolean, visits_30d integer, matched integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlets uuid[];
  v_query text := btrim(coalesce(p_query, ''));
  v_digits text;
  v_needle text;
  v_exact text;
  v_loose text;
begin
  v_outlets := public.app_customer_directory_outlets();

  if v_query ~ '^[+0-9[:space:]-]+$' then
    v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');
    if (v_query like '+%' or length(v_digits) > 10) and v_digits like '91%' then
      v_digits := substr(v_digits, 3);
    end if;
    if length(v_digits) < 3 then return; end if;
  else
    v_needle := lower(v_query);
    if length(v_needle) < 3 then return; end if;
    v_exact := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select '%' || string_agg(
             replace(replace(replace(ch, '\', '\\'), '%', '\%'), '_', '\_'), '%' order by n)
           || '%'
      into v_loose
      from regexp_split_to_table(v_needle, '') with ordinality as s(ch, n);
  end if;

  return query
  with reach as (
    select r.customer_id from public.customer_directory_reach(v_outlets) r
  ),
  exact as (
    select c.id as cid, 0 as strength
      from public.customers c
     where c.id in (select reach.customer_id from reach)
       and case when v_digits is not null
                then right(c.phone, 10) like '%' || v_digits || '%'
                else lower(coalesce(c.name, '')) like v_exact escape '\'
           end
  ),
  loose as (
    select c.id as cid, 1 as strength
      from public.customers c
     where v_digits is null
       and (select count(*) from exact) < 20
       and c.id in (select reach.customer_id from reach)
       and lower(coalesce(c.name, '')) like v_loose escape '\'
       and not lower(coalesce(c.name, '')) like v_exact escape '\'
  ),
  -- Not `found`: that is PL/pgSQL's own flag, and a CTE by that name would be
  -- read as the variable.
  hits as (
    select * from exact union all select * from loose
  ),
  counted as (
    select hits.cid, hits.strength, count(*) over () as total from hits
  )
  select c.id, c.phone, c.name, public.customer_is_member(c.id),
         coalesce(a.visits_30d, 0), counted.total::integer
    from counted
    join public.customers c on c.id = counted.cid
    left join public.customer_directory_activity(v_outlets) a on a.customer_id = c.id
   order by counted.strength, a.last_seen_at desc nulls last, c.id
   limit 20;
end;
$$;

-- The three writes share one gate. It locks the customer's row first, which is
-- the row a sale's resolve updates at any outlet: a sale somewhere else either
-- lands before the check (and is seen by it) or waits until this write is done.
-- So "served nowhere else" is decided at the moment of the write, never trusted
-- from a card read earlier.
create or replace function public.customer_directory_require_editable(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlets uuid[];
begin
  v_outlets := public.app_customer_directory_outlets();
  perform 1 from public.customers c where c.id = p_customer for update;
  if not found
     or p_customer not in (select r.customer_id from public.customer_directory_reach(v_outlets) r) then
    raise exception 'no such customer' using errcode = 'no_data_found';
  end if;
  if not public.customer_directory_may_edit(p_customer, v_outlets) then
    raise exception 'this customer is also served at another outlet'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- A correction to the saved profile only. Every bill and order keeps the name it
-- snapshotted. A name can be corrected and never erased.
create or replace function public.customer_rename(p_customer uuid, p_name text)
returns table (
  id uuid, phone text, name text, member_since timestamptz, visits_30d integer,
  spend_30d_paise bigint, last_seen_at timestamptz, customer_since timestamptz,
  scope text, editable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform public.customer_directory_require_editable(p_customer);
  if v_name is null then
    raise exception 'a name cannot be left empty' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers c set name = v_name where c.id = p_customer;
  return query select * from public.customer_directory_card(p_customer);
end;
$$;

-- A second tap on a slow network finds gold already granted and changes
-- nothing: the answer is the card, which says it is a member.
create or replace function public.customer_membership_grant(p_customer uuid)
returns table (
  id uuid, phone text, name text, member_since timestamptz, visits_30d integer,
  spend_30d_paise bigint, last_seen_at timestamptz, customer_since timestamptz,
  scope text, editable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.customer_directory_require_editable(p_customer);
  if not public.customer_is_member(p_customer) then
    insert into public.customer_memberships (customer_id, granted_by)
    values (p_customer, auth.uid());
  end if;
  return query select * from public.customer_directory_card(p_customer);
end;
$$;

-- Ends the spell in force and keeps it — the record a later history screen and
-- a later rule both read.
create or replace function public.customer_membership_revoke(p_customer uuid)
returns table (
  id uuid, phone text, name text, member_since timestamptz, visits_30d integer,
  spend_30d_paise bigint, last_seen_at timestamptz, customer_since timestamptz,
  scope text, editable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.customer_directory_require_editable(p_customer);
  update public.customer_memberships m
     set revoked_at = now(), revoked_by = auth.uid()
   where m.customer_id = p_customer and m.revoked_at is null;
  return query select * from public.customer_directory_card(p_customer);
end;
$$;

-- The unpaged owner read this replaces. It returned the whole directory ordered
-- by `created_at`, written when the table had no rows; the search and the two
-- paged lists above answer every question it did, at either scope.
drop function public.customer_directory();

-- ---------------------------------------------------------------------------
-- 5. Who may call what.
--
-- The internal pieces — the tier reading, the scope, reach, activity and the
-- edit gate — take arguments that would let a caller name a scope it does not
-- hold, so no client may call them directly. Only the functions that derive
-- the scope from the caller's own authority are granted.

revoke execute on function public.customer_tier_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.customer_is_member(uuid) from public, anon, authenticated;
revoke execute on function public.customer_directory_reach(uuid[]) from public, anon, authenticated;
revoke execute on function public.customer_directory_activity(uuid[]) from public, anon, authenticated;
revoke execute on function public.customer_directory_may_edit(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.customer_directory_require_editable(uuid) from public, anon, authenticated;
revoke execute on function public.app_customer_directory_outlets() from public, anon, authenticated;

revoke execute on function public.customer_lookup_by_phone(text) from public, anon;
revoke execute on function public.customer_create_or_get(text, text) from public, anon;
revoke execute on function public.customer_suggest_at_outlet(text) from public, anon;
revoke execute on function public.customer_directory_card(uuid) from public, anon;
revoke execute on function public.customer_directory_list(text, integer) from public, anon;
revoke execute on function public.customer_directory_search(text) from public, anon;
revoke execute on function public.customer_rename(uuid, text) from public, anon;
revoke execute on function public.customer_membership_grant(uuid) from public, anon;
revoke execute on function public.customer_membership_revoke(uuid) from public, anon;

grant execute on function public.customer_lookup_by_phone(text) to authenticated;
grant execute on function public.customer_create_or_get(text, text) to authenticated;
grant execute on function public.customer_suggest_at_outlet(text) to authenticated;
grant execute on function public.customer_directory_card(uuid) to authenticated;
grant execute on function public.customer_directory_list(text, integer) to authenticated;
grant execute on function public.customer_directory_search(text) to authenticated;
grant execute on function public.customer_rename(uuid, text) to authenticated;
grant execute on function public.customer_membership_grant(uuid) to authenticated;
grant execute on function public.customer_membership_revoke(uuid) to authenticated;
