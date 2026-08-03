-- The manual ledger: a temporary owner-only notebook, designed to be deleted.
--
-- Billing (#10), expenses and inventory (#11) and daily cash (#12) are not live,
-- so August 2026 is trading with no record of what it sold, what it spent or what
-- was in the drawer. These two tables are where the owner writes that down until
-- those surfaces land, so that month-end profit and a daily cash check are
-- answerable rather than reconstructed from memory in September.
--
-- Two properties are deliberate and worth stating before the columns:
--
--   * **Every derived figure is absent.** No view, no generated column, no
--     trigger computing anything. Expected cash, the difference, net aggregator
--     revenue and the monthly profit estimate are all computed in one tested
--     TypeScript module. What lives here is facts and the constraints that keep
--     them possible, so retirement is a migration that drops two tables rather
--     than an archaeology of views and functions (design D3).
--
--   * **Commission rates and opening cash are stored per day**, not derived from
--     the previous row. Correcting day 3's count must not silently move day 4
--     through day 31's expected cash, which is precisely the compounding error
--     this ledger exists to catch (design D2).
--
-- The `manual_ledger_` prefix is load-bearing: it makes the retirement query
-- obvious and an accidental reference from a live surface greppable.
--
-- **These tables are not the live cash or expense record and grant no authority
-- that survives them.** The owner may write cash figures here because no drawer
-- record exists yet to corrupt; `docs/LIMITATIONS.md` still holds, and the
-- change that removes this capability must first carry these rows into the real
-- tables (#12).

-- ---------------------------------------------------------------------------
-- manual_ledger_days — one row per outlet per business date.

create table public.manual_ledger_days (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,

  -- What the drawer held when the day started. Stored, not derived: the form
  -- offers the previous day's count as a default and the owner may overwrite it
  -- (design D2).
  opening_cash_paise bigint not null check (opening_cash_paise >= 0),

  -- Revenue by channel. Negative is PERMITTED, because a cash refund is
  -- recorded by lowering that day's cash revenue rather than by inventing a
  -- negative expense.
  cash_revenue_paise bigint not null default 0,
  upi_revenue_paise bigint not null default 0,
  zomato_revenue_paise bigint not null default 0,
  swiggy_revenue_paise bigint not null default 0,

  -- Cash into and out of the drawer, each with a reason. Cash out is also how a
  -- capital purchase paid from the drawer is recorded: it is not an expense, but
  -- the drawer is genuinely lighter, and without this the first large purchase
  -- silently reads as a cash loss (design D8).
  cash_added_paise bigint not null default 0 check (cash_added_paise >= 0),
  cash_added_reason text,
  cash_removed_paise bigint not null default 0 check (cash_removed_paise >= 0),
  cash_removed_reason text,

  -- The count at close. The one figure this whole surface exists to compare
  -- something against.
  counted_cash_paise bigint not null check (counted_cash_paise >= 0),

  -- Basis points, so 2250 is 22.5%. Integers for the same reason money is:
  -- a percentage held as a float reintroduces exactly the rounding argument the
  -- paise rule settles.
  zomato_commission_bp integer not null check (zomato_commission_bp between 0 and 10000),
  swiggy_commission_bp integer not null check (swiggy_commission_bp between 0 and 10000),

  -- Optional, unlike an expense description: it exists to explain a cash
  -- difference, and most days have none to explain.
  note text,

  -- Who first recorded this day. Defaulted from the session so a screen never
  -- has to supply it, and frozen by the guard below so a later edit cannot
  -- rewrite it — including an edit by the business's other owner, who may
  -- correct the day but does not become its author.
  recorded_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint manual_ledger_days_one_per_outlet_day unique (outlet_id, business_date),

  -- A reason is required exactly when cash moved, and is never blank when
  -- present (blank-is-not-a-value, #19).
  constraint manual_ledger_days_cash_added_reason check (
    (cash_added_paise = 0 or length(btrim(coalesce(cash_added_reason, ''))) > 0)
    and (cash_added_reason is null or length(btrim(cash_added_reason)) > 0)
  ),
  constraint manual_ledger_days_cash_removed_reason check (
    (cash_removed_paise = 0 or length(btrim(coalesce(cash_removed_reason, ''))) > 0)
    and (cash_removed_reason is null or length(btrim(cash_removed_reason)) > 0)
  ),
  constraint manual_ledger_days_note_not_blank check (
    note is null or length(btrim(note)) > 0
  )
);

create index manual_ledger_days_outlet_business_date_idx
  on public.manual_ledger_days (outlet_id, business_date);

alter table public.manual_ledger_days enable row level security;

create trigger manual_ledger_days_set_updated_at
  before update on public.manual_ledger_days
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- manual_ledger_expenses — many rows per outlet per business date.

create table public.manual_ledger_expenses (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,

  -- The existing shared enum, reused unchanged, so a recorded row maps
  -- one-to-one onto the live `expenses` table at retirement with no translation
  -- table and no lossy guess. It already contains no value for aggregator
  -- commission, cash banked or an owner drawing — each of which is accounted for
  -- elsewhere, and a category for it would double-count it (design D8).
  category public.expense_category not null,

  -- Only a cash expense reaches the drawer. A boolean rather than the
  -- `payment_method` enum: this ledger's arithmetic asks exactly one question of
  -- an expense, and card-versus-UPI is a distinction #11 will care about.
  is_cash boolean not null,

  amount_paise bigint not null check (amount_paise > 0),

  -- REQUIRED, unlike `expenses.description`. A category and an amount identify a
  -- purchase for about a week; `raw_materials ₹2,400` is unidentifiable by month
  -- end, and an expense nobody can identify is not a record — which defeats the
  -- only purpose this ledger has (design D10).
  description text not null,

  recorded_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint manual_ledger_expenses_description_not_blank check (
    length(btrim(description)) > 0
  )
);

-- No capital marker on either table. Capital spending is not recorded here at
-- all (owner decision, 2026-08-04), so a boolean for it would always be false —
-- worse than no column, because it would imply the monthly figure accounts for
-- equipment when nothing in this ledger does. The figure is an operating
-- estimate and the surface says so.

create index manual_ledger_expenses_outlet_business_date_idx
  on public.manual_ledger_expenses (outlet_id, business_date);

alter table public.manual_ledger_expenses enable row level security;

create trigger manual_ledger_expenses_set_updated_at
  before update on public.manual_ledger_expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The guard, shared by both tables: no future business date, and a frozen
-- identity.
--
-- **No future date.** A trigger rather than a CHECK, because a CHECK reading the
-- clock is a constraint that can stop being true of a row already stored, and it
-- makes a dump unrestorable. "Today" is the outlet's own trading day through the
-- existing helper, not the server's calendar date: a figure entered at 00:30
-- still belongs to the session that is running.
--
-- **Frozen identity.** Which outlet, which day, and who recorded it are not
-- editable. Correcting a figure is the whole point of this notebook; moving a
-- day to another date or outlet is not a correction but a second row wearing the
-- first one's history, and it would slip past the uniqueness constraint. This is
-- the same treatment `attendance_guard()` gives the attendance row's identity.

create or replace function public.manual_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_today date;
begin
  if tg_op = 'UPDATE' then
    if new.outlet_id is distinct from old.outlet_id
       or new.business_date is distinct from old.business_date
       or new.recorded_by is distinct from old.recorded_by then
      raise exception
        'a manual ledger row''s identity (outlet, business date, recorder) is immutable';
    end if;
  end if;

  select business_day_cutover into v_cutover
    from public.outlets
   where id = new.outlet_id;

  if v_cutover is null then
    raise exception 'unknown outlet %', new.outlet_id;
  end if;

  v_today := public.app_business_date(now(), v_cutover);

  if new.business_date > v_today then
    raise exception
      'manual ledger business date % is in the future (today is % at this outlet)',
      new.business_date, v_today;
  end if;

  return new;
end;
$$;

create trigger manual_ledger_days_guarded
  before insert or update on public.manual_ledger_days
  for each row execute function public.manual_ledger_guard();

create trigger manual_ledger_expenses_guarded
  before insert or update on public.manual_ledger_expenses
  for each row execute function public.manual_ledger_guard();

-- ---------------------------------------------------------------------------
-- Grants.
--
-- DELETE appears here, which is the second and third exception to the rule
-- 20260726000010_grants_hygiene.sql states: history is voided or corrected,
-- never removed. The rule protects a ledger of record read by several roles, and
-- these tables are neither — they are a notebook with exactly one reader and one
-- writer, holding four weeks of figures, where a day typed against the wrong
-- date is a mistake with no story worth keeping. Every other table in the schema
-- is still client-deletable by nobody, and both of these disappear entirely when
-- #12 carries their rows across.

grant select, insert, update, delete on public.manual_ledger_days to authenticated;
grant select, insert, update, delete on public.manual_ledger_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- Policies.
--
-- Owner-only, and there is deliberately NO outlet-role predicate anywhere below:
-- no outlet role has any access to grant. A Franchise Admin, Biller or Employee
-- is refused every verb on both tables at every outlet, including their own —
-- which is a stronger claim than ordinary outlet isolation, and is why
-- supabase/tests/21_manual_ledger.sql writes it out rather than inheriting it
-- from the generic sweep.
--
-- `app_account_active()` is what makes deactivating the account end this access
-- on the next request rather than at token expiry, and `app_is_owner()` reads
-- live assignments, so ending the Super Admin assignment ends it the same way.

create policy manual_ledger_days_select on public.manual_ledger_days
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy manual_ledger_days_insert on public.manual_ledger_days
  for insert to authenticated
  with check (
    public.app_is_owner()
    and public.app_account_active()
    and recorded_by = auth.uid()
  );

-- No `recorded_by = auth.uid()` on the UPDATE branch, deliberately. The guard
-- freezes that column, so the business's other owner may correct a day without
-- either forging the attribution or being refused by it.
create policy manual_ledger_days_update on public.manual_ledger_days
  for update to authenticated
  using (public.app_is_owner() and public.app_account_active())
  with check (public.app_is_owner() and public.app_account_active());

create policy manual_ledger_days_delete on public.manual_ledger_days
  for delete to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy manual_ledger_expenses_select on public.manual_ledger_expenses
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy manual_ledger_expenses_insert on public.manual_ledger_expenses
  for insert to authenticated
  with check (
    public.app_is_owner()
    and public.app_account_active()
    and recorded_by = auth.uid()
  );

create policy manual_ledger_expenses_update on public.manual_ledger_expenses
  for update to authenticated
  using (public.app_is_owner() and public.app_account_active())
  with check (public.app_is_owner() and public.app_account_active());

create policy manual_ledger_expenses_delete on public.manual_ledger_expenses
  for delete to authenticated
  using (public.app_is_owner() and public.app_account_active());
