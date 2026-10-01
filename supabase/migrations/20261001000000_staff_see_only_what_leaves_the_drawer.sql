-- ===========================================================================
-- Staff see only what leaves the drawer
--
-- On the first days of a month the owner records the month's fixed costs:
-- salaries, rent, the vendors billed monthly. Until this migration every one of
-- those rows was readable by every Biller and Employee at the outlet, and by
-- the counter tablet, on any date. Measured on production 2026-10-01: 32 owner
-- non-cash rows (Rs 5,00,923, six of them Salary) and 58 Hyperpure rows were
-- readable by staff, while every one of the 133 expenses staff have recorded is
-- cash.
--
-- The owner's rule [2026-10-01]: staff need only the expenses that came out of
-- the drawer. Staff cannot pay with the business's UPI; when they pay from their
-- own, the business repays them from the drawer, which is a cash expense
-- recorded when the cash leaves.
--
-- This reverses the-ledger-opens-to-the-outlet (#38) design D2, which held that
-- hiding an expense row protects nothing because it is not a revenue figure. A
-- salary is the counter-example.
--
-- What moves, and nothing else:
--
--   * `expenses_select`: the counter-shift branch and the biller/employee
--     branch each gain `is_cash`. The owner and manager branches are unchanged.
--   * `expenses_insert`: the same two branches gain `is_cash`.
--   * `expenses_update`: the own-row staff branch gains `is_cash` on both sides.
--   * `expense_guard()`: one clause raising a sentence for a staff or counter
--     write that is not cash. Every other line is the body production runs.
--
-- `effective_expenses` is security_invoker and inherits the narrowing. The
-- drawer readers are security definer behind `app_may_reach_drawer()` and keep
-- counting every cash expense, so no drawer figure changes. No row is touched.

-- ---------------------------------------------------------------------------
-- 1. The policies.

drop policy expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          (public.app_has_role_at('biller', outlet_id)
           or public.app_has_role_at('employee', outlet_id))
          and is_cash
        )
      )
    )
  );

drop policy expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and recorded_by = auth.uid()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          (public.app_has_role_at('biller', outlet_id)
           or public.app_has_role_at('employee', outlet_id))
          and is_cash
        )
      )
    )
  );

drop policy expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and (public.app_has_role_at('biller', outlet_id)
             or public.app_has_role_at('employee', outlet_id))
        and is_cash
      )
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and (public.app_has_role_at('biller', outlet_id)
             or public.app_has_role_at('employee', outlet_id))
        and is_cash
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The guard, with its one new clause.

create or replace function public.expense_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'a expense row''s identity (outlet, business date, recorder) is immutable';
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
        'a expense row cannot be recorded as already corrected';
    end if;
  else
    if new.updated_by is distinct from old.updated_by
       and new.updated_by is distinct from auth.uid() then
      raise exception
        'a expense row''s correcting account is stamped by the database, not supplied';
    end if;
    new.updated_by := auth.uid();
  end if;

  if tg_table_name = 'expenses' then
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

    -- Staff and the counter handle the drawer and nothing else, so what they
    -- record is cash. Raised here rather than left to the policy so the
    -- counter's outbox keeps a sentence the operator can act on: the policy
    -- refuses the same write, with the generic RLS message, if this is ever
    -- rewritten away (staff-see-only-what-leaves-the-drawer, design D2).
    if (v_operator is not null or v_is_staff) and not new.is_cash then
      raise exception
        'staff record only what leaves the drawer; a manager or the owner records the rest'
        using errcode = '42501';
    end if;

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
$function$;
