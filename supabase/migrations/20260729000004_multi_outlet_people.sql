-- Multi-outlet people: authority becomes a relation, not a pair of columns.
--
-- `profiles.role` + `profiles.outlet_id` is a function in the mathematical
-- sense — one person, one role, one place. The business stopped being that
-- shape on 2026-07-29, on both counts at once: a staffer began splitting
-- shifts across Kalyani and Kanchrapara, and the owner began day-running one
-- outlet.
--
-- So the pair becomes `public.assignments` (person × role × outlet), and the
-- question every policy asks changes from "what does this token claim?" to
-- "does this person hold the right assignment at this row's outlet?".
--
-- Three consequences, and each is deliberate:
--
--   1. NOTHING ABOUT AUTHORITY IS IN THE TOKEN (owner, 2026-07-29). Both
--      claim helpers are dropped and the access-token hook is emptied to a
--      no-op (section 10 says why it is not dropped outright). An assignment
--      change therefore bites at the next request — the way deactivation
--      already does — and nothing is ever reissued or refreshed.
--   2. EVERY POLICY IN THE SCHEMA IS REWRITTEN. About 130 claim-helper
--      references across fifteen migrations, but a uniform translation:
--        app_role() = 'super_admin'
--          → (select public.app_is_owner())
--        app_role() = 'franchise_admin' and outlet_id = app_outlet_id()
--          → outlet_id in (select public.app_outlets_for('franchise_admin'))
--      The two-branch shape is kept exactly so this reads as a translation
--      rather than a redesign.
--   3. NOTHING SESSION-SCOPED EXISTS. No hats, no switcher, no "acting as".
--      The owner rejected that sketch on 2026-07-29 as needless complexity
--      for people who are not technical.
--
-- Staff codes retire in the same change (owner, same day): their only job was
-- telling two same-named people apart in lists, and role title plus joining
-- date do that without a second identifier to maintain. One-time ACTIVATION
-- codes are unrelated and untouched.
--
-- Production holds two accounts, which is the cheapest this migration will
-- ever be; it is nevertheless written to carry real data, per #21's precedent.

-- ---------------------------------------------------------------------------
-- 1. The relation.
--
-- Ending an assignment is a date, never a delete: the schema-wide rule is that
-- records are voided, deactivated or corrected rather than removed (`outlets`
-- being the single named exception), and attendance written last month was
-- written under an assignment that must remain explicable.

-- `person_id` cascades, and it is the second key in this schema permitted to
-- (after `account_invites.profile_id`). #21's rule is that a cascade onto
-- profiles erases HISTORY when an account dies — and an assignment is not
-- history, it is placement: the record that somebody works somewhere, in the
-- same category as the profile row it hangs off. The guarantee that account
-- deletion is refused survives untouched, because it was never assignments
-- that enforced it: attendance, expenses, movements, overrides and every
-- future history table still point at `profiles (id)` with NO ACTION, and any
-- one of them aborts the delete.
--
-- Without the cascade, a provisioning that failed halfway could not be cleaned
-- up — the account would be undeletable from the moment it was placed, which
-- is every account from its first second (identity-and-access: "a freshly
-- created account can still be cleaned up").
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  outlet_id uuid references public.outlets (id),
  started_on date not null default current_date,
  ended_on date,
  created_at timestamptz not null default now(),
  -- profiles_outlet_matches_role, moved verbatim: only the Super Admin is
  -- outlet-less, and every scoped role must be scoped.
  constraint assignments_outlet_matches_role
    check ((role = 'super_admin') = (outlet_id is null)),
  constraint assignments_ended_after_started
    check (ended_on is null or ended_on >= started_on)
);

comment on table public.assignments is
  'Who may do what, where. One row per person per role per outlet. A live row '
  'has ended_on null. Policies read this table; nothing about authority is '
  'carried in an access token.';
comment on column public.assignments.ended_on is
  'Null means live. Set, the person is off that outlet''s staff list and its '
  'new attendance days while every row they produced survives. Ending one '
  'assignment never touches another, nor the account.';

-- One live assignment per person per outlet. Two partial indexes rather than
-- one, because null outlet ids do not collide in a plain unique index and the
-- outlet-less Super Admin row needs its own uniqueness.
create unique index assignments_one_live_per_person_outlet
  on public.assignments (person_id, outlet_id)
  where ended_on is null and outlet_id is not null;
create unique index assignments_one_live_owner
  on public.assignments (person_id)
  where ended_on is null and outlet_id is null;

-- The lookup every policy makes, once per query.
create index assignments_person_role_live_idx
  on public.assignments (person_id, role)
  where ended_on is null;
create index assignments_outlet_live_idx
  on public.assignments (outlet_id)
  where ended_on is null;

alter table public.assignments enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Backfill: one live assignment per existing profile.
--
-- `joined_on` and `left_on` carry across as the assignment's own dates — "when
-- did you start here" and "when did you leave here" are per-outlet questions,
-- and per-outlet leaving is exactly what this change adds. A person already
-- marked departed arrives with their single assignment already ended, which is
-- the same state expressed in the new vocabulary.
--
-- `started_on` cannot be null and `left_on >= joined_on` was already enforced,
-- so a departed person with no joining date falls back to their departure date
-- rather than to today.

insert into public.assignments (person_id, role, outlet_id, started_on, ended_on)
select p.id,
       p.role,
       p.outlet_id,
       coalesce(p.joined_on, p.left_on, p.created_at::date),
       p.left_on
  from public.profiles p;

-- ---------------------------------------------------------------------------
-- 3. The membership helpers.
--
-- Two shapes, and the difference is cost rather than taste:
--
--   * `app_outlets_for` is SET-RETURNING, so `outlet_id in (select
--     public.app_outlets_for('franchise_admin'))` is a non-correlated subquery
--     Postgres hoists to a hashed SubPlan — one lookup per query, not per row.
--     `app_is_owner()` takes no argument, so `(select public.app_is_owner())`
--     becomes an InitPlan for the same reason.
--   * `app_has_role_at` is SCALAR, for trigger bodies and security-definer
--     functions where there is one row anyway and readability wins.
--
-- All of them are `security definer`, exactly like `app_account_active()`:
-- definer rights are what keep a policy that reads `assignments` from
-- recursing into the policy on `assignments`.

create or replace function public.app_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.person_id = auth.uid()
       and a.role = 'super_admin'
       and a.ended_on is null
  )
$$;

create or replace function public.app_outlets_for(required public.app_role)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.outlet_id
    from public.assignments a
   where a.person_id = auth.uid()
     and a.role = required
     and a.ended_on is null
     and a.outlet_id is not null
$$;

create or replace function public.app_has_role_at(required public.app_role, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.person_id = auth.uid()
       and a.role = required
       and a.ended_on is null
       and a.outlet_id is not distinct from outlet
  )
$$;

-- Does this person hold a live assignment at this outlet, in any role? Used by
-- write policies to check the SUBJECT of a row (whose attendance is this?)
-- rather than the caller, so it takes the person explicitly.
create or replace function public.app_person_assigned_at(person uuid, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.person_id = person
       and a.outlet_id = outlet
       and a.ended_on is null
  )
$$;

-- May the caller see this person at all? The owner sees everyone; a manager or
-- a counter device sees the people live at an outlet they are live at. This
-- replaces `outlet_id = app_outlet_id()` on `profiles`, which cannot express a
-- person who is at two outlets at once.
create or replace function public.app_may_see_person(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments target
      join public.assignments mine on mine.outlet_id = target.outlet_id
     where target.person_id = person
       and target.ended_on is null
       and mine.person_id = auth.uid()
       and mine.ended_on is null
       and mine.role in ('franchise_admin', 'biller')
  )
$$;

-- May the caller MANAGE this person — edit their staff facts, read the invite
-- they are holding? The owner, or a Franchise Admin at an outlet the person is
-- live at. (The stricter rule the privileged function applies — that a manager
-- may not act on somebody who also works at an outlet they do not manage —
-- lives in the Edge Function, because it is about account identity rather than
-- about row visibility.)
create or replace function public.app_may_manage_person(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_is_owner() or exists (
    select 1
      from public.assignments target
      join public.assignments mine on mine.outlet_id = target.outlet_id
     where target.person_id = person
       and target.ended_on is null
       and mine.person_id = auth.uid()
       and mine.ended_on is null
       and mine.role = 'franchise_admin'
  )
$$;

revoke execute on function public.app_is_owner() from public, anon;
revoke execute on function public.app_outlets_for(public.app_role) from public, anon;
revoke execute on function public.app_has_role_at(public.app_role, uuid) from public, anon;
revoke execute on function public.app_person_assigned_at(uuid, uuid) from public, anon;
revoke execute on function public.app_may_see_person(uuid) from public, anon;
revoke execute on function public.app_may_manage_person(uuid) from public, anon;
grant execute on function public.app_is_owner() to authenticated;
grant execute on function public.app_outlets_for(public.app_role) to authenticated;
grant execute on function public.app_has_role_at(public.app_role, uuid) to authenticated;
grant execute on function public.app_person_assigned_at(uuid, uuid) to authenticated;
grant execute on function public.app_may_see_person(uuid) to authenticated;
grant execute on function public.app_may_manage_person(uuid) to authenticated;

-- `app_profile_has` keeps its name and signature and changes its body: the
-- person must hold a LIVE assignment in that role at that outlet, and their
-- account must still be active. Used by the billing policies to validate an
-- attribution reference without granting the writer read access to profiles.
create or replace function public.app_profile_has(profile uuid, required public.app_role, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.profiles p on p.id = a.person_id
     where a.person_id = profile
       and a.role = required
       and a.outlet_id is not distinct from outlet
       and a.ended_on is null
       and p.is_active
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Who may write an assignment.
--
-- The policy decides which rows; the guard below decides the two rules a row
-- policy cannot express — self-granting and the last owner.

-- Scoped by the row's OUTLET, not by the person on it — and that distinction
-- is load-bearing. Scoping by person would let a Kalyani manager read the
-- Kanchrapara assignment of somebody who works at both, which is precisely the
-- other outlet's data the tenancy rule forbids. A manager sees the assignments
-- at outlets they manage; a person sees their own, wherever they are, because
-- that is their own working life rather than an outlet's business.
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      person_id = auth.uid()
      or (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        role in ('biller', 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );

-- Only `ended_on` is meaningfully mutable; the guard freezes the rest.
create policy assignments_update on public.assignments
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        role in ('biller', 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        role in ('biller', 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );

grant select, insert, update on public.assignments to authenticated;
-- No delete, ever: an assignment is ended, not erased.
revoke delete on public.assignments from authenticated, anon;
revoke all privileges on public.assignments from anon;

-- The privileged machinery needs this table: `admin-accounts` places a person
-- when it provisions them, and re-derives every caller's authority by reading
-- it. The local stack's hardened defaults grant a new table nothing to anyone,
-- so service_role's access is explicit here exactly as it is on
-- `account_invites` — and its absence presents as every admin session looking
-- unauthenticated, which is a long way from the missing grant that caused it.
grant all on public.assignments to service_role;

-- The two rules the row policies cannot state, plus immutability.
--
-- SELF-ASSIGNMENT is the one carve-out in this change, drawn narrowly
-- (design D7). A Super Admin may grant themselves an OUTLET-scoped assignment:
-- production holds exactly one Super Admin, so requiring a second person would
-- make this change's own trigger — the owner day-running an outlet —
-- unreachable without first minting a second owner account, which is a larger
-- security decision than the one it avoids. Nobody, ever, may grant themselves
-- `super_admin`: that is the only self-grant conferring authority the person
-- does not already hold, and it is the definition of escalation.
--
-- THE LAST LIVE `super_admin` ASSIGNMENT cannot be ended by anyone, including
-- its holder. A business with no owner has nobody who can appoint one.
--
-- The seed and the privileged machinery run without a session and answer to
-- the immutability rules only, exactly as every other guard in this schema.

create or replace function public.assignments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.person_id is distinct from old.person_id
       or new.role is distinct from old.role
       or new.outlet_id is distinct from old.outlet_id
       or new.started_on is distinct from old.started_on then
      raise exception
        'an assignment''s identity (person, role, outlet, start) is immutable; '
        'end it and grant another';
    end if;

    if old.ended_on is not null and new.ended_on is distinct from old.ended_on then
      raise exception 'an assignment that has ended cannot be reopened';
    end if;
  end if;

  -- Ending the last live owner. Checked for any write that takes a live
  -- super_admin row out of circulation.
  if old.role = 'super_admin' and old.ended_on is null and new.ended_on is not null then
    if not exists (
      select 1 from public.assignments a
       where a.role = 'super_admin'
         and a.ended_on is null
         and a.id <> old.id
    ) then
      raise exception 'the last super admin assignment cannot be ended'
        using errcode = 'raise_exception';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.assignments_self_grant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nested rather than an AND-chain: the privileged machinery writes as the
  -- service role, which holds no EXECUTE on the helpers, and SQL makes no
  -- short-circuit promise. Nesting is the evaluation-order guarantee — the
  -- same reasoning staff_code_guard() recorded before it.
  if auth.uid() is not null and new.person_id = auth.uid() then
    if new.role = 'super_admin' then
      raise exception 'nobody may grant themselves the owner role'
        using errcode = 'insufficient_privilege';
    end if;
    if not public.app_is_owner() then
      raise exception 'only the owner may assign themselves to an outlet'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger assignments_guarded
  before update on public.assignments
  for each row execute function public.assignments_guard();

create trigger assignments_self_grant_guarded
  before insert on public.assignments
  for each row execute function public.assignments_self_grant_guard();

-- ---------------------------------------------------------------------------
-- 5. Every policy, translated.
--
-- Dropped and recreated rather than altered: `alter policy` cannot change the
-- roles or the command, and a drop/create pair reads as the translation it is.

-- outlets: the owner manages; anyone live at an outlet reads that outlet's row
-- (cutover and geofence parameters live here), never the list.
drop policy outlets_select on public.outlets;
create policy outlets_select on public.outlets
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or id in (
        select a.outlet_id from public.assignments a
         where a.person_id = auth.uid() and a.ended_on is null
      )
    )
  );

drop policy outlets_insert on public.outlets;
create policy outlets_insert on public.outlets
  for insert to authenticated
  with check ((select public.app_is_owner()) and public.app_account_active());

drop policy outlets_update on public.outlets;
create policy outlets_update on public.outlets
  for update to authenticated
  using ((select public.app_is_owner()) and public.app_account_active())
  with check ((select public.app_is_owner()) and public.app_account_active());

drop policy outlets_delete on public.outlets;
create policy outlets_delete on public.outlets
  for delete to authenticated
  using ((select public.app_is_owner()) and public.app_account_active());

-- profiles: self-read; the owner all; a manager or counter device reads the
-- people live at an outlet they are live at.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      id = auth.uid()
      or (select public.app_is_owner())
      or public.app_may_see_person(id)
    )
  );

drop policy profiles_update_staff on public.profiles;
create policy profiles_update_staff on public.profiles
  for update to authenticated
  using (public.app_account_active() and public.app_device_ok() and public.app_may_manage_person(id))
  with check (public.app_account_active() and public.app_device_ok() and public.app_may_manage_person(id));

drop policy counter_devices_select on public.counter_devices;
create policy counter_devices_select on public.counter_devices
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or id = auth.uid()
    )
  );

-- menu: the owner everywhere; a manager and the counter read their outlets;
-- writes are the owner's and the manager's.
drop policy menu_categories_select on public.menu_categories;
create policy menu_categories_select on public.menu_categories
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or outlet_id in (select public.app_outlets_for('biller'))
    )
  );

drop policy menu_items_select on public.menu_items;
create policy menu_items_select on public.menu_items
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or outlet_id in (select public.app_outlets_for('biller'))
    )
  );

drop policy menu_categories_insert on public.menu_categories;
create policy menu_categories_insert on public.menu_categories
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy menu_categories_update on public.menu_categories;
create policy menu_categories_update on public.menu_categories
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy menu_items_insert on public.menu_items;
create policy menu_items_insert on public.menu_items
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy menu_items_update on public.menu_items;
create policy menu_items_update on public.menu_items
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or outlet_id in (select public.app_outlets_for('biller'))
    )
  );

-- shifts and bills: the counter creates, managers read.
drop policy shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or counter_device_id = auth.uid()
    )
  );

drop policy shifts_insert on public.shifts;
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and outlet_id in (select public.app_outlets_for('biller'))
    and counter_device_id = auth.uid()
    and public.app_profile_has(biller_profile_id, 'biller', outlet_id)
  );

drop policy shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and counter_device_id = auth.uid()
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id in (select public.app_outlets_for('biller'))
  );

drop policy bills_select on public.bills;
create policy bills_select on public.bills
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        counter_device_id = auth.uid()
        and shift_id in (
          select s.id from public.shifts s
          where s.counter_device_id = auth.uid() and s.closed_at is null
        )
      )
    )
  );

drop policy bills_insert on public.bills;
create policy bills_insert on public.bills
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and outlet_id in (select public.app_outlets_for('biller'))
    and counter_device_id = auth.uid()
    and public.app_profile_has(biller_profile_id, 'biller', outlet_id)
    and shift_id in (
      select s.id from public.shifts s where s.counter_device_id = auth.uid()
    )
  );

drop policy bills_update on public.bills;
create policy bills_update on public.bills
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy bill_items_insert on public.bill_items;
create policy bill_items_insert on public.bill_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.bills b
       where b.id = bill_id
         and b.outlet_id in (select public.app_outlets_for('biller'))
    )
  );

-- inventory: a manager surface. The counter has no inventory access.
drop policy inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (
    public.app_account_active()
    and outlet_id in (select public.app_outlets_for('franchise_admin'))
    -- Opening stock arrives as an 'added' movement, so the ledger stays the
    -- complete story from quantity zero.
    and current_quantity = 0
  );

drop policy inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (
    public.app_account_active()
    and outlet_id in (select public.app_outlets_for('franchise_admin'))
  )
  with check (
    public.app_account_active()
    and outlet_id in (select public.app_outlets_for('franchise_admin'))
  );

drop policy inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- The owner's remote correction (design D8). Bounded to `correction` because
-- that is the entry which needs to be possible from a distance ("the count is
-- wrong"), and it already carries a mandatory note; adding and consuming stock
-- is done standing in the shop. An owner who ALSO manages the outlet passes
-- the first branch and is unrestricted there — that authority comes from the
-- assignment, not from being the owner.
drop policy inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.app_account_active()
    and recorded_by = auth.uid()
    and (
      outlet_id in (select public.app_outlets_for('franchise_admin'))
      or ((select public.app_is_owner()) and movement_type = 'correction')
    )
  );

-- expenses.
drop policy expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- The owner's remote non-cash expense (design D8). "Never anything cash" is
-- arithmetic here rather than etiquette: a non-cash row cannot enter the
-- `close_business_day` cash sum, which filters on payment_method = 'cash'.
drop policy expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.app_account_active()
    and recorded_by = auth.uid()
    and (
      outlet_id in (select public.app_outlets_for('franchise_admin'))
      or ((select public.app_is_owner()) and payment_method <> 'cash')
    )
  );

-- attendance. New against #21's shape: the employee branch no longer pins the
-- row to one outlet claim — a person checks in at any outlet they are live at,
-- and the fence decides which (design D5). Every branch still requires the
-- row's SUBJECT to be assigned at the row's outlet.
drop policy attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or person_id = auth.uid()
    )
  );

drop policy attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and public.app_person_assigned_at(person_id, outlet_id)
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        person_id = auth.uid()
        and check_in_source = 'phone'
        and outlet_id in (select public.app_outlets_for('employee'))
      )
      or (
        check_in_source = 'counter_tablet'
        and outlet_id in (select public.app_outlets_for('biller'))
      )
    )
  );

drop policy attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or person_id = auth.uid()
    )
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or person_id = auth.uid()
    )
  );

-- cash: the drawer stays the manager's alone, always. No owner branch here or
-- on `close_business_day` — that is the whole boundary of the remote path.
drop policy cash_withdrawals_select on public.cash_withdrawals;
create policy cash_withdrawals_select on public.cash_withdrawals
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy cash_withdrawals_insert on public.cash_withdrawals;
create policy cash_withdrawals_insert on public.cash_withdrawals
  for insert to authenticated
  with check (
    public.app_account_active()
    and outlet_id in (select public.app_outlets_for('franchise_admin'))
    and recorded_by = auth.uid()
  );

drop policy daily_cash_records_select on public.daily_cash_records;
create policy daily_cash_records_select on public.daily_cash_records
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- alerts.
drop policy alerts_select on public.alerts;
create policy alerts_select on public.alerts
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

drop policy alerts_insert on public.alerts;
create policy alerts_insert on public.alerts
  for insert to authenticated
  with check (
    public.app_account_active()
    and outlet_id in (select public.app_outlets_for('franchise_admin'))
    and raised_by = auth.uid()
  );

drop policy alerts_update on public.alerts;
create policy alerts_update on public.alerts
  for update to authenticated
  using (public.app_account_active() and (select public.app_is_owner()))
  with check (public.app_account_active() and (select public.app_is_owner()));

drop policy alert_responses_insert on public.alert_responses;
create policy alert_responses_insert on public.alert_responses
  for insert to authenticated
  with check (
    public.app_account_active()
    and (select public.app_is_owner())
    and responder_profile_id = auth.uid()
    and exists (select 1 from public.alerts a where a.id = alert_id)
  );

-- ---------------------------------------------------------------------------
-- 6. The functions and triggers that read claims.

-- Only a manager of THIS outlet closes its day — including an owner who holds
-- a Franchise Admin assignment there, which is precisely the intended reading:
-- the authority comes from the assignment, and the owner's remote path stops
-- at the drawer.
create or replace function public.close_business_day(
  p_outlet_id uuid,
  p_business_date date,
  p_opening_cash_paise bigint,
  p_actual_closing_paise bigint,
  p_notes text default null
)
returns public.daily_cash_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sales bigint;
  v_expenses bigint;
  v_withdrawn bigint;
  v_expected bigint;
  v_record public.daily_cash_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.app_account_active()
     or not public.app_has_role_at('franchise_admin', p_outlet_id) then
    raise exception 'only an active franchise admin of this outlet may close its business day';
  end if;

  if p_opening_cash_paise is null or p_opening_cash_paise < 0
     or p_actual_closing_paise is null or p_actual_closing_paise < 0 then
    raise exception 'opening and counted closing cash must be non-negative paise amounts';
  end if;

  -- The three derived figures are computed here, inside the same transaction
  -- that writes the snapshot. The client never supplies them.
  select coalesce(sum(total_paise), 0) into v_sales
    from public.bills
   where outlet_id = p_outlet_id
     and business_date = p_business_date
     and payment_method = 'cash'
     and status = 'settled';

  select coalesce(sum(amount_paise), 0) into v_expenses
    from public.expenses
   where outlet_id = p_outlet_id
     and business_date = p_business_date
     and payment_method = 'cash';

  select coalesce(sum(amount_paise), 0) into v_withdrawn
    from public.cash_withdrawals
   where outlet_id = p_outlet_id
     and business_date = p_business_date;

  v_expected := p_opening_cash_paise + v_sales - v_expenses - v_withdrawn;

  begin
    insert into public.daily_cash_records (
      outlet_id, business_date,
      opening_cash_paise, cash_sales_paise, cash_expenses_paise, cash_withdrawn_paise,
      expected_closing_paise, actual_closing_paise, difference_paise,
      closed_by, notes
    ) values (
      p_outlet_id, p_business_date,
      p_opening_cash_paise, v_sales, v_expenses, v_withdrawn,
      v_expected, p_actual_closing_paise, p_actual_closing_paise - v_expected,
      auth.uid(), p_notes
    )
    returning * into v_record;
  exception
    when unique_violation then
      raise exception 'business day % is already closed for this outlet', p_business_date;
  end;

  return v_record;
end;
$$;

create or replace function public.bills_void_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'settled' and new.status = 'void' then
    if (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason')
       is distinct from
       (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason') then
      raise exception 'voiding may not modify any bill field other than void attribution';
    end if;

    -- Role gate applies to client sessions; seeds and privileged maintenance
    -- run without a session and answer to the RLS-less trigger checks above.
    if auth.uid() is not null then
      if not (public.app_is_owner()
              or public.app_has_role_at('franchise_admin', new.outlet_id)) then
        raise exception 'only a franchise admin of this outlet or the owner may void a bill';
      end if;
      if new.voided_by is distinct from auth.uid() then
        raise exception 'voided_by must be the voiding session';
      end if;
    end if;

    return new;
  end if;

  raise exception 'bills are append-only once settled; corrections are voids plus new bills';
end;
$$;

create or replace function public.outlet_reference_counts(p_outlet uuid)
returns table (table_name text, row_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_count bigint;
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- One row per referencing table, not per foreign key: a table that points at
  -- outlets from two columns is one thing attached, counted once.
  for v_ref in
    select cl.relname::text as tbl,
           c.conrelid as rel,
           string_agg(format('%I = $1', att.attname), ' or ') as predicate
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid
      join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
      cross join lateral unnest(c.conkey) as k(local_attnum)
      join pg_catalog.pg_attribute att
        on att.attrelid = c.conrelid and att.attnum = k.local_attnum
     where c.contype = 'f'
       and c.confrelid = 'public.outlets'::regclass
       and ns.nspname = 'public'
     group by cl.relname, c.conrelid
     order by cl.relname
  loop
    execute format('select count(*) from public.%I where %s', v_ref.tbl, v_ref.predicate)
      into v_count using p_outlet;
    if v_count > 0 then
      table_name := v_ref.tbl;
      row_count := v_count;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.invite_failure_pressure(
  p_window interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count
    from public.invite_redemption_attempts
   where attempted_at > now() - p_window;

  return v_count;
end;
$$;

-- The attendance guard, restated. Two behavioural notes:
--
--   * "an employee cannot change their own attendance status" becomes "only an
--     admin for THIS outlet may change a status". The old form named the
--     `employee` role and therefore silently exempted a biller updating their
--     own row; the rule was always about who may attest, and it is stated that
--     way now.
--   * The manual-entry and override branches ask the same question against the
--     row's own outlet, so an owner assigned nowhere still qualifies (they
--     record manual entries anywhere, which #21 established) while a manager
--     qualifies only at their own outlets.
create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_writing_manual_in boolean;
  v_writing_manual_out boolean;
  v_cutover time;
  v_is_admin_here boolean;
begin
  if tg_op = 'UPDATE' then
    if new.person_id is distinct from old.person_id
       or new.outlet_id is distinct from old.outlet_id
       or new.business_date is distinct from old.business_date then
      raise exception 'attendance identity (person, outlet, business date) is immutable';
    end if;

    if old.check_in_at is not null
       and (new.check_in_at is distinct from old.check_in_at
            or new.check_in_lat is distinct from old.check_in_lat
            or new.check_in_lng is distinct from old.check_in_lng
            or new.check_in_accuracy_m is distinct from old.check_in_accuracy_m
            or new.check_in_source is distinct from old.check_in_source
            or new.check_in_entered_by is distinct from old.check_in_entered_by
            or new.check_in_entered_by_name is distinct from old.check_in_entered_by_name) then
      raise exception 'captured check-in evidence is immutable';
    end if;

    if old.check_out_at is not null
       and (new.check_out_at is distinct from old.check_out_at
            or new.check_out_lat is distinct from old.check_out_lat
            or new.check_out_lng is distinct from old.check_out_lng
            or new.check_out_accuracy_m is distinct from old.check_out_accuracy_m
            or new.check_out_source is distinct from old.check_out_source
            or new.check_out_entered_by is distinct from old.check_out_entered_by
            or new.check_out_entered_by_name is distinct from old.check_out_entered_by_name) then
      raise exception 'captured check-out evidence is immutable';
    end if;
  end if;

  -- Is this write the arrival of a manual event? (A settled event is already
  -- frozen above, so "arrival" is the only moment these can be true.)
  v_writing_manual_in :=
    new.check_in_at is not null
    and new.check_in_source is not distinct from 'manual'
    and (tg_op = 'INSERT' or old.check_in_at is null);
  v_writing_manual_out :=
    new.check_out_at is not null
    and new.check_out_source is not distinct from 'manual'
    and (tg_op = 'INSERT' or old.check_out_at is null);

  if auth.uid() is not null then
    v_is_admin_here := public.app_is_owner()
      or public.app_has_role_at('franchise_admin', new.outlet_id);

    if tg_op = 'UPDATE'
       and new.status is distinct from old.status
       and not v_is_admin_here then
      raise exception 'only an admin for this outlet may change an attendance status';
    end if;

    if v_writing_manual_in or v_writing_manual_out then
      if not v_is_admin_here then
        raise exception 'only a franchise admin or super admin may record a manual entry';
      end if;

      select o.business_day_cutover into v_cutover
        from public.outlets o where o.id = new.outlet_id;
      if new.business_date is distinct from public.app_business_date(now(), v_cutover) then
        raise exception 'a manual entry belongs to the outlet''s current business day';
      end if;

      if v_writing_manual_in then
        if new.check_in_at > now() then
          raise exception 'a manual entry cannot be recorded for the future';
        end if;
        new.check_in_entered_by := auth.uid();
        select p.full_name into new.check_in_entered_by_name
          from public.profiles p where p.id = auth.uid();
      end if;
      if v_writing_manual_out then
        if new.check_out_at > now() then
          raise exception 'a manual entry cannot be recorded for the future';
        end if;
        new.check_out_entered_by := auth.uid();
        select p.full_name into new.check_out_entered_by_name
          from public.profiles p where p.id = auth.uid();
      end if;
    end if;

    -- An enterer stamp on a non-manual event never comes from a client; the
    -- check constraints refuse the shape, this refuses the attempt by name.
    if not v_writing_manual_in
       and (tg_op = 'INSERT' and new.check_in_entered_by is not null
            or tg_op = 'UPDATE' and new.check_in_entered_by is distinct from old.check_in_entered_by) then
      raise exception 'check_in_entered_by is stamped by the database, not supplied';
    end if;
    if not v_writing_manual_out
       and (tg_op = 'INSERT' and new.check_out_entered_by is not null
            or tg_op = 'UPDATE' and new.check_out_entered_by is distinct from old.check_out_entered_by) then
      raise exception 'check_out_entered_by is stamped by the database, not supplied';
    end if;

    if (tg_op = 'INSERT' and new.override_by is not null)
       or (tg_op = 'UPDATE' and (
            new.override_by is distinct from old.override_by
            or new.override_reason is distinct from old.override_reason
            or new.override_at is distinct from old.override_at
          )) then
      if not v_is_admin_here then
        raise exception 'only a franchise admin or super admin may record an override';
      end if;
      if new.override_by is distinct from auth.uid() then
        raise exception 'override_by must be the overriding session';
      end if;
    end if;
  end if;

  if new.override_by is null then
    new.override_by_name := null;
  elsif tg_op = 'INSERT' or new.override_by is distinct from old.override_by then
    select p.full_name into new.override_by_name
      from public.profiles p where p.id = new.override_by;
  else
    new.override_by_name := old.override_by_name;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Attendance: one row per person per OUTLET per business day.
--
-- A morning at Kalyani and an evening at Kanchrapara are two rows, which is
-- what they are. `app_person_outlet` retires with the constraint it served —
-- "the person's outlet" is no longer a single value.

alter table public.attendance
  drop constraint attendance_one_per_person_day;
alter table public.attendance
  add constraint attendance_one_per_person_outlet_day
  unique (person_id, outlet_id, business_date);

drop function public.app_person_outlet(uuid);

-- ---------------------------------------------------------------------------
-- 8. Invites follow the person, not an outlet.
--
-- `account_invites.outlet_id` was denormalised from the account's single
-- outlet; an account no longer has one. Its only job was scoping the select
-- policy, which now asks who may manage the person — and the reassignment
-- trigger moves to the table that now records reassignment.

drop trigger profiles_reassignment_supersedes_invites on public.profiles;

create or replace function public.supersede_invites_on_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  v_person := case tg_op when 'DELETE' then old.person_id else new.person_id end;

  update public.account_invites
     set superseded_at = now()
   where profile_id = v_person
     and consumed_at is null
     and superseded_at is null;
  return null;
end;
$$;

-- A code issued while they were a Kalyani Employee must not still work once
-- they are a Kanchrapara Biller — so both directions of an assignment change
-- supersede: gaining one and ending one.
create trigger assignments_supersede_invites
  after insert or update of ended_on on public.assignments
  for each row execute function public.supersede_invites_on_reassignment();

drop policy account_invites_select on public.account_invites;
create policy account_invites_select on public.account_invites
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and public.app_may_manage_person(profile_id)
  );

drop index public.account_invites_outlet_id_idx;
alter table public.account_invites drop column outlet_id;

-- `issue_account_invite` no longer has an outlet to denormalise.
create or replace function public.issue_account_invite(
  p_profile_id uuid,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;

  update public.account_invites
     set superseded_at = now()
   where profile_id = p_profile_id
     and consumed_at is null
     and superseded_at is null;

  insert into public.account_invites
    (profile_id, code_hash, issued_by, expires_at)
  values
    (p_profile_id, p_code_hash, p_issued_by, now() + p_valid_for)
  returning id into v_id;

  return v_id;
end;
$$;

grant select (
  id, profile_id, issued_by, issued_at,
  expires_at, attempts, consumed_at, superseded_at
) on public.account_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Staff codes retire.
--
-- #18 recorded that their only job was disambiguating same-named people in
-- lists, and explicitly kept them meaningless. Role title and joining date do
-- that job without a second identifier for anybody to maintain, read aloud, or
-- get wrong. If a real staff numbering scheme ever arrives, re-adding is one
-- migration and #18's archived design is the recipe.

drop trigger profiles_issue_code on public.profiles;
drop trigger profiles_code_guarded on public.profiles;
drop trigger outlets_prefix_guarded on public.outlets;
drop trigger outlets_issue_prefix on public.outlets;

drop function public.issue_staff_code();
drop function public.staff_code_guard();
drop function public.outlet_prefix_guard();
drop function public.issue_outlet_prefix();
drop function public.derive_staff_code_prefix(text);
drop function public.random_staff_suffix();

alter table public.profiles
  drop constraint profiles_staff_code_unique_per_outlet,
  drop constraint profiles_staff_code_not_blank,
  drop column staff_code;

alter table public.outlets
  drop constraint outlets_staff_code_prefix_unique,
  drop constraint outlets_staff_code_prefix_shape,
  drop column staff_code_prefix;

-- ---------------------------------------------------------------------------
-- 10. The pair, and the token, go last.
--
-- Last because the backfill reads the columns and every policy naming them had
-- to be rewritten first.
--
-- THE HOOK IS EMPTIED RATHER THAN DROPPED, and that is a deployment decision
-- rather than a design one. GoTrue's access-token hook is registered in the
-- project's own settings, not in this schema: dropping the function while that
-- registration still points at it makes every token issue fail, which means
-- **nobody can sign in at all — including whoever would go and fix it**. A
-- schema migration must not be able to lock the owner out of their own
-- business between two dashboard clicks.
--
-- So it stays, injecting nothing. The property the change is about holds
-- either way — a token carries no authority — and the registration can be
-- turned off at leisure, after which a one-line migration may drop this stub.
-- Until then it is inert: no policy reads a claim, because the two helpers
-- that used to are gone below.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select event
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Deliberately inert since multi-outlet-people: authority is resolved from '
  'public.assignments on every request, and nothing about it is carried in a '
  'token. Kept only so that a project whose auth settings still register this '
  'hook keeps issuing tokens. Safe to drop once Authentication -> Hooks no '
  'longer points at it.';

drop function public.app_role();
drop function public.app_outlet_id();

alter table public.profiles
  drop constraint profiles_outlet_matches_role,
  drop constraint profiles_left_after_joining,
  drop column role,
  drop column outlet_id,
  drop column joined_on,
  drop column left_on;

-- The staff-fact write path narrows to what is left of it: a person's name and
-- their job title. Where they work is an assignment, and assignments have
-- their own policy.
revoke update on public.profiles from authenticated;
grant update (full_name, role_title) on public.profiles to authenticated;

comment on column public.profiles.role_title is
  'Free-text job label ("Griller", "Counter staff") — the human answer to '
  '"what do they do here", distinct from the app-capability role, which is now '
  'per-outlet and lives on public.assignments.';
