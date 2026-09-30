-- a-regular-earns-points-and-gold (#62): points an outlet gives, and gold an
-- outlet grants.
--
-- In the order they depend on each other:
--
--   1. the outlet's rules, and the one narrow function that writes them (D12);
--   2. where a points discount comes from, on the rows that already hold
--      bill-level discounts (D7);
--   3. the points ledger, append-only and outlet-scoped (D5);
--   4. gold per outlet, with the end date its grant stored (D1, D2);
--   5. earning at acceptance, and a void reversing it (D6, D11);
--   6. the boundary accepting payload version 4, and a points row's shape (D8, D9);
--   7. what the till is told, and the counter's grant (D3, D4, D10);
--   8. the management reads and writes, one outlet at a time (D13);
--   9. the receipt's figures (D14);
--  10. who may call what.
--
-- Money stays integer paise throughout. One point is one rupee (100 paise), is
-- not a setting, and nothing here holds a fraction of one.

-- ---------------------------------------------------------------------------
-- 1. The outlet's rules (D12).
--
-- Columns on `outlets` with their checks stated on the table, so a hand-crafted
-- request meets exactly the rules the Loyalty section applies
-- (`src/domain/loyalty.ts`, `loyaltySettingsProblem`). Every existing outlet
-- takes the defaults, which are all off, and bills exactly as it did.

alter table public.outlets
  add column points_enabled boolean not null default false,
  add column points_earn_per_block integer,
  add column points_earn_block_paise integer,
  add column points_use_cap_bp integer,
  add column gold_enabled boolean not null default false,
  add column gold_earn_multiplier_x100 integer not null default 100,
  add column points_gold_use_cap_bp integer,
  add column gold_duration_months integer not null default 6,
  add column gold_counter_grant boolean not null default false,
  add column gold_threshold_paise integer;

alter table public.outlets
  add constraint outlets_points_earn_per_block_positive
    check (points_earn_per_block is null or points_earn_per_block > 0),
  add constraint outlets_points_earn_block_whole_rupees
    check (points_earn_block_paise is null
           or (points_earn_block_paise > 0 and points_earn_block_paise % 100 = 0)),
  add constraint outlets_points_use_cap_range
    check (points_use_cap_bp is null or points_use_cap_bp between 1 and 10000),
  -- The earn pair and the cap are set exactly while points are on.
  add constraint outlets_points_rules_with_switch
    check (points_enabled = (points_earn_per_block is not null)
           and points_enabled = (points_earn_block_paise is not null)
           and points_enabled = (points_use_cap_bp is not null)),
  add constraint outlets_gold_earn_multiplier_range
    check (gold_earn_multiplier_x100 between 100 and 1000),
  -- Set exactly while points AND gold are on, and never below everybody's cap.
  add constraint outlets_points_gold_use_cap_with_switches
    check ((points_enabled and gold_enabled) = (points_gold_use_cap_bp is not null)),
  add constraint outlets_points_gold_use_cap_range
    check (points_gold_use_cap_bp is null
           or (points_gold_use_cap_bp between 1 and 10000
               and points_gold_use_cap_bp >= points_use_cap_bp)),
  add constraint outlets_gold_duration_range
    check (gold_duration_months between 1 and 60),
  add constraint outlets_gold_counter_grant_needs_gold
    check (not gold_counter_grant or gold_enabled),
  -- The monthly spend is set exactly while billers may upgrade to Gold. The
  -- window is always thirty days and is not a column (owner, 2026-09-29).
  add constraint outlets_gold_threshold_with_switch
    check (gold_counter_grant = (gold_threshold_paise is not null)),
  add constraint outlets_gold_threshold_whole_rupees
    check (gold_threshold_paise is null
           or (gold_threshold_paise > 0 and gold_threshold_paise % 100 = 0));

comment on column public.outlets.points_enabled is
  'Whether bills here earn points and may use them. Off stops both; balances '
  'remain and resume if it comes back on.';
comment on column public.outlets.points_earn_per_block is
  'Points earned per block of the bill (after every discount but points).';
comment on column public.outlets.points_earn_block_paise is
  'The block points are earned per, in paise: whole rupees.';
comment on column public.outlets.points_use_cap_bp is
  'The most of a bill, after other discounts, points may pay, in basis points.';
comment on column public.outlets.gold_enabled is
  'Whether this outlet has gold members at all. Off, nobody is gold here.';
comment on column public.outlets.gold_earn_multiplier_x100 is
  'How much faster a gold member earns, in hundredths: 100 is the same rate.';
comment on column public.outlets.points_gold_use_cap_bp is
  'The points cap for a gold member here; never below points_use_cap_bp.';
comment on column public.outlets.gold_duration_months is
  'How long a grant of gold made here lasts. Stored on each grant when made.';
comment on column public.outlets.gold_counter_grant is
  'Whether a biller may upgrade an eligible customer to Gold at the counter.';
comment on column public.outlets.gold_threshold_paise is
  'What a customer must have paid here in the last 30 business days to be '
  'eligible for gold at the counter. Whole rupees.';

do $$
begin
  if exists (select 1 from public.outlets
              where points_enabled or gold_enabled or gold_counter_grant) then
    raise exception 'every existing outlet must start with points and gold off';
  end if;
end;
$$;

-- One narrow write, authorised exactly as #60's service settings are: the
-- owner, or a Franchise Admin of this outlet, on a live account. These ten
-- columns and no others, so this is no way round `outlets_update`.
create or replace function public.set_outlet_loyalty_settings(
  p_outlet uuid,
  p_points_enabled boolean,
  p_points_earn_per_block integer,
  p_points_earn_block_paise integer,
  p_points_use_cap_bp integer,
  p_gold_enabled boolean,
  p_gold_earn_multiplier_x100 integer,
  p_points_gold_use_cap_bp integer,
  p_gold_duration_months integer,
  p_gold_counter_grant boolean,
  p_gold_threshold_paise integer
)
returns public.outlets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change its points and gold'
      using errcode = 'insufficient_privilege';
  end if;

  update public.outlets
     set points_enabled = p_points_enabled,
         points_earn_per_block = p_points_earn_per_block,
         points_earn_block_paise = p_points_earn_block_paise,
         points_use_cap_bp = p_points_use_cap_bp,
         gold_enabled = p_gold_enabled,
         gold_earn_multiplier_x100 = p_gold_earn_multiplier_x100,
         points_gold_use_cap_bp = p_points_gold_use_cap_bp,
         gold_duration_months = p_gold_duration_months,
         gold_counter_grant = p_gold_counter_grant,
         gold_threshold_paise = p_gold_threshold_paise
   where id = p_outlet
  returning * into v_outlet;

  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Where a bill-level discount came from (D7).
--
-- A points row is a bill discount like a biller's, carried from the order to the
-- bill the same way and counted by the same parts-equal-the-whole guard. What
-- makes it one: an amount, in whole rupees, at most one per order or bill. That
-- it needs a customer is the boundary's check (section 6), not the table's: the
-- server's resolve may fail to link one, and a sale is never refused over a link.

create type public.discount_row_source as enum ('biller', 'points');

comment on type public.discount_row_source is
  'Who a bill-level discount came from: the biller''s hand, or the customer''s points.';

alter table public.order_discounts
  add column source public.discount_row_source not null default 'biller';
alter table public.bill_discounts
  add column source public.discount_row_source not null default 'biller';

alter table public.order_discounts
  add constraint order_discounts_points_shape
    check (source <> 'points'
           or (basis = 'amount' and value_paise = amount_paise and amount_paise % 100 = 0));
alter table public.bill_discounts
  add constraint bill_discounts_points_shape
    check (source <> 'points'
           or (basis = 'amount' and value_paise = amount_paise and amount_paise % 100 = 0));

create unique index order_discounts_one_points_row
  on public.order_discounts (order_id) where source = 'points';
create unique index bill_discounts_one_points_row
  on public.bill_discounts (bill_id) where source = 'points';

-- ---------------------------------------------------------------------------
-- 3. The points ledger (D5).
--
-- **The balance is the sum of `points`** for an (outlet, customer), derived and
-- never a column on `customers`, whose no-aggregate rule (#32, #57) stands.
-- `balance_after` is stored so the receipt reports a stored figure; every write
-- takes an advisory lock on (outlet, customer) before reading the balance, so
-- two writes landing together never compute from the same starting figure. Two
-- sales at one outlet are already queued by its bill-number counter; the lock is
-- what holds a void racing a sale (zz-billing-command-races.test.ts proves it,
-- and fails without it).
-- `unique (bill_id, kind)` is the idempotency: a bill earns once, uses once and
-- is reversed once, however often its command is retried.
--
-- Attribution comes from the bill: its till, shift, operator and outlet are one
-- join away, so none is copied here.

create type public.points_entry_kind as enum
  ('earned', 'used', 'earned_reversed', 'used_returned');

create table public.customer_points_entries (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  customer_id uuid not null references public.customers (id),
  bill_id uuid not null references public.bills (id),
  kind public.points_entry_kind not null,
  points integer not null,
  balance_after integer not null,
  earn_basis_paise bigint,
  earn_block_paise integer,
  earn_points_per_block integer,
  earn_multiplier_x100 integer,
  created_at timestamptz not null default now(),
  constraint customer_points_entries_once_per_bill unique (bill_id, kind),
  -- Earned and returned add; used and reversed take away; none is nought.
  constraint customer_points_entries_sign
    check ((kind in ('earned', 'used_returned') and points > 0)
           or (kind in ('used', 'earned_reversed') and points < 0)),
  -- An earned row names the rule it used; no other row names one.
  constraint customer_points_entries_rule_on_earned
    check ((kind = 'earned') = (earn_basis_paise is not null)
           and (kind = 'earned') = (earn_block_paise is not null)
           and (kind = 'earned') = (earn_points_per_block is not null)
           and (kind = 'earned') = (earn_multiplier_x100 is not null))
);

create index customer_points_entries_customer_idx
  on public.customer_points_entries (outlet_id, customer_id);

comment on table public.customer_points_entries is
  'Every point a bill earned or used, and every reversal of either, at the '
  'outlet that gave them. Append-only; written only by the triggers on bills.';

create trigger customer_points_entries_immutable
  before update or delete on public.customer_points_entries
  for each row execute function public.reject_mutation();

alter table public.customer_points_entries enable row level security;

-- The owner, and a Franchise Admin of that outlet. A counter reads a balance
-- through the lookup (section 7) and never this table. No write policy.
create policy customer_points_entries_select on public.customer_points_entries
  for select to authenticated
  using (
    public.app_account_active()
    and (public.app_is_owner() or public.app_has_role_at('franchise_admin', outlet_id))
  );

revoke all privileges on public.customer_points_entries from authenticated, anon;
grant select on public.customer_points_entries to authenticated;
grant all on public.customer_points_entries to service_role;

-- The one writer. Under the lock, and a no-op when the row already exists, so a
-- retried command and a trigger fired twice write it once.
create or replace function public.customer_points_write(
  p_outlet uuid,
  p_customer uuid,
  p_bill uuid,
  p_kind public.points_entry_kind,
  p_points integer,
  p_basis bigint default null,
  p_block integer default null,
  p_per_block integer default null,
  p_multiplier integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if p_points = 0 then return; end if;
  perform pg_advisory_xact_lock(
    hashtextextended('points:' || p_outlet::text || ':' || p_customer::text, 0));
  if exists (select 1 from public.customer_points_entries e
              where e.bill_id = p_bill and e.kind = p_kind) then
    return;
  end if;
  select coalesce(sum(e.points), 0)::integer into v_balance
    from public.customer_points_entries e
   where e.outlet_id = p_outlet and e.customer_id = p_customer;
  insert into public.customer_points_entries
    (outlet_id, customer_id, bill_id, kind, points, balance_after,
     earn_basis_paise, earn_block_paise, earn_points_per_block, earn_multiplier_x100)
  values
    (p_outlet, p_customer, p_bill, p_kind, p_points, v_balance + p_points,
     p_basis, p_block, p_per_block, p_multiplier)
  on conflict on constraint customer_points_entries_once_per_bill do nothing;
end;
$$;

-- A customer's balance at an outlet: the sum, and nothing stored.
create or replace function public.customer_points_balance(p_outlet uuid, p_customer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.points), 0)::integer
    from public.customer_points_entries e
   where e.outlet_id = p_outlet and e.customer_id = p_customer
$$;

-- What the till may use: the balance less points already on this customer's
-- open orders here, so two open orders cannot both spend the same points. Null
-- where the outlet has points off.
create or replace function public.customer_points_for_till(p_outlet uuid, p_customer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when o.points_enabled then
           public.customer_points_balance(p_outlet, p_customer)
           - coalesce((
               select (sum(d.amount_paise) / 100)::integer
                 from public.order_discounts d
                 join public.orders r on r.id = d.order_id
                where r.outlet_id = p_outlet
                  and r.customer_id = p_customer
                  and r.status = 'open'
                  and d.source = 'points'), 0)
         end
    from public.outlets o
   where o.id = p_outlet
$$;

-- ---------------------------------------------------------------------------
-- 4. Gold belongs to an outlet, and ends on the date its grant stored (D1, D2).
--
-- #57 made membership global. It is empty in production (2026-09-28), and a
-- membership whose outlet cannot be known is never invented, so this aborts
-- rather than guess. `seed.sql` runs after migrations, so it is empty locally
-- and in CI here too.

do $$
begin
  if exists (select 1 from public.customer_memberships) then
    raise exception 'customer_memberships must be empty: a spell''s outlet cannot be invented';
  end if;
end;
$$;

create type public.gold_grant_route as enum ('management', 'counter');

drop index public.customer_memberships_one_in_force;

alter table public.customer_memberships
  add column outlet_id uuid not null references public.outlets (id),
  add column expires_at timestamptz not null,
  add column granted_via public.gold_grant_route not null default 'management',
  add column counter_device_id uuid references public.counter_devices (id),
  add constraint customer_memberships_ends_after_grant check (expires_at > granted_at),
  add constraint customer_memberships_counter_names_device
    check ((granted_via = 'counter') = (counter_device_id is not null));

create index customer_memberships_outlet_customer_idx
  on public.customer_memberships (outlet_id, customer_id, granted_at desc);

comment on table public.customer_memberships is
  'Spells of gold at one outlet: granted, ending on a stored date, and perhaps '
  'revoked sooner. Never deleted. Written only through security-definer functions.';
comment on column public.customer_memberships.expires_at is
  'When this spell ends: the grant time plus the outlet''s duration AT THE GRANT. '
  'A later change to the setting moves no existing spell.';

-- Outlet-scoped now: the owner and that outlet's Franchise Admins read it. No
-- write policy; grants and revocations go through the functions below.
create policy customer_memberships_select on public.customer_memberships
  for select to authenticated
  using (
    public.app_account_active()
    and (public.app_is_owner() or public.app_has_role_at('franchise_admin', outlet_id))
  );
grant select on public.customer_memberships to authenticated;

-- The spell in force for a customer at an outlet at an instant. Current while
-- not revoked and `granted_at <= t < expires_at`. The outlet's gold switch is
-- not consulted here: a grant must find a spell granted while gold was on.
create or replace function public.customer_gold_spell_at(
  p_customer uuid, p_outlet uuid, p_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.customer_memberships m
   where m.customer_id = p_customer
     and m.outlet_id = p_outlet
     and m.granted_at <= p_at
     and p_at < m.expires_at
     and (m.revoked_at is null or m.revoked_at > p_at)
   order by m.granted_at desc
   limit 1
$$;

-- Whether a customer was gold at an outlet at an instant. With the outlet's gold
-- off nobody is gold there, and spells granted while it was on count again if it
-- comes back on before their own end.
drop function public.customer_tier_at(uuid, timestamptz);

create function public.customer_tier_at(p_customer uuid, p_outlet uuid, p_at timestamptz)
returns public.customer_tier
language sql
stable
security definer
set search_path = ''
as $$
  select 'gold'::public.customer_tier
   where exists (select 1 from public.outlets o where o.id = p_outlet and o.gold_enabled)
     and public.customer_gold_spell_at(p_customer, p_outlet, p_at) is not null
$$;

drop function public.customer_is_member(uuid);

create function public.customer_is_member(p_customer uuid, p_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.customer_tier_at(p_customer, p_outlet, now()) is not null
$$;

-- The snapshot triggers read the row's own outlet: an order at one outlet never
-- reads gold granted at another.
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
      else public.customer_tier_at(new.customer_id, new.outlet_id, new.ordered_at)
    end;
  elsif new.customer_id is distinct from old.customer_id then
    new.customer_tier := case
      when new.customer_id is null then null
      else public.customer_tier_at(new.customer_id, new.outlet_id, coalesce(new.changed_at, now()))
    end;
  else
    new.customer_tier := old.customer_tier;
  end if;
  return new;
end;
$$;

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
      new.customer_id, new.outlet_id,
      coalesce(new.ordered_at, new.paid_at, new.created_at, now()));
  else
    new.customer_tier := null;
  end if;
  return new;
end;
$$;

-- Eligibility (D3): the outlet lets billers grant gold, the customer holds none
-- here, and their settled bills here in the last thirty business dates total at
-- least the threshold. Derived at read time; nothing is stored.
create or replace function public.customer_gold_eligible(p_outlet uuid, p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select o.gold_enabled and o.gold_counter_grant
           and public.customer_gold_spell_at(p_customer, p_outlet, now()) is null
           and coalesce((
             select sum(b.total_paise)
               from public.bills b
              where b.outlet_id = p_outlet
                and b.customer_id = p_customer
                and b.status = 'settled'
                and b.business_date
                    >= public.app_business_date(now(), o.business_day_cutover) - 29
           ), 0) >= o.gold_threshold_paise
      from public.outlets o
     where o.id = p_outlet), false)
$$;

create index bills_outlet_customer_date_idx
  on public.bills (outlet_id, customer_id, business_date) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Earning at acceptance, and a void reversing it (D6, D11).
--
-- **Deferred to commit**, as #53's total guard is, because a bill's discount
-- rows are written after the bill row in the same command. It re-reads the bill,
-- so a bill voided before its own transaction commits earns nothing.
--
-- The `used` row is written whatever the outlet's switch: the points are on the
-- bill and taken off its total, and the ledger records what happened. Earning
-- needs points on **when the bill reaches the server**; settings keep no
-- history, and the rule used is stored on the row.

create or replace function public.bills_points_on_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bills%rowtype;
  v_outlet public.outlets%rowtype;
  v_points_paise bigint;
  v_basis bigint;
  v_multiplier integer;
  v_earned bigint;
begin
  select * into v_bill from public.bills where id = new.id;
  if not found or v_bill.status <> 'settled' or v_bill.customer_id is null then
    return null;
  end if;
  select * into v_outlet from public.outlets where id = v_bill.outlet_id;

  select coalesce(sum(d.amount_paise), 0) into v_points_paise
    from public.bill_discounts d
   where d.bill_id = v_bill.id and d.source = 'points';

  if v_points_paise > 0 then
    perform public.customer_points_write(v_bill.outlet_id, v_bill.customer_id, v_bill.id,
      'used', -(v_points_paise / 100)::integer);
  end if;

  if not v_outlet.points_enabled then
    return null;
  end if;

  -- The bill after every discount except points. Tax is nought in v1; rounding
  -- is not earned on.
  v_basis := greatest(0, v_bill.subtotal_paise - (v_bill.discount_paise - v_points_paise));
  v_multiplier := case when v_bill.customer_tier = 'gold' and v_outlet.gold_enabled
                       then v_outlet.gold_earn_multiplier_x100 else 100 end;
  v_earned := (v_basis * v_outlet.points_earn_per_block * v_multiplier)
              / (v_outlet.points_earn_block_paise::bigint * 100);

  if v_earned > 0 then
    perform public.customer_points_write(v_bill.outlet_id, v_bill.customer_id, v_bill.id,
      'earned', v_earned::integer, v_basis, v_outlet.points_earn_block_paise,
      v_outlet.points_earn_per_block, v_multiplier);
  end if;
  return null;
end;
$$;

create constraint trigger bills_points_on_settle
  after insert on public.bills
  deferrable initially deferred
  for each row
  when (new.customer_id is not null)
  execute function public.bills_points_on_settle();

-- A void takes back what the bill earned and returns what it used, in the
-- voiding transaction, under the same lock and uniqueness. Any `void_kind`.
create or replace function public.bills_points_on_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.customer_points_entries%rowtype;
begin
  for v_entry in
    select * from public.customer_points_entries e
     where e.bill_id = new.id and e.kind in ('earned', 'used')
     order by e.created_at
  loop
    perform public.customer_points_write(v_entry.outlet_id, v_entry.customer_id, new.id,
      case when v_entry.kind = 'earned' then 'earned_reversed'::public.points_entry_kind
           else 'used_returned'::public.points_entry_kind end,
      -v_entry.points);
  end loop;
  return null;
end;
$$;

create trigger bills_points_on_void
  after update of status on public.bills
  for each row
  when (old.status = 'settled' and new.status = 'void')
  execute function public.bills_points_on_void();

-- ---------------------------------------------------------------------------
-- 6. The boundary: payload version 4, and a points row's shape (D8, D9).
--
-- Version 4 adds `source` to a bill-level discount entry and nothing else, so
-- its top-level keys are version 3's. An entry without `source` is the
-- biller's, exactly as every entry before points was.
--
-- **Checked, and refused as `malformed_payload`:** a points row's shape (an
-- amount, whole rupees, value equal to amount), at most one, only with a
-- customer's phone, and never more than the order after other discounts less
-- ₹1. **Not checked: the balance and the cap.** A biller can already take any
-- amount off any bill by hand, so an over-reaching points row gives away
-- nothing the same biller could not; refusing it would refuse a paid sale. The
-- ledger records what happened, and a balance may go negative.

create or replace function public.billing_points_shape_ok(p_payload jsonb, p_schema_version integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- A cast that cannot be made is a malformed row, never an error that loses
  -- the sale: hence the handler rather than guarded casts.
  return coalesce(
    case
      when p_payload -> 'discounts' is null
           or jsonb_typeof(p_payload -> 'discounts') <> 'array' then true
      -- Before version 4 an entry has no source; one that claims one was not
      -- written by the till whose version it names.
      when p_schema_version < 4 then not exists (
        select 1 from jsonb_array_elements(p_payload -> 'discounts') d where d ? 'source')
      else
        not exists (
          select 1 from jsonb_array_elements(p_payload -> 'discounts') d
           where d ? 'source'
             and (jsonb_typeof(d -> 'source') <> 'string'
                  or d ->> 'source' not in ('biller', 'points')))
        and (select count(*) from jsonb_array_elements(p_payload -> 'discounts') d
              where d ->> 'source' = 'points') <= 1
        and not exists (
          select 1 from jsonb_array_elements(p_payload -> 'discounts') d
           where d ->> 'source' = 'points'
             and (d ->> 'basis' is distinct from 'amount'
                  or jsonb_typeof(d -> 'valuePaise') <> 'number'
                  or jsonb_typeof(d -> 'amountPaise') <> 'number'
                  or (d ->> 'amountPaise') !~ '^[0-9]+$'
                  or (d ->> 'valuePaise') !~ '^[0-9]+$'
                  or (d ->> 'valuePaise')::numeric <> (d ->> 'amountPaise')::numeric
                  or (d ->> 'amountPaise')::numeric % 100 <> 0
                  or coalesce(btrim(p_payload ->> 'customerPhone'), '') = ''
                  -- Never more than the order after other discounts, less ₹1.
                  or (d ->> 'amountPaise')::numeric
                     > (p_payload ->> 'subtotalPaise')::numeric
                       - ((p_payload ->> 'discountPaise')::numeric
                          - (d ->> 'amountPaise')::numeric)
                       - 100))
    end,
    false);
exception when others then
  return false;
end;
$$;


-- The four content commands, reproduced from
-- `20260928000000_orders_carry_how_they_were_served.sql` with the same two
-- changes each: the points shape checked beside the payload's other types, and
-- each bill-level discount's `source` written (absent is the biller's). Paying
-- an order carries the source across with the rest of the row.

-- The envelope accepts version 4, whose top-level keys are version 3's. The
-- signature is unchanged, so this is a replacement rather than an overload.
create or replace function public.billing_envelope_error(
  p_command_id uuid,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_payload jsonb,
  p_keys text[],
  p_extra_keys text[] default '{}'::text[],
  p_v3_keys text[] default '{}'::text[]
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_shape_ok boolean;
begin
  if p_schema_version is null or p_schema_version not in (1, 2, 3, 4) then
    return case when p_schema_version is null then 'malformed_payload'
                else 'unsupported_schema' end;
  end if;
  if p_command_id is null or p_payload_hash is null
     or p_created_at is null or p_payload is null then
    return 'malformed_payload';
  end if;

  -- The version names the shape, so an envelope carrying another version's keys
  -- is malformed rather than quietly accepted: the hash was computed over one of
  -- them and only one can be right.
  v_shape_ok := case p_schema_version
    when 1 then public.billing_payload_has_keys(p_payload, p_keys)
    when 2 then public.billing_payload_has_keys(p_payload, p_keys || p_extra_keys)
    -- Version 4 adds a field inside a discount entry, and no top-level key.
    else public.billing_payload_has_keys(p_payload, p_keys || p_extra_keys || p_v3_keys)
  end;

  if not v_shape_ok then
    return 'malformed_payload';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$'
     or p_payload_hash <> public.billing_payload_hash(p_payload) then
    return 'malformed_payload';
  end if;
  if p_created_at > now() + interval '5 minutes' then
    return 'malformed_payload';
  end if;
  return null;
end;
$$;

create or replace function public.create_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text;
  v_context jsonb;
  v_claim jsonb;
  v_existing public.billing_commands%rowtype;
  v_outlet uuid;
  v_actor uuid;
  v_order uuid;
  v_customer uuid;
  v_date date;
  v_number bigint;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version,
    p_payload_hash, p_created_at, p_payload, array[
      'orderId','businessDate','customerId','customerName','customerPhone',
      'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;

  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  v_outlet := (v_context ->> 'outletId')::uuid;
  v_actor := (v_context ->> 'actorId')::uuid;

  select * into v_existing
    from public.billing_commands
   where id = p_command_id;
  if found then
    if v_existing.command_type is distinct from 'create_order'
       or v_existing.schema_version is distinct from p_schema_version
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.client_created_at is distinct from p_created_at
       or v_existing.outlet_id is distinct from v_outlet
       or v_existing.device_id is distinct from auth.uid()
       or v_existing.shift_id is distinct from p_shift_id
       or v_existing.actor_id is distinct from v_actor then
      return jsonb_build_object('status','identity_conflict','commandId',p_command_id);
    end if;
    if v_existing.result_category = 'accepted' then
      return jsonb_set(v_existing.result, '{status}', '"replay"'::jsonb, true);
    end if;
    return v_existing.result;
  end if;

  begin
    v_order := (p_payload ->> 'orderId')::uuid;
    v_date := (p_payload ->> 'businessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;

  if v_order is null or v_date is null
     or not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
    return jsonb_build_object('status','malformed_payload');
  end if;

  if v_date is distinct from (select public.app_business_date(
      p_created_at, business_day_cutover) from public.outlets where id = v_outlet) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_discounts(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload -> 'lines', v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;

  v_claim := public.billing_begin_command(p_command_id, 'create_order', p_schema_version,
    p_payload_hash, p_created_at, v_outlet, auth.uid(), p_shift_id, v_actor);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||':'||v_date::text,0));
  perform set_config('app.billing_command','1',true);
  begin
    v_number := public.billing_next_order_number(v_outlet, v_date);
    insert into public.orders (
      id, outlet_id, order_number, device_id, created_by, created_shift_id,
      ordered_at, business_date, customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise, pricing_mode,
      service_type, table_number)
    values (
      v_order, v_outlet, v_number, auth.uid(), v_actor, p_shift_id,
      p_created_at, v_date, v_customer,
      nullif(p_payload ->> 'customerName',''), nullif(p_payload ->> 'customerPhone',''),
      (p_payload ->> 'subtotalPaise')::bigint,
      (p_payload ->> 'discountPaise')::bigint,
      (p_payload ->> 'taxPaise')::bigint,
      coalesce((p_payload ->> 'roundingPaise')::bigint, 0),
      (p_payload ->> 'totalPaise')::bigint,
      (p_payload ->> 'pricingMode')::public.pricing_mode,
      (p_payload ->> 'serviceType')::public.service_type,
      (p_payload ->> 'tableNumber')::smallint);

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise,
       discount_paise, discount_percent_bp, category_name, kind)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName',''),
      coalesce(line ->> 'kind', 'item')::public.line_kind
      from jsonb_array_elements(p_payload -> 'lines') line;

    insert into public.order_discounts (order_id, outlet_id, basis, value_bp, value_paise, amount_paise, source)
    select v_order, v_outlet, (d ->> 'basis')::public.discount_basis,
      nullif(d ->> 'valueBp','')::integer, nullif(d ->> 'valuePaise','')::bigint,
      (d ->> 'amountPaise')::bigint,
      coalesce(d ->> 'source', 'biller')::public.discount_row_source
      from jsonb_array_elements(coalesce(p_payload -> 'discounts', '[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id), v_date);
  end;
  v_result := jsonb_build_object('status','accepted','commandId',p_command_id,
    'orderId',v_order,'orderNumber',v_number,'delayed',(v_context ->> 'delayed')::boolean);
  return public.billing_finish_command(p_command_id, v_result, v_date);
end;
$$;

create or replace function public.revise_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text;
  v_context jsonb;
  v_claim jsonb;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_payload_date date;
  v_customer uuid;
  v_affected integer;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,
    p_created_at,p_payload,array['orderId','businessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context := public.billing_device_context(p_shift_id,p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  if not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_discounts(p_payload),false) then
    return jsonb_build_object('status','arithmetic_invalid','orderId',v_order.id,'orderNumber',v_order.order_number);
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_payload_date:=(p_payload->>'businessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_payload_date is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_claim := public.billing_begin_command(p_command_id,'revise_order',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id));
  end if;
  if v_order.status <> 'open' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,'orderStatus',v_order.status,'commandId',p_command_id),
      v_order.business_date);
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),v_order.business_date);
  end if;
  if v_payload_date <> v_order.business_date
     or not coalesce(public.billing_validate_lines(
       p_payload->'lines',v_order.outlet_id,v_order.id),false) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  begin
  -- A version-1 or version-2 revision carries no type or table, and so leaves
  -- the order's as they are rather than clearing them: it was written by a
  -- till that could not have meant to change what it did not know about.
  update public.orders set
    customer_id=v_customer,
    customer_name=nullif(p_payload->>'customerName',''),
    customer_phone=nullif(p_payload->>'customerPhone',''),
    subtotal_paise=(p_payload->>'subtotalPaise')::bigint,
    discount_paise=(p_payload->>'discountPaise')::bigint,
    tax_paise=(p_payload->>'taxPaise')::bigint,
    rounding_paise=coalesce((p_payload->>'roundingPaise')::bigint,0),
    total_paise=(p_payload->>'totalPaise')::bigint,
    pricing_mode=(p_payload->>'pricingMode')::public.pricing_mode,
    service_type=case when p_schema_version >= 3
                      then (p_payload->>'serviceType')::public.service_type
                      else service_type end,
    table_number=case when p_schema_version >= 3
                      then (p_payload->>'tableNumber')::smallint
                      else table_number end,
    changed_by=(v_context->>'actorId')::uuid,changed_shift_id=p_shift_id,changed_at=p_created_at
    where id=v_order.id;
  delete from public.order_items i where i.order_id=v_order.id
    and not exists (select 1 from jsonb_array_elements(p_payload->'lines') line
      where (line->>'id')::uuid=i.id);
  insert into public.order_items
    (id,order_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
     discount_paise,discount_percent_bp,category_name,kind)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint,
    coalesce((line->>'discountPaise')::bigint,0),
    nullif(line->>'discountPercentBp','')::integer,
    nullif(line->>'categoryName',''),
    coalesce(line->>'kind','item')::public.line_kind
    from jsonb_array_elements(p_payload->'lines') line
  on conflict (id) do update set quantity=excluded.quantity,line_total_paise=excluded.line_total_paise,
    discount_paise=excluded.discount_paise,discount_percent_bp=excluded.discount_percent_bp,
    category_name=excluded.category_name
    where public.order_items.order_id=excluded.order_id;
  get diagnostics v_affected = row_count;
  if v_affected <> jsonb_array_length(p_payload->'lines') then
    raise unique_violation;
  end if;

  -- An order's bill-level discounts are replaced wholesale, exactly as its
  -- lines are: a revision states the whole order, not a difference from it.
  delete from public.order_discounts where order_id = v_order.id;
  insert into public.order_discounts (order_id,outlet_id,basis,value_bp,value_paise,amount_paise,source)
  select v_order.id,v_order.outlet_id,(d->>'basis')::public.discount_basis,
    nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
    (d->>'amountPaise')::bigint,
    coalesce(d->>'source','biller')::public.discount_row_source
    from jsonb_array_elements(coalesce(p_payload->'discounts','[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_order.business_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
end;
$$;

create or replace function public.pay_billing_order(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_order public.orders%rowtype;
  v_paid_at timestamptz; v_payment_date date; v_bill uuid; v_order_id uuid;
  v_number bigint; v_result jsonb; v_line_sum bigint; v_summary public.payment_method;
begin
  -- This payload carries no totals and no service facts: paying an order
  -- settles it at what it was saved with. So its shape is unchanged, and all
  -- three schema versions describe the same keys.
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','orderId','payments','paidAt','paymentBusinessDate']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'payments')<>'array'
     or jsonb_typeof(p_payload->'paidAt')<>'string'
     or jsonb_typeof(p_payload->'paymentBusinessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_bill:=(p_payload->>'billId')::uuid; v_order_id:=(p_payload->>'orderId')::uuid;
    v_paid_at:=(p_payload->>'paidAt')::timestamptz;
    v_payment_date:=(p_payload->>'paymentBusinessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_bill is null or v_order_id is null or v_paid_at is null or v_payment_date is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if abs(extract(epoch from (v_paid_at-p_created_at)))>300
     or v_payment_date is distinct from (select public.app_business_date(v_paid_at,business_day_cutover)
       from public.outlets where id=(v_context->>'outletId')::uuid) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'pay_order',p_schema_version,p_payload_hash,
    p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_order.status<>'open' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date,v_payment_date);
  end if;
  if v_paid_at<v_order.ordered_at or p_created_at<v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),
      v_order.business_date,v_payment_date);
  end if;
  select coalesce(sum(line_total_paise),0) into v_line_sum from public.order_items where order_id=v_order.id;
  if v_line_sum<>v_order.subtotal_paise or v_order.total_paise<0
     or v_order.total_paise<>v_order.subtotal_paise-v_order.discount_paise+v_order.tax_paise+v_order.rounding_paise
     or not coalesce(public.billing_validate_payments(p_payload->'payments',v_order.total_paise),false) then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','arithmetic_invalid','orderId',v_order.id,'orderNumber',v_order.order_number),
      v_order.business_date,v_payment_date);
  end if;
  if jsonb_array_length(p_payload->'payments')=1 then
    v_summary:=((p_payload->'payments'->0)->>'method')::public.payment_method;
  end if;
  perform set_config('app.billing_command','1',true);
  insert into public.bills (
    id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
    biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
    customer_phone,subtotal_paise,discount_paise,tax_paise,rounding_paise,total_paise,pricing_mode,
    payment_method,status,created_at,synced_at,service_type,table_number)
  values (v_bill,v_order.outlet_id,v_order.business_date,v_payment_date,v_order.ordered_at,v_paid_at,
    v_order.id,(v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_order.customer_id,
    v_order.customer_name,v_order.customer_phone,v_order.subtotal_paise,v_order.discount_paise,
    v_order.tax_paise,v_order.rounding_paise,v_order.total_paise,v_order.pricing_mode,v_summary,'settled',now(),now(),
    v_order.service_type,v_order.table_number)
  returning bill_number into v_number;
  insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
    select v_bill,v_order.outlet_id,(payment->>'method')::public.payment_method,
      (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
  insert into public.bill_items (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,
    line_total_paise,discount_paise,discount_percent_bp,category_name,kind)
    select gen_random_uuid(),v_bill,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
      discount_paise,discount_percent_bp,category_name,kind
      from public.order_items where order_id=v_order.id order by id;
  -- Carried across with the lines, so the bill explains its own discount without
  -- reaching back to an order that is now history.
  insert into public.bill_discounts (bill_id,outlet_id,basis,value_bp,value_paise,amount_paise,source)
    select v_bill,v_order.outlet_id,basis,value_bp,value_paise,amount_paise,source
      from public.order_discounts where order_id=v_order.id order by id;
  update public.orders set status='paid',paid_by=(v_context->>'actorId')::uuid,
    paid_shift_id=p_shift_id,paid_at=v_paid_at,bill_id=v_bill where id=v_order.id;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'billId',v_bill,'billNumber',v_number,
    'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date,v_payment_date);
end;
$$;

create or replace function public.pay_billing_now(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_outlet uuid; v_bill uuid; v_customer uuid;
  v_summary public.payment_method; v_date date; v_payment_date date; v_number bigint; v_result jsonb;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','businessDate','paymentBusinessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode',
      'payments','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string'
     or jsonb_typeof(p_payload->'paymentBusinessDate')<>'string'
     or jsonb_typeof(p_payload->'payments')<>'array' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_outlet:=(v_context->>'outletId')::uuid; v_bill:=(p_payload->>'billId')::uuid;
    v_date:=(p_payload->>'businessDate')::date;
    v_payment_date:=(p_payload->>'paymentBusinessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_outlet is null or v_bill is null or v_date is null or v_payment_date is null
     or not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if v_date is distinct from (select public.app_business_date(p_created_at,business_day_cutover)
      from public.outlets where id=v_outlet) or v_payment_date is distinct from v_date then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_discounts(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload->'lines',v_outlet),false)
     or not coalesce(public.billing_validate_payments(
       p_payload->'payments',(p_payload->>'totalPaise')::bigint),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;
  if jsonb_array_length(p_payload->'payments')=1 then
    v_summary:=((p_payload->'payments'->0)->>'method')::public.payment_method;
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'pay_now',p_schema_version,p_payload_hash,
    p_created_at,v_outlet,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  perform set_config('app.billing_command','1',true);
  begin
    insert into public.bills (
      id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
      biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
      customer_phone,subtotal_paise,discount_paise,tax_paise,rounding_paise,total_paise,pricing_mode,
      payment_method,status,created_at,synced_at,service_type,table_number)
    values (v_bill,v_outlet,v_date,v_payment_date,p_created_at,p_created_at,null,
      (v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_customer,
      nullif(p_payload->>'customerName',''),nullif(p_payload->>'customerPhone',''),
      (p_payload->>'subtotalPaise')::bigint,(p_payload->>'discountPaise')::bigint,
      (p_payload->>'taxPaise')::bigint,coalesce((p_payload->>'roundingPaise')::bigint,0),
      (p_payload->>'totalPaise')::bigint,
      (p_payload->>'pricingMode')::public.pricing_mode,v_summary,'settled',now(),now(),
      (p_payload->>'serviceType')::public.service_type,
      (p_payload->>'tableNumber')::smallint)
    returning bill_number into v_number;
    insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
      select v_bill,v_outlet,(payment->>'method')::public.payment_method,
        (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
    insert into public.bill_items
      (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
       discount_paise,discount_percent_bp,category_name,kind)
    select (line->>'id')::uuid,v_bill,nullif(line->>'menuItemId','')::uuid,line->>'itemName',
      (line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
      (line->>'lineTotalPaise')::bigint,
      coalesce((line->>'discountPaise')::bigint,0),
      nullif(line->>'discountPercentBp','')::integer,
      nullif(line->>'categoryName',''),
      coalesce(line->>'kind','item')::public.line_kind
      from jsonb_array_elements(p_payload->'lines') line;
    insert into public.bill_discounts (bill_id,outlet_id,basis,value_bp,value_paise,amount_paise,source)
    select v_bill,v_outlet,(d->>'basis')::public.discount_basis,
      nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
      (d->>'amountPaise')::bigint,
      coalesce(d->>'source','biller')::public.discount_row_source
      from jsonb_array_elements(coalesce(p_payload->'discounts','[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_date,v_payment_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'billId',v_bill,
    'billNumber',v_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_date,v_payment_date);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. What the till is told, and the counter's grant (D3, D4, D10).
--
-- Each lookup answers **for the caller's own outlet**, taken from its live shift
-- and never from an argument: whether the customer is gold here, their points
-- balance here net of points on their open orders here (null with points off),
-- and whether they are eligible for gold here — a yes or no, never the spend
-- behind it. No date, no actor, no visits, no other outlet. Everything else
-- about both boundaries — the exact match, the outlet-scoped one-match
-- suggestion, the rate bound, the attempt record holding nothing about what was
-- asked — is #32's and #57's, unchanged.

drop function public.customer_lookup_by_phone(text);

create function public.customer_lookup_by_phone(p_phone text)
returns table (
  id uuid, phone text, name text, is_member boolean,
  points_balance integer, gold_eligible boolean)
language plpgsql
-- Volatile: recording the attempt is a write.
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_outlet uuid;
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
  v_outlet := public.app_billing_outlet();

  return query
    select c.id, c.phone, c.name,
           coalesce(public.customer_is_member(c.id, v_outlet), false),
           public.customer_points_for_till(v_outlet, c.id),
           coalesce(public.customer_gold_eligible(v_outlet, c.id), false)
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

drop function public.customer_create_or_get(text, text);

create function public.customer_create_or_get(
  p_phone text,
  p_name text default null
)
returns table (
  id uuid, phone text, name text, is_member boolean,
  points_balance integer, gold_eligible boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_name text;
  v_outlet uuid;
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
  v_outlet := public.app_billing_outlet();

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  insert into public.customers (phone, name)
  values (v_canonical, v_name)
  on conflict on constraint customers_phone_key do nothing;
  update public.customers c
     set last_used_at = now()
   where c.phone = v_canonical;

  return query
    select c.id, c.phone, c.name,
           coalesce(public.customer_is_member(c.id, v_outlet), false),
           public.customer_points_for_till(v_outlet, c.id),
           coalesce(public.customer_gold_eligible(v_outlet, c.id), false)
      from public.customers c
     where c.phone = v_canonical;
end;
$$;

drop function public.customer_suggest_at_outlet(text);

-- See 20260920000000 for why the outlet scope is the whole of this function's
-- safety and the three rules a later change must not relax.
create function public.customer_suggest_at_outlet(p_partial text)
returns table (
  id uuid, phone text, name text, other_matches integer, is_member boolean,
  points_balance integer, gold_eligible boolean)
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
         public.customer_is_member(counted.cid, v_outlet),
         public.customer_points_for_till(v_outlet, counted.cid),
         public.customer_gold_eligible(v_outlet, counted.cid)
    from counted
   order by counted.served_at desc
   limit 1;
end;
$$;

-- Upgrading an eligible customer to Gold at the counter (D4).
--
-- The outlet, the device and the operator all come from the caller's live
-- shift. Eligibility is decided again here, inside the transaction, and the
-- tablet's cached flag is never a permission. A second tap after success finds
-- the spell current and answers as success did. Online only, never queued, and
-- there is no counter revoke. Shaped for a price later: a price would be a
-- column on the spell and a charge in this same transaction.
create or replace function public.customer_gold_grant_at_counter(p_customer uuid)
returns table (
  id uuid, phone text, name text, is_member boolean,
  points_balance integer, gold_eligible boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_device uuid;
  v_operator uuid;
  v_months integer;
  v_now timestamptz := now();
begin
  select d.outlet_id, s.device_id, s.person_id
    into v_outlet, v_device, v_operator
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
         and d.session_proven_at is not null
   where s.ended_at is null
     and s.expires_at > now()
     and (
       s.device_id = auth.uid()
       or (s.person_id = auth.uid() and public.app_account_active())
     )
   limit 1;
  if v_outlet is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.customers c where c.id = p_customer;
  if not found then
    raise exception 'no such customer' using errcode = 'no_data_found';
  end if;

  -- One current spell per customer per outlet: grants serialise here.
  perform pg_advisory_xact_lock(
    hashtextextended('gold:' || v_outlet::text || ':' || p_customer::text, 0));

  if public.customer_gold_spell_at(p_customer, v_outlet, v_now) is null then
    if not public.customer_gold_eligible(v_outlet, p_customer) then
      raise exception 'not eligible for gold here' using errcode = 'check_violation';
    end if;
    select o.gold_duration_months into v_months from public.outlets o where o.id = v_outlet;
    insert into public.customer_memberships
      (customer_id, outlet_id, granted_at, granted_by, expires_at, granted_via, counter_device_id)
    values
      (p_customer, v_outlet, v_now, v_operator,
       v_now + make_interval(months => v_months), 'counter', v_device);
  end if;

  return query
    select c.id, c.phone, c.name,
           public.customer_is_member(c.id, v_outlet),
           public.customer_points_for_till(v_outlet, c.id),
           public.customer_gold_eligible(v_outlet, c.id)
      from public.customers c
     where c.id = p_customer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The management path, one outlet at a time (D13).
--
-- Every read and write names the outlet the Customers page has chosen, and is
-- authorised for it: the owner, or a Franchise Admin of that outlet, on a live
-- account. The customers an outlet may see are the ones it has served, on an
-- order or a bill, or holds gold for. Search, both lists and the card all read
-- that outlet's bills, and none decides reach for itself.
--
-- Renaming keeps #57's whole-history rule: the name is the person's at every
-- outlet, so a manager renames only a customer served nowhere but their own
-- outlets. Gold is this outlet's, so a manager grants and revokes it for any
-- customer this outlet has served.

create or replace function public.customer_directory_require_outlet(p_outlet uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

drop function public.customer_directory_reach(uuid[]);

create function public.customer_directory_reach(p_outlet uuid)
returns table (customer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.customer_id from public.bills b
   where b.outlet_id = p_outlet and b.customer_id is not null
  union
  select o.customer_id from public.orders o
   where o.outlet_id = p_outlet and o.customer_id is not null
  union
  select m.customer_id from public.customer_memberships m
   where m.outlet_id = p_outlet
$$;

drop function public.customer_directory_activity(uuid[]);

-- What each customer did at this outlet. One settled bill is one visit; a void
-- counts for nothing. The window is the last thirty business dates here.
create function public.customer_directory_activity(p_outlet uuid)
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
     and b.outlet_id = p_outlet
   group by b.customer_id
$$;

-- The spell in force here for display: none at an outlet with gold off.
create or replace function public.customer_directory_spell(p_outlet uuid, p_customer uuid)
returns public.customer_memberships
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.customer_memberships m
    join public.outlets o on o.id = m.outlet_id and o.gold_enabled
   where m.id = public.customer_gold_spell_at(p_customer, p_outlet, now())
$$;

drop function public.customer_directory_card(uuid);

create function public.customer_directory_card(p_outlet uuid, p_customer uuid)
returns table (
  id uuid,
  phone text,
  name text,
  member_since timestamptz,
  member_until timestamptz,
  granted_via text,
  granted_by_name text,
  points_balance integer,
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
  v_points_on boolean;
begin
  perform public.customer_directory_require_outlet(p_outlet);
  -- For the rename rule only: null for the owner, else the manager's outlets.
  v_outlets := public.app_customer_directory_outlets();
  select o.points_enabled into v_points_on from public.outlets o where o.id = p_outlet;

  return query
    with spell as (
      select s.* from public.customer_directory_spell(p_outlet, p_customer) s
       where s.id is not null
    ),
    balance as (
      select public.customer_points_balance(p_outlet, p_customer) as points
    )
    select c.id, c.phone, c.name,
           (select spell.granted_at from spell),
           (select spell.expires_at from spell),
           (select spell.granted_via::text from spell),
           (select p.full_name from spell join public.profiles p on p.id = spell.granted_by),
           -- A balance an outlet holds is still read after it turns points off:
           -- the points did not disappear with the switch.
           (select case when v_points_on or balance.points <> 0 then balance.points end
              from balance),
           coalesce(a.visits_30d, 0),
           coalesce(a.spend_30d_paise, 0::bigint),
           a.last_seen_at,
           -- The first visit at this outlet: every figure on the card is this
           -- outlet's, so a business-wide date would be the odd one out.
           coalesce(
             a.first_seen_at,
             (select min(o.ordered_at) from public.orders o
               where o.customer_id = c.id and o.outlet_id = p_outlet),
             c.created_at),
           case when v_outlets is null then 'business' else 'outlets' end,
           public.customer_directory_may_edit(c.id, v_outlets)
      from public.customers c
      left join public.customer_directory_activity(p_outlet) a on a.customer_id = c.id
     where c.id = p_customer
       and c.id in (select r.customer_id from public.customer_directory_reach(p_outlet) r);
end;
$$;

drop function public.customer_directory_list(text, integer);

-- A page at a time; twenty-one rows so the caller knows whether there is a next
-- page. Every order is total, down to the id.
--
--   regulars — seen here in the last thirty days, most visits first, then the
--              most recent visit;
--   members  — gold here now, newest grant first, or (p_order = 'visits') most
--              visits here in the last thirty days first, then the most recent.
create function public.customer_directory_list(
  p_outlet uuid, p_list text, p_offset integer default 0, p_order text default 'newest')
returns table (
  id uuid, phone text, name text, is_member boolean, member_until timestamptz,
  visits_30d integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.customer_directory_require_outlet(p_outlet);
  if p_list is null or p_list not in ('regulars', 'members')
     or p_order is null or p_order not in ('newest', 'visits')
     or p_offset is null or p_offset < 0 then
    raise exception 'unknown list or page' using errcode = 'invalid_parameter_value';
  end if;

  if p_list = 'members' then
    return query
      with current_spells as (
        select m.customer_id, m.granted_at, m.expires_at
          from public.customer_memberships m
          join public.outlets o on o.id = m.outlet_id and o.gold_enabled
         where m.outlet_id = p_outlet
           and m.id = public.customer_gold_spell_at(m.customer_id, p_outlet, now())
      )
      select c.id, c.phone, c.name, true, s.expires_at, coalesce(a.visits_30d, 0)
        from current_spells s
        join public.customers c on c.id = s.customer_id
        left join public.customer_directory_activity(p_outlet) a on a.customer_id = c.id
       order by
         case when p_order = 'visits' then coalesce(a.visits_30d, 0) end desc nulls last,
         case when p_order = 'visits' then a.last_seen_at end desc nulls last,
         case when p_order = 'newest' then s.granted_at end desc nulls last,
         c.id
      offset p_offset limit 21;
  else
    return query
      select c.id, c.phone, c.name,
             public.customer_is_member(c.id, p_outlet),
             (select s.expires_at from public.customer_directory_spell(p_outlet, c.id) s),
             a.visits_30d
        from public.customer_directory_activity(p_outlet) a
        join public.customers c on c.id = a.customer_id
       where a.visits_30d > 0
       order by a.visits_30d desc, a.last_seen_at desc nulls last, c.id
      offset p_offset limit 21;
  end if;
end;
$$;

drop function public.customer_directory_search(text);

-- As #57 read a query (`src/domain/customer-search.ts`), among the customers
-- this outlet has served.
create function public.customer_directory_search(p_outlet uuid, p_query text)
returns table (
  id uuid, phone text, name text, is_member boolean, member_until timestamptz,
  visits_30d integer, matched integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_digits text;
  v_needle text;
  v_exact text;
  v_loose text;
begin
  perform public.customer_directory_require_outlet(p_outlet);

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
    select r.customer_id from public.customer_directory_reach(p_outlet) r
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
  hits as (
    select * from exact union all select * from loose
  ),
  counted as (
    select hits.cid, hits.strength, count(*) over () as total from hits
  )
  select c.id, c.phone, c.name, public.customer_is_member(c.id, p_outlet),
         (select s.expires_at from public.customer_directory_spell(p_outlet, c.id) s),
         coalesce(a.visits_30d, 0), counted.total::integer
    from counted
    join public.customers c on c.id = counted.cid
    left join public.customer_directory_activity(p_outlet) a on a.customer_id = c.id
   order by counted.strength, a.last_seen_at desc nulls last, c.id
   limit 20;
end;
$$;

-- The customer, locked, and within this outlet's reach; absent reads as nobody.
drop function public.customer_directory_require_editable(uuid);

create function public.customer_directory_require_reach(p_outlet uuid, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.customer_directory_require_outlet(p_outlet);
  perform 1 from public.customers c where c.id = p_customer for update;
  if not found
     or p_customer not in (select r.customer_id from public.customer_directory_reach(p_outlet) r) then
    raise exception 'no such customer' using errcode = 'no_data_found';
  end if;
end;
$$;

drop function public.customer_rename(uuid, text);

-- A correction to the saved profile only. The customer row is locked first, the
-- row a sale's resolve updates at any outlet, so "served nowhere else" is
-- decided at the moment of the write.
create function public.customer_rename(p_outlet uuid, p_customer uuid, p_name text)
returns table (
  id uuid, phone text, name text, member_since timestamptz, member_until timestamptz,
  granted_via text, granted_by_name text, points_balance integer, visits_30d integer,
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
  perform public.customer_directory_require_reach(p_outlet, p_customer);
  if not public.customer_directory_may_edit(p_customer, public.app_customer_directory_outlets()) then
    raise exception 'this customer is also served at another outlet'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null then
    raise exception 'a name cannot be left empty' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers c set name = v_name where c.id = p_customer;
  return query select * from public.customer_directory_card(p_outlet, p_customer);
end;
$$;

drop function public.customer_membership_grant(uuid);

-- Gold here, by the owner or this outlet's manager, for any customer this outlet
-- has served. Eligibility is not asked: the owner and managers can make anybody
-- gold by hand. A second tap finds the spell current and changes nothing.
create function public.customer_membership_grant(p_outlet uuid, p_customer uuid)
returns table (
  id uuid, phone text, name text, member_since timestamptz, member_until timestamptz,
  granted_via text, granted_by_name text, points_balance integer, visits_30d integer,
  spend_30d_paise bigint, last_seen_at timestamptz, customer_since timestamptz,
  scope text, editable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
  v_gold boolean;
  v_now timestamptz := now();
begin
  perform public.customer_directory_require_reach(p_outlet, p_customer);
  select o.gold_enabled, o.gold_duration_months into v_gold, v_months
    from public.outlets o where o.id = p_outlet;
  if not v_gold then
    raise exception 'this outlet does not have gold members' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('gold:' || p_outlet::text || ':' || p_customer::text, 0));
  if public.customer_gold_spell_at(p_customer, p_outlet, v_now) is null then
    insert into public.customer_memberships
      (customer_id, outlet_id, granted_at, granted_by, expires_at, granted_via)
    values
      (p_customer, p_outlet, v_now, auth.uid(),
       v_now + make_interval(months => v_months), 'management');
  end if;
  return query select * from public.customer_directory_card(p_outlet, p_customer);
end;
$$;

drop function public.customer_membership_revoke(uuid);

-- Ends the spell in force here and keeps it.
create function public.customer_membership_revoke(p_outlet uuid, p_customer uuid)
returns table (
  id uuid, phone text, name text, member_since timestamptz, member_until timestamptz,
  granted_via text, granted_by_name text, points_balance integer, visits_30d integer,
  spend_30d_paise bigint, last_seen_at timestamptz, customer_since timestamptz,
  scope text, editable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gold boolean;
begin
  perform public.customer_directory_require_reach(p_outlet, p_customer);
  select o.gold_enabled into v_gold from public.outlets o where o.id = p_outlet;
  if not v_gold then
    raise exception 'this outlet does not have gold members' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('gold:' || p_outlet::text || ':' || p_customer::text, 0));
  update public.customer_memberships m
     set revoked_at = now(), revoked_by = auth.uid()
   where m.id = public.customer_gold_spell_at(p_customer, p_outlet, now());
  return query select * from public.customer_directory_card(p_outlet, p_customer);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The receipt's figures (D14).
--
-- A points row reads as its own row, `source = 'points'`, among the bill's own
-- discount rows, so the printed rows still add up to the stored discount. And
-- beneath them, the bill's three ledger figures: what it used, what it earned,
-- and the balance its last row stored. Nothing is recomputed, and nothing names
-- the customer. A voided bill keeps the figures it was sold with.

create or replace function public.bill_public_discount_rows(p_bill_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with menu as (
    select
      case when i.discount_percent_bp is not null
           then 'p' || i.discount_percent_bp::text
           else 'a' || round(i.discount_paise::numeric / greatest(1, i.quantity))::text
      end as grouping_key,
      min(i.discount_percent_bp) as value_bp,
      case when min(i.discount_percent_bp) is not null then null
           else round(min(i.discount_paise)::numeric
                      / greatest(1, min(i.quantity)))::bigint
      end as value_paise,
      array_remove(array_agg(distinct i.category_name), null) as categories,
      sum(i.discount_paise)::bigint as amount_paise
    from public.bill_items i
   where i.bill_id = p_bill_id
     and i.discount_paise > 0
     and i.kind = 'item'
   group by 1, i.discount_percent_bp
  ),
  menu_rows as (
    select jsonb_build_object(
      'source', 'menu',
      'basis', case when value_bp is not null then 'percent' else 'amount' end,
      'value_bp', value_bp,
      'value_paise', value_paise,
      'categories', to_jsonb(categories),
      'amount_paise', amount_paise) as row,
      grouping_key as sort_key
    from menu
  ),
  packaging_rows as (
    select jsonb_build_object(
      'source', 'packaging',
      'basis', 'percent',
      'value_bp', i.discount_percent_bp,
      'value_paise', null,
      'categories', '[]'::jsonb,
      'amount_paise', i.discount_paise) as row,
      '' as sort_key
    from public.bill_items i
   where i.bill_id = p_bill_id
     and i.kind = 'packaging'
     and i.discount_paise > 0
  ),
  bill_rows as (
    select jsonb_build_object(
      'source', case when d.source = 'points' then 'points' else 'bill' end,
      'basis', d.basis,
      'value_bp', d.value_bp,
      'value_paise', d.value_paise,
      'categories', '[]'::jsonb,
      'amount_paise', d.amount_paise) as row,
      -- The biller's rows first, then the points: points are taken last.
      (case when d.source = 'points' then '1' else '0' end) || d.created_at::text as sort_key
    from public.bill_discounts d
   where d.bill_id = p_bill_id
  )
  select coalesce(jsonb_agg(row order by source_rank, sort_key), '[]'::jsonb)
    from (
      select row, sort_key, 0 as source_rank from menu_rows
      union all
      select row, sort_key, 1 as source_rank from packaging_rows
      union all
      select row, sort_key, 2 as source_rank from bill_rows
    ) ordered;
$$;

-- The bill's three figures, or null when it has no ledger rows.
create or replace function public.bill_public_points(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 0 then null else jsonb_build_object(
           'used', coalesce(-sum(e.points) filter (where e.kind = 'used'), 0),
           'earned', coalesce(sum(e.points) filter (where e.kind = 'earned'), 0),
           'balance', (select l.balance_after
                         from public.customer_points_entries l
                        where l.bill_id = p_bill_id and l.kind in ('earned', 'used')
                        order by case when l.kind = 'earned' then 1 else 0 end desc,
                                 l.created_at desc
                        limit 1))
         end
    from public.customer_points_entries e
   where e.bill_id = p_bill_id and e.kind in ('earned', 'used')
$$;


create or replace function public.bill_public_receipt(
  p_token text,
  p_client_address text default null,
  p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
  v_salt text;
  v_receipt jsonb;
begin
  select s.viewer_salt into v_salt
    from public.public_receipt_settings s
   where s.enabled;

  -- Switched off, or the row is somehow gone: refuse, in the same words as
  -- every other refusal.
  if v_salt is null then
    return null;
  end if;

  -- The only selection in the function. A malformed or empty token simply
  -- matches nothing, which is why there is no separate validation branch to
  -- answer differently.
  select l.bill_id into v_bill_id
    from public.bill_public_links l
   where l.token = p_token
     and l.revoked_at is null;

  if v_bill_id is null then
    -- **No write.** A flood of invalid tokens must not become a flood of
    -- inserts; that amplification is the edge's to absorb, and a write here
    -- would hand an attacker the lever.
    return null;
  end if;

  select jsonb_build_object(
    'outlet', jsonb_build_object('name', o.name),
    'bill_number', b.bill_number,
    'business_date', b.business_date,
    'sold_at', b.created_at,
    'status', b.status,
    'void_reason', b.void_reason,
    'totals', jsonb_build_object(
      'subtotal_paise', b.subtotal_paise,
      'discount_paise', b.discount_paise,
      'tax_paise', b.tax_paise,
      'rounding_paise', b.rounding_paise,
      'total_paise', b.total_paise),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_name', i.item_name,
               'quantity', i.quantity,
               'unit_price_paise', i.unit_price_paise,
               'line_total_paise', i.line_total_paise)
             order by i.item_name)
        from public.bill_items i
       where i.bill_id = b.id), '[]'::jsonb),
    'discount_rows', public.bill_public_discount_rows(b.id),
    -- What this bill used and earned, and the balance it left: stored figures,
    -- and no name. Null for a bill with no points.
    'points', public.bill_public_points(b.id),
    -- `effective_bill_payments`, not `bill_payments`, and that is the whole of
    -- "a corrected tender reads corrected". A correction is an append -- a new
    -- revision with its own allocations -- rather than a rewrite of a settled
    -- sale, so the original rows are still there and reading them directly
    -- would serve a customer the split that was corrected away. The view
    -- resolves the latest revision, and the manager's own bill detail reads it
    -- for the same reason.
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', p.method,
               'amount_paise', p.amount_paise)
             order by p.method)
        from public.effective_bill_payments p
       where p.bill_id = b.id), '[]'::jsonb))
    into v_receipt
    from public.bills b
    join public.outlets o on o.id = b.outlet_id
   where b.id = v_bill_id;

  -- Recorded only now that the token has resolved.
  insert into public.bill_public_link_views (token, client_address_digest, user_agent)
  values (
    p_token,
    case when p_client_address is null then null
         else encode(
                extensions.digest(v_salt || ':' || p_client_address, 'sha256'),
                'hex')
    end,
    p_user_agent);

  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Who may call what.
--
-- The internal pieces take an outlet or a customer a caller does not hold, so
-- no client calls them directly. Only the functions that derive authority from
-- the caller are granted.

revoke execute on function public.set_outlet_loyalty_settings(
  uuid, boolean, integer, integer, integer, boolean, integer, integer, integer, boolean, integer
) from public, anon;
grant execute on function public.set_outlet_loyalty_settings(
  uuid, boolean, integer, integer, integer, boolean, integer, integer, integer, boolean, integer
) to authenticated;

revoke execute on function public.customer_points_write(
  uuid, uuid, uuid, public.points_entry_kind, integer, bigint, integer, integer, integer
) from public, anon, authenticated;
revoke execute on function public.customer_points_balance(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.customer_points_for_till(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.customer_gold_spell_at(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.customer_tier_at(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.customer_is_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.customer_gold_eligible(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bills_points_on_settle() from public, anon, authenticated;
revoke execute on function public.bills_points_on_void() from public, anon, authenticated;
revoke execute on function public.customer_directory_require_outlet(uuid) from public, anon, authenticated;
revoke execute on function public.customer_directory_reach(uuid) from public, anon, authenticated;
revoke execute on function public.customer_directory_activity(uuid) from public, anon, authenticated;
revoke execute on function public.customer_directory_spell(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.customer_directory_require_reach(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bill_public_points(uuid) from public, anon, authenticated;
grant execute on function public.bill_public_points(uuid) to service_role;

revoke execute on function public.customer_lookup_by_phone(text) from public, anon;
revoke execute on function public.customer_create_or_get(text, text) from public, anon;
revoke execute on function public.customer_suggest_at_outlet(text) from public, anon;
revoke execute on function public.customer_gold_grant_at_counter(uuid) from public, anon;
revoke execute on function public.customer_directory_card(uuid, uuid) from public, anon;
revoke execute on function public.customer_directory_list(uuid, text, integer, text) from public, anon;
revoke execute on function public.customer_directory_search(uuid, text) from public, anon;
revoke execute on function public.customer_rename(uuid, uuid, text) from public, anon;
revoke execute on function public.customer_membership_grant(uuid, uuid) from public, anon;
revoke execute on function public.customer_membership_revoke(uuid, uuid) from public, anon;

grant execute on function public.customer_lookup_by_phone(text) to authenticated;
grant execute on function public.customer_create_or_get(text, text) to authenticated;
grant execute on function public.customer_suggest_at_outlet(text) to authenticated;
grant execute on function public.customer_gold_grant_at_counter(uuid) to authenticated;
grant execute on function public.customer_directory_card(uuid, uuid) to authenticated;
grant execute on function public.customer_directory_list(uuid, text, integer, text) to authenticated;
grant execute on function public.customer_directory_search(uuid, text) to authenticated;
grant execute on function public.customer_rename(uuid, uuid, text) to authenticated;
grant execute on function public.customer_membership_grant(uuid, uuid) to authenticated;
grant execute on function public.customer_membership_revoke(uuid, uuid) to authenticated;
