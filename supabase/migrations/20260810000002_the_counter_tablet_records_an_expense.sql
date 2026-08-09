-- One branch, and nothing else.
--
-- `counter-expenses` and `staff-expenses` went live in #38, so the Biller shell
-- carries a real Expenses surface. A billing-only tablet would strand it, and
-- the owner's decision is that the tablet keeps it: the drawer is at the counter
-- and the person spending is usually the person billing.
--
-- What that costs is exactly two things, and they are written here rather than
-- spread across the ledger:
--
--   * a device session may INSERT an expense for its own tablet's outlet, only
--     while it holds a live shift, only against that outlet's current trading
--     day, and the row is attributed to the shift's operator, read from the
--     shift rather than from the request body;
--   * a device session may SELECT that outlet's expenses while it holds a live
--     shift, because a surface that records one has to list them.
--
-- It gains nothing else. No day record on any verb, and therefore no month
-- total, which is derived from the day records in the client. No correction and
-- no withdrawal: the row belongs to the person who recorded it and they hold it
-- on their own device, where a shared tablet cannot be handed to somebody else
-- mid-shift.
--
-- This is the one policy in this change where over-permission would be silent, so
-- supabase/tests/24_counter_tablet_expense.sql is its own file with its own gate
-- and pins the policy set on both tables by name.

-- ---------------------------------------------------------------------------
-- 1. Attribution and the date rule, in the guard.
--
-- Both belong here rather than in the policy. A policy cannot rewrite the row it
-- is admitting, and the date rule needs the outlet's cutover, which the guard
-- has already resolved by the time it runs.
--
-- The device branch is placed BEFORE `recorded_away` is stamped, because that
-- stamp reads `recorded_by` and would otherwise be answering about whoever the
-- tablet happened to name.

create or replace function public.manual_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_today date;
  v_is_staff boolean;
  v_operator uuid;
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

  if tg_op = 'INSERT' then
    if new.updated_by is not null then
      raise exception
        'a manual ledger row cannot be recorded as already corrected';
    end if;
  else
    if new.updated_by is distinct from old.updated_by
       and new.updated_by is distinct from auth.uid() then
      raise exception
        'a manual ledger row''s correcting account is stamped by the database, not supplied';
    end if;
    new.updated_by := auth.uid();
  end if;

  if tg_table_name = 'manual_ledger_expenses' then
    if tg_op = 'INSERT' then
      -- The counter tablet. `recorded_by` defaults to `auth.uid()`, which for a
      -- device session is the machine — a value with no profile row, so the
      -- foreign key would refuse it and the refusal would read as a bug rather
      -- than as a rule. The shift is the thing that knows who is standing there,
      -- so the shift is what answers.
      v_operator := public.app_counter_shift_operator();
      if v_operator is not null then
        new.recorded_by := v_operator;

        -- The counter's own date rule. The staff test below cannot fire for a
        -- device session — it asks about assignments and a tablet holds none —
        -- so without this a tablet would be the one session able to backdate an
        -- expense, which is the opposite of what a shared surface should allow.
        if new.business_date <> v_today then
          raise exception
            'an expense noticed later belongs to the manager or the owner to add; '
            'this outlet''s trading day is %', v_today;
        end if;
      end if;

      new.recorded_away :=
        not public.app_person_assigned_at(new.recorded_by, new.outlet_id);
    else
      if new.recorded_away is distinct from old.recorded_away then
        raise exception
          'whether an expense was recorded from away is stamped once and never edited';
      end if;

      if old.voided_at is not null then
        raise exception
          'this expense was withdrawn on % and cannot be changed; record a new one instead',
          old.voided_at;
      end if;

      if new.voided_at is not null then
        if new.voided_by is null then
          new.voided_by := auth.uid();
        elsif new.voided_by is distinct from auth.uid() then
          raise exception
            'an expense is withdrawn by the account doing it, and cannot be attributed elsewhere';
        end if;
        new.voided_at := now();
      end if;
    end if;

    v_is_staff := not (select public.app_is_owner())
      and not public.app_has_role_at('franchise_admin', new.outlet_id)
      and (
        public.app_has_role_at('biller', new.outlet_id)
        or public.app_has_role_at('employee', new.outlet_id)
      );

    if v_is_staff then
      if tg_op = 'INSERT' then
        if new.business_date <> v_today then
          raise exception
            'an expense noticed later belongs to the manager or the owner to add; '
            'this outlet''s trading day is %', v_today;
        end if;
      elsif old.business_date <> v_today then
        raise exception
          'this expense''s day (%) has closed; a manager or the owner can still correct it',
          old.business_date;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The two policy branches.
--
-- Written as a leading disjunct on the existing predicate rather than as a new
-- policy, so `pg_policies` keeps showing three policies on this table and the
-- reach of the whole table stays readable in one place.
--
-- `app_counter_shift_outlet()` is null for every session that is not a tablet
-- holding a live shift, and `outlet_id = null` is null rather than true, so the
-- branch adds nothing for anybody else.

drop policy manual_ledger_expenses_select on public.manual_ledger_expenses;
create policy manual_ledger_expenses_select on public.manual_ledger_expenses
  for select to authenticated
  using (
    outlet_id = (select public.app_counter_shift_outlet())
    or (
      public.app_account_active()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or public.app_has_role_at('biller', outlet_id)
        or public.app_has_role_at('employee', outlet_id)
      )
    )
  );

-- No `recorded_by = auth.uid()` on the counter branch, and it is not an
-- omission: for a device session `auth.uid()` is the tablet, and the guard has
-- already replaced the column with the shift's operator by the time this is
-- checked. Requiring equality here would refuse every row the branch exists to
-- admit.
drop policy manual_ledger_expenses_insert on public.manual_ledger_expenses;
create policy manual_ledger_expenses_insert on public.manual_ledger_expenses
  for insert to authenticated
  with check (
    outlet_id = (select public.app_counter_shift_outlet())
    or (
      public.app_account_active()
      and recorded_by = auth.uid()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or public.app_has_role_at('biller', outlet_id)
        or public.app_has_role_at('employee', outlet_id)
      )
    )
  );

-- `manual_ledger_expenses_update` is deliberately untouched, and so is every
-- policy on `manual_ledger_days`.

-- ---------------------------------------------------------------------------
-- 3. The category a tablet spells for the first time.
--
-- #38 grows the category list from use: an unrecognised category on an expense
-- creates the category and stamps `created_by` from `auth.uid()`. For a device
-- session that value is the machine, which has no profile row, so the foreign
-- key refused the whole insert — and the refusal named `expense_categories`,
-- which is not where anybody would look.
--
-- The shift's operator answers here for the same reason it answers for
-- `recorded_by`: they are the person who typed it. `coalesce` rather than a
-- branch, because for every other session `app_counter_shift_operator()` is null
-- and the behaviour is unchanged.
--
-- The two triggers on this table are ordered by name — `..._capture_category`
-- runs before `..._guarded` — so this cannot read `new.recorded_by`, which the
-- guard has not corrected yet.

create or replace function public.capture_expense_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if new.category is null
     or new.category = ''
     or new.category <> public.normalize_expense_category(new.category) then
    raise exception 'expense category must be present and normalised'
      using errcode = 'check_violation';
  end if;

  select name into v_existing
    from public.expense_categories
   where lower(name) = lower(new.category);

  if v_existing is null then
    insert into public.expense_categories (name, created_by)
    values (new.category, coalesce(public.app_counter_shift_operator(), auth.uid()))
    on conflict do nothing
    returning name into v_existing;

    if v_existing is null then
      select name into v_existing
        from public.expense_categories
       where lower(name) = lower(new.category);
    end if;
  end if;

  new.category := v_existing;
  return new;
end;
$$;
