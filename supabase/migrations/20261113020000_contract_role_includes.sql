-- retire-role-includes, 3.1: the contract half of `role-includes`, the cleanup
-- `staff-roles-include-other-roles` design D8 describes. Every build since
-- `01f82d0a` (first live in Deploy 41164443637, 31 October) asks only the
-- includes rows. Every registered device runs a build that contains it: on 3
-- November, Cafe Laptop, Conti Kitchen and Shawarma Kitchen on `c83ec673`,
-- after three services on it (31 October, 1 and 2 November).
-- release: contract role-includes
--
-- What reads the key, in production and on a fresh reset on 3 November: the ten
-- gated twins (design D3), and nothing else. Every check below gives every role
-- that exists the answer it gave before, which 98_staff_roles_include_other_roles
-- proves against a frozen copy of each old check.
--
-- 1. Each of the ten policies takes its twin's expression, without the gate, and
--    the twin goes. Before the row is retired, so no moment has a twin answering
--    off beside an original that still names roles.
-- 2. The three objects of design D4 ask the includes rows in place:
--    `expense_guard`, `account_actor_may_replace_set` and
--    `app_may_hold_counter_shift`. After this a new staff role can be made.
-- 3. Each original a `_v2` replaced becomes a thin call to it. No published build
--    since the retirement calls one, and the policies no longer read
--    `app_may_see_person`; they stay, as calls, so a Republish to a build from
--    before the retirement still reaches a function, and go in a later cleanup.
--    Every `_v2` stays.
-- 4. The row is retired.

-- 1. The policies --------------------------------------------------------------

alter policy assignments_insert on public.assignments
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );
drop policy assignments_insert_includes on public.assignments;

alter policy assignments_update on public.assignments
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );
drop policy assignments_update_includes on public.assignments;

alter policy expense_categories_insert on public.expense_categories
  with check (
    public.app_account_active()
    and created_by = auth.uid()
    and (
      (select public.app_is_owner())
      or exists (select 1 from public.app_outlets_for('franchise_admin'))
      or exists (select 1 from public.app_outlets_acting_as('employee'))
    )
  );
drop policy expense_categories_insert_includes on public.expense_categories;

alter policy expenses_insert on public.expenses
  with check (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and recorded_by = auth.uid()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          public.app_acts_as('employee', outlet_id)
          and is_cash
        )
      )
    )
  );
drop policy expenses_insert_includes on public.expenses;

alter policy expenses_select on public.expenses
  using (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          public.app_acts_as('employee', outlet_id)
          and is_cash
        )
      )
    )
  );
drop policy expenses_select_includes on public.expenses;

alter policy expenses_update on public.expenses
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and public.app_acts_as('employee', outlet_id)
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
        and public.app_acts_as('employee', outlet_id)
        and is_cash
      )
    )
  );
drop policy expenses_update_includes on public.expenses;

alter policy menu_categories_select on public.menu_categories
  using (
    public.app_device_ok() and (
      outlet_id = (select public.app_counter_shift_outlet())
      or outlet_id = (select public.app_kitchen_shift_outlet())
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or outlet_id in (select public.app_outlets_acting_as('biller'))))));
drop policy menu_categories_select_includes on public.menu_categories;

alter policy menu_discounts_select on public.menu_discounts
  using (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_acting_as('biller'))
        )
      )
    )
  );
drop policy menu_discounts_select_includes on public.menu_discounts;

alter policy menu_items_select on public.menu_items
  using (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_acting_as('biller'))
        )
      )
    )
  );
drop policy menu_items_select_includes on public.menu_items;

alter policy profiles_select on public.profiles
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      id = auth.uid()
      or (select public.app_is_owner())
      or public.app_may_see_person_v2(id)
    )
  );
drop policy profiles_select_includes on public.profiles;

-- 2. What waited for the cleanup (design D4) ----------------------------------

-- The expense trigger: staff here is anyone who can act as an Employee, and not
-- a manager or the owner. The one changed line is `v_is_staff`'s pair of role
-- checks, now one `app_acts_as`.
create or replace function public.expense_guard()
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
      and public.app_acts_as('employee', new.outlet_id);

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
$$;

-- Which roles a manager may set on Team: the staff roles, those that include an
-- Employee. The two changed lines are the role lists, read from the rows.
create or replace function public.account_actor_may_replace_set(
  p_actor_id uuid,
  p_profile_id uuid,
  p_desired jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_is_owner boolean;
  v_actor_managed uuid[];
begin
  if p_actor_id = p_profile_id then return false; end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_actor_id and p.is_active
  ) then return false; end if;

  select exists (
    select 1 from public.assignments a
     where a.person_id = p_actor_id
       and a.role = 'super_admin'
       and a.ended_on is null
  ) into v_actor_is_owner;
  if v_actor_is_owner then return true; end if;

  select coalesce(array_agg(a.outlet_id), '{}'::uuid[])
    into v_actor_managed
    from public.assignments a
   where a.person_id = p_actor_id
     and a.role = 'franchise_admin'
     and a.ended_on is null;
  if cardinality(v_actor_managed) = 0 then return false; end if;

  if exists (
    select 1 from public.assignments a
     where a.person_id = p_profile_id
       and a.ended_on is null
       and (
         not public.app_role_includes(a.role, 'employee')
         or a.outlet_id is null
         or not (a.outlet_id = any(v_actor_managed))
       )
  ) then return false; end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_desired, '[]'::jsonb))
        as wanted("outletId" uuid, role public.app_role)
     where not public.app_role_includes(wanted.role, 'employee')
        or wanted."outletId" is null
        or not (wanted."outletId" = any(v_actor_managed))
  ) then return false; end if;

  return true;
end;
$$;

-- Who may hold the counter: the owner anywhere; here, a manager or anyone whose
-- role includes a Biller. The one changed line is the role list.
create or replace function public.app_may_hold_counter_shift(person uuid, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = person and p.is_active)
     and exists (
       select 1 from public.assignments a
        where a.person_id = person
          and a.ended_on is null
          and (
            a.role = 'super_admin'
            or ((public.app_role_includes(a.role, 'biller') or a.role = 'franchise_admin')
                and a.outlet_id = outlet)
          )
     )
$$;

-- 3. The originals a `_v2` replaced -----------------------------------------

create or replace function public.attendance_submit_attempt(
  p_attempt_id uuid,
  p_outlet_id uuid,
  p_business_date date,
  p_attempted_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric,
  p_expected_version integer default null
)
returns public.attendance
language sql
security definer
set search_path = ''
as $$
  select public.attendance_submit_attempt_v2(
    p_attempt_id, p_outlet_id, p_business_date, p_attempted_at,
    p_lat, p_lng, p_accuracy_m, p_expected_version)
$$;

create or replace function public.attendance_record_manual(
  p_attempt_id uuid,
  p_decision_id uuid,
  p_person_id uuid,
  p_outlet_id uuid,
  p_business_date date,
  p_attempted_at timestamptz
)
returns public.attendance
language sql
security definer
set search_path = ''
as $$
  select public.attendance_record_manual_v2(
    p_attempt_id, p_decision_id, p_person_id, p_outlet_id, p_business_date, p_attempted_at)
$$;

create or replace function public.attendance_elsewhere(p_outlets uuid[], p_business_date date)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.attendance_elsewhere_v2(p_outlets, p_business_date)
$$;

create or replace function public.expense_people()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.expense_people_v2()
$$;

create or replace function public.review_billing_attribution(
  p_bill_id uuid,
  p_outcome text,
  p_resolved_operator_id uuid default null,
  p_reason text default null
)
returns public.billing_attribution_reviews
language sql
security definer
set search_path = ''
as $$
  select public.review_billing_attribution_v2(
    p_bill_id, p_outcome, p_resolved_operator_id, p_reason)
$$;

create or replace function public.app_may_see_person(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_may_see_person_v2(person)
$$;

-- 4. The row -----------------------------------------------------------------

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'role-includes';
