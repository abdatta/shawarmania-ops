-- fixed-costs-are-spread-over-the-month (#79): an outlet's fixed costs, what
-- each month of them costs, and the payments that pay them; and the change gate
-- that shows Pro-rata P&L beside P&L.
-- change-gate: pro-rata-pnl
--
-- Every object here is new. `expenses`, `effective_expenses`, their policies
-- and triggers, and `overview_month` are untouched: a fixed-cost payment is an
-- ordinary expense row that every published build already reads and counts.
--
-- No month is stored (design D2). A month's cost is derived on read from a
-- fixed cost, its monthly amounts and its settlements, so there is no job on
-- the 1st to fail.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('pro-rata-pnl', 'PR', 'change', 'Pro-rata P&L',
   'Overview and the Ledger''s current month show Pro-rata P&L, which charges the unpaid share of this month''s fixed costs up to today, beside P&L.',
   'Overview and the Ledger show one P&L that counts every cost on the date it was recorded.',
   'fixed-costs-are-spread-over-the-month', 79);

insert into public.change_gate_dependencies (gate_key, depends_on)
values ('pro-rata-pnl', 'one-revenue');

-- ── Fixed costs (design D2) ─────────────────────────────────────────────────
--
-- A salary is a typed name, deliberately not a reference to an account: not
-- everyone paid has one, and not every account is paid (owner, 2026-10-19).
-- Payroll stays out of the app; this is a cost and what was paid against it.
create table public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  name text not null,
  category text not null,
  note text,
  starts_on date not null,
  stops_on date,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_costs_id_outlet_unique unique (id, outlet_id),
  constraint fixed_costs_name_present check (length(btrim(name)) > 0),
  constraint fixed_costs_category_known
    check (category in ('salary', 'rent', 'utility', 'other')),
  constraint fixed_costs_stops_after_start check (stops_on is null or stops_on >= starts_on)
);

comment on table public.fixed_costs is
  'An outlet''s recurring cost: a salary, rent, a utility or other. Carried over every month from starts_on until stops_on; never deleted.';

-- A payment's link to the expense it is. The amount and the date it counts in
-- are the expense's; only the day it was paid is kept here. Insert-only: the
-- link is what marks an expense Fixed, so nothing may move or remove it.
create table public.fixed_cost_payments (
  id uuid primary key default gen_random_uuid(),
  fixed_cost_id uuid not null,
  outlet_id uuid not null,
  expense_id uuid not null references public.expenses (id),
  paid_on date not null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint fixed_cost_payments_fixed_cost
    foreign key (fixed_cost_id, outlet_id) references public.fixed_costs (id, outlet_id),
  constraint fixed_cost_payments_one_per_expense unique (expense_id)
);

create index fixed_cost_payments_by_cost on public.fixed_cost_payments (fixed_cost_id);

-- A monthly amount from a month on. The latest unvoided from_month at or before
-- a month applies to it; for one from_month, the latest row wins. Set by Edit, or
-- by a payment's Permanent pay raise or cut, which it then names, so undoing the
-- payment withdraws it too. Voided, never deleted.
create table public.fixed_cost_amounts (
  id uuid primary key default gen_random_uuid(),
  fixed_cost_id uuid not null,
  outlet_id uuid not null,
  from_month date not null,
  amount_paise bigint not null,
  fixed_cost_payment_id uuid references public.fixed_cost_payments (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  constraint fixed_cost_amounts_fixed_cost
    foreign key (fixed_cost_id, outlet_id) references public.fixed_costs (id, outlet_id),
  constraint fixed_cost_amounts_month_first check (extract(day from from_month) = 1),
  constraint fixed_cost_amounts_not_negative check (amount_paise >= 0),
  constraint fixed_cost_amounts_void_whole check ((voided_at is null) = (voided_by is null))
);

create index fixed_cost_amounts_by_cost on public.fixed_cost_amounts (fixed_cost_id, from_month);

-- One month settled at a figure: a payment's answer (That's all, a bonus, a
-- permanent change), Drop, or a cleared balance on Stop. The latest unvoided row
-- for a month is that month's cost. A payment's settlement names it, so undoing
-- the payment voids it too. Voided, never deleted.
create table public.fixed_cost_settlements (
  id uuid primary key default gen_random_uuid(),
  fixed_cost_id uuid not null,
  outlet_id uuid not null,
  month date not null,
  amount_paise bigint not null,
  fixed_cost_payment_id uuid references public.fixed_cost_payments (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  constraint fixed_cost_settlements_fixed_cost
    foreign key (fixed_cost_id, outlet_id) references public.fixed_costs (id, outlet_id),
  constraint fixed_cost_settlements_month_first check (extract(day from month) = 1),
  constraint fixed_cost_settlements_not_negative check (amount_paise >= 0),
  constraint fixed_cost_settlements_void_whole
    check ((voided_at is null) = (voided_by is null))
);

create index fixed_cost_settlements_by_cost on public.fixed_cost_settlements (fixed_cost_id, month);


-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger fixed_costs_set_updated_at
  before update on public.fixed_costs
  for each row execute function public.set_updated_at();

-- On a fixed cost, Edit changes the name, category, start and note, and Stop
-- the stop; the outlet and who added it never change.
create function public.fixed_costs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.outlet_id is distinct from old.outlet_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a fixed cost''s outlet and author are fixed when it is added';
  end if;
  return new;
end $$;

create trigger fixed_costs_guarded
  before update on public.fixed_costs
  for each row execute function public.fixed_costs_guard();

-- A settlement or an amount is only ever voided, once, by the person voiding it.
create function public.fixed_cost_settlements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'a voided row stays as it was voided';
  end if;
  if to_jsonb(new) - 'voided_at' - 'voided_by'
     is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then
    raise exception 'it is voided and recorded again, never edited';
  end if;
  if new.voided_at is not null then
    new.voided_by := auth.uid();
  end if;
  return new;
end $$;

create trigger fixed_cost_settlements_guarded
  before update on public.fixed_cost_settlements
  for each row execute function public.fixed_cost_settlements_guard();

-- A link names an expense of its own outlet, or nothing.
create function public.fixed_cost_payments_same_outlet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.expenses e
     where e.id = new.expense_id and e.outlet_id = new.outlet_id
  ) then
    raise exception 'a fixed-cost payment links an expense of its own outlet';
  end if;
  return new;
end $$;

create trigger fixed_cost_payments_same_outlet
  before insert on public.fixed_cost_payments
  for each row execute function public.fixed_cost_payments_same_outlet();

create trigger fixed_cost_amounts_guarded
  before update on public.fixed_cost_amounts
  for each row execute function public.fixed_cost_settlements_guard();

create trigger fixed_cost_amounts_no_delete
  before delete on public.fixed_cost_amounts
  for each row execute function public.reject_mutation();

create trigger fixed_cost_payments_insert_only
  before update or delete on public.fixed_cost_payments
  for each row execute function public.reject_mutation();

create trigger fixed_costs_no_delete
  before delete on public.fixed_costs
  for each row execute function public.reject_mutation();

create trigger fixed_cost_settlements_no_delete
  before delete on public.fixed_cost_settlements
  for each row execute function public.reject_mutation();

-- ── Row-level security (design: RLS and authority) ──────────────────────────
--
-- The owner and the outlet's manager, the readers of a non-cash expense. No
-- branch for a counter shift, a Biller or an Employee: salaries are theirs to
-- see nowhere. No delete policy anywhere.

alter table public.fixed_costs enable row level security;
alter table public.fixed_cost_amounts enable row level security;
alter table public.fixed_cost_settlements enable row level security;
alter table public.fixed_cost_payments enable row level security;

revoke delete on public.fixed_costs, public.fixed_cost_amounts,
  public.fixed_cost_settlements, public.fixed_cost_payments from authenticated;
revoke all on public.fixed_costs, public.fixed_cost_amounts,
  public.fixed_cost_settlements, public.fixed_cost_payments from anon;

create policy fixed_costs_select on public.fixed_costs
  for select to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_costs_insert on public.fixed_costs
  for insert to authenticated
  with check (public.app_account_active() and created_by = auth.uid()
    and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_costs_update on public.fixed_costs
  for update to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))))
  with check (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));

create policy fixed_cost_amounts_select on public.fixed_cost_amounts
  for select to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_cost_amounts_insert on public.fixed_cost_amounts
  for insert to authenticated
  with check (public.app_account_active() and created_by = auth.uid()
    and voided_at is null
    and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_cost_amounts_update on public.fixed_cost_amounts
  for update to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))))
  with check (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));

create policy fixed_cost_settlements_select on public.fixed_cost_settlements
  for select to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_cost_settlements_insert on public.fixed_cost_settlements
  for insert to authenticated
  with check (public.app_account_active() and created_by = auth.uid()
    and voided_at is null
    and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_cost_settlements_update on public.fixed_cost_settlements
  for update to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))))
  with check (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));

create policy fixed_cost_payments_select on public.fixed_cost_payments
  for select to authenticated
  using (public.app_account_active() and ((select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))));
create policy fixed_cost_payments_insert on public.fixed_cost_payments
  for insert to authenticated
  with check (public.app_account_active() and created_by = auth.uid()
    and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));

grant select, insert, update on public.fixed_costs to authenticated;
grant select, insert, update on public.fixed_cost_amounts to authenticated;
grant select, insert, update on public.fixed_cost_settlements to authenticated;
grant select, insert on public.fixed_cost_payments to authenticated;
