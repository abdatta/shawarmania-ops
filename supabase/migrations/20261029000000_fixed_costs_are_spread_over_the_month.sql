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


-- ── Who may touch an outlet's fixed costs ───────────────────────────────────
--
-- The owner and the outlet's manager, on an active account: the four tables'
-- policies, said once for the functions below. `security invoker` and granted,
-- because it answers only about the caller.
create function public.fixed_costs_assert_outlet(p_outlet_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (coalesce(public.app_account_active(), false)
          and (coalesce(public.app_is_owner(), false)
               or coalesce(public.app_has_role_at('franchise_admin', p_outlet_id), false))) then
    raise exception 'Fixed costs are for the owner and the manager'
      using errcode = '42501';
  end if;
end $$;

-- ── What a month costs (design D3) ──────────────────────────────────────────
--
-- The SQL copy of `monthCost` in src/domain/fixed-costs.ts; the shared case
-- table holds the two to each other (supabase/tests/97_fixed_costs_are_spread_over_the_month.sql). The
-- helpers are `security invoker`: called by the caller they read under the
-- tables' policies, so granting them shows nothing a select would not.
create function public.fixed_cost_month_cost(p_fixed_cost_id uuid, p_month date)
returns bigint
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_end date;
  v_first date;
  v_last date;
  v_settled bigint;
  v_amount bigint;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'a month is named by its 1st';
  end if;
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    return 0;
  end if;
  v_end := (p_month + interval '1 month' - interval '1 day')::date;
  v_first := greatest(p_month, v_cost.starts_on);
  v_last := least(v_end, coalesce(v_cost.stops_on, v_end));
  if v_last < v_first then
    return 0;
  end if;
  select s.amount_paise into v_settled
    from public.fixed_cost_settlements s
   where s.fixed_cost_id = p_fixed_cost_id and s.month = p_month and s.voided_at is null
   order by s.created_at desc
   limit 1;
  if found then
    return v_settled;
  end if;
  select a.amount_paise into v_amount
    from public.fixed_cost_amounts a
   where a.fixed_cost_id = p_fixed_cost_id and a.from_month <= p_month and a.voided_at is null
   order by a.from_month desc, a.created_at desc
   limit 1;
  -- Rounded down to the paisa: bigint division truncates, and both are positive.
  return coalesce(v_amount, 0) * (v_last - v_first + 1)
         / extract(day from v_end)::integer;
end $$;

-- Every month it runs in from its start through `p_through`, oldest first, with
-- what each costs and the running total: what first-in-first-out fills.
create function public.fixed_cost_months(p_fixed_cost_id uuid, p_through date)
returns table (month date, cost_paise bigint, cumulative_paise bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select m::date as month, public.fixed_cost_month_cost(c.id, m::date) as cost_paise
      from public.fixed_costs c,
           generate_series(date_trunc('month', c.starts_on::timestamp),
                           least(p_through::timestamp,
                                 date_trunc('month', coalesce(c.stops_on, p_through)::timestamp)),
                           interval '1 month') m
     where c.id = p_fixed_cost_id
  )
  select months.month, months.cost_paise,
         (sum(months.cost_paise) over (order by months.month))::bigint
    from months
   order by months.month
$$;

-- What its effective payments counted on or before a day add up to. A payment
-- is its expense: withdrawn, it pays nothing; corrected, it pays the new amount.
create function public.fixed_cost_paid_paise(p_fixed_cost_id uuid, p_on_or_before date)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(e.amount_paise), 0)::bigint
    from public.fixed_cost_payments p
    join public.expenses e on e.id = p.expense_id
   where p.fixed_cost_id = p_fixed_cost_id
     and e.voided_at is null
     and e.business_date <= p_on_or_before
$$;

-- Whether `p_month` runs on some but not all of its dates.
create function public.fixed_cost_is_prorated(p_fixed_cost_id uuid, p_month date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(p_month, c.starts_on)
           <= least((p_month + interval '1 month' - interval '1 day')::date,
                    coalesce(c.stops_on, 'infinity'::date))
     and (c.starts_on > p_month
          or coalesce(c.stops_on, 'infinity'::date)
               < (p_month + interval '1 month' - interval '1 day')::date)
    from public.fixed_costs c
   where c.id = p_fixed_cost_id
$$;

-- The outlet's business date, through its cutover.
create function public.fixed_costs_today(p_outlet_id uuid)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select public.app_business_date(now(), o.business_day_cutover)
    from public.outlets o
   where o.id = p_outlet_id
$$;

-- ── Adding, editing and stopping (design D5) ────────────────────────────────

-- A fixed cost and its first monthly amount, from the month it starts.
create function public.create_fixed_cost(
  p_outlet_id uuid,
  p_name text,
  p_category text,
  p_monthly_paise bigint,
  p_starts_on date,
  p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.fixed_costs_assert_outlet(p_outlet_id);
  if p_monthly_paise is null or p_monthly_paise < 0 then
    raise exception 'The monthly amount is a number of rupees.' using errcode = '22023';
  end if;
  insert into public.fixed_costs (outlet_id, name, category, note, starts_on)
  values (p_outlet_id, btrim(p_name), p_category, nullif(btrim(p_note), ''), p_starts_on)
  returning id into v_id;
  insert into public.fixed_cost_amounts (fixed_cost_id, outlet_id, from_month, amount_paise)
  values (v_id, p_outlet_id, date_trunc('month', p_starts_on::timestamp)::date, p_monthly_paise);
  return v_id;
end $$;

-- Edit: name, category, start and note. A start moved before the first monthly
-- amount carries that amount back to it, so the months it gains cost what the
-- first one did.
create function public.update_fixed_cost(
  p_fixed_cost_id uuid,
  p_name text,
  p_category text,
  p_starts_on date,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_first public.fixed_cost_amounts;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if v_cost.stops_on is not null and p_starts_on > v_cost.stops_on then
    raise exception 'It cannot start after it stopped.' using errcode = '22023';
  end if;
  select * into v_first from public.fixed_cost_amounts
   where fixed_cost_id = p_fixed_cost_id and voided_at is null
   order by from_month, created_at
   limit 1;
  if found and v_first.from_month > date_trunc('month', p_starts_on::timestamp)::date then
    insert into public.fixed_cost_amounts (fixed_cost_id, outlet_id, from_month, amount_paise)
    values (p_fixed_cost_id, v_cost.outlet_id, date_trunc('month', p_starts_on::timestamp)::date,
            v_first.amount_paise);
  end if;
  update public.fixed_costs
     set name = btrim(p_name), category = p_category, starts_on = p_starts_on,
         note = nullif(btrim(p_note), '')
   where id = p_fixed_cost_id;
end $$;

-- Stop from a date. `p_clear_ahead` settles the last month at its cost plus
-- what was paid beyond it, so no balance is left paid ahead of nothing.
create function public.stop_fixed_cost(
  p_fixed_cost_id uuid,
  p_stops_on date,
  p_clear_ahead boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_last date;
  v_ahead bigint;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if p_stops_on < v_cost.starts_on then
    raise exception 'It cannot stop before it started.' using errcode = '22023';
  end if;
  update public.fixed_costs set stops_on = p_stops_on where id = p_fixed_cost_id;
  if p_clear_ahead then
    v_last := date_trunc('month', p_stops_on::timestamp)::date;
    v_ahead := public.fixed_cost_paid_paise(p_fixed_cost_id,
                 (v_last + interval '1 month' - interval '1 day')::date)
               - coalesce((select sum(m.cost_paise)
                             from public.fixed_cost_months(p_fixed_cost_id, v_last) m), 0);
    if v_ahead > 0 then
      insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
      values (p_fixed_cost_id, v_cost.outlet_id, v_last,
              public.fixed_cost_month_cost(p_fixed_cost_id, v_last) + v_ahead);
    end if;
  end if;
end $$;

-- ── Paying (design D5, and the owner's demo round) ──────────────────────────
--
-- One transaction: the expense, as the Expenses form inserts one, under the
-- caller's own policy and `expense_guard`; the link; and what the answer
-- records. The answer is recomputed here from what is owed at the outlet's
-- business date, the arithmetic of `payPrompt` and `payEffect`, so a choice the
-- server would not offer is refused rather than stored. A retried tap finds the
-- link for `p_id` and records nothing more.
create function public.record_fixed_cost_payment(
  p_id uuid,
  p_fixed_cost_id uuid,
  p_amount_paise bigint,
  p_paid_on date,
  p_counts_in date,
  p_is_cash boolean,
  p_note text default null,
  p_choice text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_link uuid;
  v_today date;
  v_month date;
  v_counts_in date;
  v_owed bigint;
  v_pool bigint;
  v_short_month date;
  v_short_cost bigint;
  v_short_cumulative bigint;
  v_covered bigint := 0;
  v_settle_month date;
  v_settle_paise bigint;
  v_new_amount boolean := false;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    -- A Biller, an Employee and a counter shift read no fixed cost: refused
    -- here, before any expense is written.
    raise exception 'Fixed costs are for the owner and the manager'
      using errcode = '42501';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);

  select id into v_link from public.fixed_cost_payments where expense_id = p_id;
  if found then
    return v_link;
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'A payment needs an amount above zero.' using errcode = '22023';
  end if;
  if p_choice is not null
     and p_choice not in ('settle', 'cut', 'ahead', 'extra', 'new-amount') then
    raise exception 'That choice does not fit this payment. Look at it again.'
      using errcode = '22023';
  end if;
  v_today := public.fixed_costs_today(v_cost.outlet_id);
  if p_paid_on > v_today or p_counts_in > v_today then
    raise exception 'A payment cannot be dated after today.' using errcode = '22023';
  end if;
  -- Cash shows on the day it left the drawer.
  v_counts_in := case when p_is_cash then p_paid_on else p_counts_in end;
  v_month := date_trunc('month', v_today::timestamp)::date;

  -- What is owed through this month in full, before this payment.
  v_owed := greatest(0,
    coalesce((select sum(m.cost_paise) from public.fixed_cost_months(v_cost.id, v_month) m), 0)
    - public.fixed_cost_paid_paise(v_cost.id,
        (v_month + interval '1 month' - interval '1 day')::date));

  if p_amount_paise > v_owed then
    -- More than everything owed: an advance, a one-time extra, or a new amount.
    if p_choice is null then
      raise exception
        'Say what the extra is: an advance, a one-time extra or a new monthly amount.'
        using errcode = '22023';
    end if;
    if p_choice in ('settle', 'cut')
       or (p_choice = 'new-amount' and public.fixed_cost_is_prorated(v_cost.id, v_month)) then
      raise exception 'That choice does not fit this payment. Look at it again.'
        using errcode = '22023';
    end if;
    if p_choice in ('extra', 'new-amount') then
      v_settle_month := v_month;
      v_settle_paise := public.fixed_cost_month_cost(v_cost.id, v_month)
                        + (p_amount_paise - v_owed);
      v_new_amount := p_choice = 'new-amount';
    end if;
  elsif p_choice is not null and p_choice <> 'ahead' then
    -- Less than a month owes: the first month this payment leaves short, if it
    -- reached it at all, settled at what it now has covered.
    v_pool := public.fixed_cost_paid_paise(v_cost.id, v_today) + p_amount_paise;
    select m.month, m.cost_paise, m.cumulative_paise
      into v_short_month, v_short_cost, v_short_cumulative
      from public.fixed_cost_months(v_cost.id, v_month) m
     where m.cumulative_paise > v_pool
     order by m.month
     limit 1;
    if v_short_month is not null then
      v_covered := greatest(0, v_pool - (v_short_cumulative - v_short_cost));
    end if;
    if v_short_month is null or v_covered = 0 then
      -- Nothing to decide: the choice changes nothing, as the sheet asks nothing.
      null;
    elsif p_choice = 'settle'
          or (p_choice = 'cut'
              and not public.fixed_cost_is_prorated(v_cost.id, v_short_month)) then
      v_settle_month := v_short_month;
      v_settle_paise := v_covered;
      v_new_amount := p_choice = 'cut';
    else
      raise exception 'That choice does not fit this payment. Look at it again.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.expenses (id, outlet_id, business_date, category, description,
                               amount_paise, is_cash)
  values (p_id, v_cost.outlet_id, v_counts_in,
          case v_cost.category when 'salary' then 'Salary' when 'rent' then 'Rent'
                               when 'utility' then 'Utility' else 'Other' end,
          case when nullif(btrim(p_note), '') is null then v_cost.name
               else v_cost.name || ' · ' || btrim(p_note) end,
          p_amount_paise, p_is_cash);
  insert into public.fixed_cost_payments (fixed_cost_id, outlet_id, expense_id, paid_on)
  values (v_cost.id, v_cost.outlet_id, p_id, p_paid_on)
  returning id into v_link;

  if v_settle_month is not null then
    insert into public.fixed_cost_settlements
      (fixed_cost_id, outlet_id, month, amount_paise, fixed_cost_payment_id)
    values (v_cost.id, v_cost.outlet_id, v_settle_month, v_settle_paise, v_link);
    if v_new_amount then
      insert into public.fixed_cost_amounts
        (fixed_cost_id, outlet_id, from_month, amount_paise, fixed_cost_payment_id)
      values (v_cost.id, v_cost.outlet_id, (v_settle_month + interval '1 month')::date,
              v_settle_paise, v_link);
    end if;
  end if;
  return v_link;
end $$;

-- Undo a payment (owner, 2026-10-19): withdraw its expense and void what its
-- answer recorded, so it can be paid again with the right one. Nothing is
-- deleted; the expense stays on its day, struck through.
create function public.undo_fixed_cost_payment(p_fixed_cost_id uuid, p_payment_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.fixed_cost_payments;
begin
  select * into v_link from public.fixed_cost_payments
   where id = p_payment_id and fixed_cost_id = p_fixed_cost_id;
  if not found then
    raise exception 'That payment is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_link.outlet_id);
  update public.expenses
     set voided_at = now(), voided_reason = 'Undone on the fixed cost'
   where id = v_link.expense_id and voided_at is null;
  update public.fixed_cost_settlements set voided_at = now()
   where fixed_cost_payment_id = v_link.id and voided_at is null;
  update public.fixed_cost_amounts set voided_at = now()
   where fixed_cost_payment_id = v_link.id and voided_at is null;
end $$;

-- Edit: a monthly amount from a month on. Drop: a month settled at what it has
-- covered. Each is one row; a function so the outlet comes from the fixed cost
-- and never from the request.
create function public.change_fixed_cost_amount(
  p_fixed_cost_id uuid,
  p_from_month date,
  p_amount_paise bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if p_amount_paise is null or p_amount_paise < 0 then
    raise exception 'The monthly amount is a number of rupees.' using errcode = '22023';
  end if;
  insert into public.fixed_cost_amounts (fixed_cost_id, outlet_id, from_month, amount_paise)
  values (p_fixed_cost_id, v_cost.outlet_id, p_from_month, p_amount_paise);
end $$;

create function public.settle_fixed_cost_month(
  p_fixed_cost_id uuid,
  p_month date,
  p_amount_paise bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if p_amount_paise is null or p_amount_paise < 0 then
    raise exception 'A month is settled at a number of rupees.' using errcode = '22023';
  end if;
  insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
  values (p_fixed_cost_id, v_cost.outlet_id, p_month, p_amount_paise);
end $$;

revoke all on function
  public.change_fixed_cost_amount(uuid, date, bigint),
  public.settle_fixed_cost_month(uuid, date, bigint)
  from public, anon;
grant execute on function
  public.change_fixed_cost_amount(uuid, date, bigint),
  public.settle_fixed_cost_month(uuid, date, bigint)
  to authenticated;

-- ── Reads ───────────────────────────────────────────────────────────────────

-- Everything the screens fold: an outlet's fixed costs, ongoing first, each
-- with its amounts, settlements and effective payments, and the business date.
-- What `FixedCostsAdapter.list` returns; `src/domain/fixed-costs.ts` derives
-- every figure from it, so no two screens can disagree.
create function public.fixed_costs_list(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.overview_assert_outlet(p_outlet_id);
  perform public.fixed_costs_assert_outlet(p_outlet_id);
  return jsonb_build_object(
    'today', public.fixed_costs_today(p_outlet_id),
    'costs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'category', c.category,
        'note', c.note,
        'startsOn', c.starts_on,
        'stopsOn', c.stops_on,
        'amounts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'fromMonth', a.from_month, 'amountPaise', a.amount_paise,
            'createdAt', a.created_at, 'voidedAt', a.voided_at,
            'paymentId', a.fixed_cost_payment_id) order by a.from_month, a.created_at)
            from public.fixed_cost_amounts a where a.fixed_cost_id = c.id), '[]'::jsonb),
        'settlements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'month', s.month, 'amountPaise', s.amount_paise,
            'createdAt', s.created_at, 'voidedAt', s.voided_at,
            'paymentId', s.fixed_cost_payment_id) order by s.month, s.created_at)
            from public.fixed_cost_settlements s where s.fixed_cost_id = c.id), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'expenseId', p.expense_id, 'amountPaise', e.amount_paise,
            'countsIn', e.business_date, 'paidOn', p.paid_on, 'isCash', e.is_cash,
            'note', nullif(btrim(regexp_replace(
                      case when starts_with(coalesce(e.description, ''), c.name)
                           then substr(e.description, length(c.name) + 1)
                           else e.description end,
                      '^\s*·\s*', '')), ''),
            'createdAt', p.created_at) order by e.business_date, p.created_at)
            from public.fixed_cost_payments p
            join public.expenses e on e.id = p.expense_id
           where p.fixed_cost_id = c.id and e.voided_at is null), '[]'::jsonb)
      ) order by c.stops_on is not null, c.created_at)
        from public.fixed_costs c
       where c.outlet_id = p_outlet_id), '[]'::jsonb));
end $$;

-- Needs attention (design D7): fixed costs with an ended month that payments
-- have not covered, across the outlets the reader may see, and those months.
-- First in, first out, an ended month is short exactly where the running total
-- of costs passes what has been paid so far.
create function public.fixed_costs_unpaid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := coalesce(public.app_is_owner(), false);
begin
  if not coalesce(public.app_account_active(), false) then
    return jsonb_build_object('count', 0, 'months', '[]'::jsonb);
  end if;
  return (
    with reach as (
      select c.id, public.fixed_costs_today(c.outlet_id) as today
        from public.fixed_costs c
       where v_owner or c.outlet_id in (select public.app_outlets_for('franchise_admin'))
    ),
    short as (
      select r.id, m.month
        from reach r
        cross join lateral public.fixed_cost_months(
          r.id, (date_trunc('month', r.today::timestamp) - interval '1 month')::date) m
       where m.cumulative_paise > public.fixed_cost_paid_paise(r.id, r.today)
    )
    select jsonb_build_object(
      'count', (select count(distinct short.id) from short),
      'months', coalesce((select jsonb_agg(distinct short.month order by short.month)
                            from short), '[]'::jsonb)));
end $$;

revoke all on function
  public.fixed_costs_assert_outlet(uuid),
  public.fixed_cost_month_cost(uuid, date),
  public.fixed_cost_months(uuid, date),
  public.fixed_cost_paid_paise(uuid, date),
  public.fixed_cost_is_prorated(uuid, date),
  public.fixed_costs_today(uuid),
  public.create_fixed_cost(uuid, text, text, bigint, date, text),
  public.update_fixed_cost(uuid, text, text, date, text),
  public.stop_fixed_cost(uuid, date, boolean),
  public.record_fixed_cost_payment(uuid, uuid, bigint, date, date, boolean, text, text),
  public.undo_fixed_cost_payment(uuid, uuid),
  public.fixed_costs_list(uuid),
  public.fixed_costs_unpaid()
  from public, anon;
grant execute on function
  public.fixed_costs_assert_outlet(uuid),
  public.fixed_cost_month_cost(uuid, date),
  public.fixed_cost_months(uuid, date),
  public.fixed_cost_paid_paise(uuid, date),
  public.fixed_cost_is_prorated(uuid, date),
  public.fixed_costs_today(uuid),
  public.create_fixed_cost(uuid, text, text, bigint, date, text),
  public.update_fixed_cost(uuid, text, text, date, text),
  public.stop_fixed_cost(uuid, date, boolean),
  public.record_fixed_cost_payment(uuid, uuid, bigint, date, date, boolean, text, text),
  public.undo_fixed_cost_payment(uuid, uuid),
  public.fixed_costs_list(uuid),
  public.fixed_costs_unpaid()
  to authenticated;
