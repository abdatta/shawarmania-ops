-- Expenses, the employee roster, and attendance.

-- ---------------------------------------------------------------------------
-- expenses — recorded, never edited in v1: the capability matrix grants
-- Franchise Admins "record", and a correction is a story the ledger of
-- record should tell, not an overwrite.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,
  category public.expense_category not null,
  description text,
  amount_paise bigint not null check (amount_paise > 0),
  payment_method public.payment_method not null,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index expenses_outlet_business_date_idx on public.expenses (outlet_id, business_date);

alter table public.expenses enable row level security;

revoke update, delete on public.expenses from authenticated, anon;

-- ---------------------------------------------------------------------------
-- employees — the HR roster, deliberately separate from profiles (the auth
-- mirror). An employee can exist before, or entirely without, an app login.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  profile_id uuid unique references public.profiles (id),
  employee_code text not null,
  full_name text not null,
  phone text,
  salary_paise bigint not null default 0 check (salary_paise >= 0),
  address text,
  role_title text,
  employment_status public.employment_status not null default 'active',
  joined_on date,
  constraint employees_code_unique_per_outlet unique (outlet_id, employee_code)
);

create index employees_outlet_id_idx on public.employees (outlet_id);

alter table public.employees enable row level security;

-- A linked login must belong to the same outlet as the roster row.
create or replace function public.employee_profile_same_outlet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  if new.profile_id is null then
    return new;
  end if;

  select outlet_id into v_outlet
    from public.profiles
   where id = new.profile_id;

  if v_outlet is distinct from new.outlet_id then
    raise exception 'linked profile must belong to the employee''s outlet';
  end if;

  return new;
end;
$$;

create trigger employees_profile_same_outlet
  before insert or update on public.employees
  for each row execute function public.employee_profile_same_outlet();

-- Which outlet does a roster row belong to? Used by attendance policies for
-- writers (the counter device) that cannot read the roster itself.
create or replace function public.app_employee_outlet(emp uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.outlet_id from public.employees e where e.id = emp
$$;

revoke execute on function public.app_employee_outlet(uuid) from public, anon;
grant execute on function public.app_employee_outlet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- attendance — the inputs are stored beside the verdict, so a disputed
-- check-in is reviewable instead of a black box.

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  employee_id uuid not null references public.employees (id),
  business_date date not null,
  status public.attendance_status not null,
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_in_accuracy_m double precision,
  check_in_distance_m double precision,
  check_in_source public.check_in_source,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_accuracy_m double precision,
  check_out_distance_m double precision,
  check_out_source public.check_in_source,
  override_by uuid references public.profiles (id),
  override_reason text,
  override_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_one_per_employee_day unique (employee_id, business_date),
  constraint attendance_override_complete check (
    (override_by is null and override_reason is null and override_at is null)
    or (override_by is not null and override_reason is not null and override_at is not null)
  ),
  constraint attendance_checkout_needs_checkin
    check (check_out_at is null or check_in_at is not null)
);

create index attendance_outlet_business_date_idx on public.attendance (outlet_id, business_date);

alter table public.attendance enable row level security;

create trigger attendance_business_date_valid
  before insert or update on public.attendance
  for each row execute function public.validate_business_date();

-- Identity columns are frozen, and only managers touch overrides. The role
-- gate applies to client sessions; seeds run without one.
create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.employee_id is distinct from old.employee_id
       or new.outlet_id is distinct from old.outlet_id
       or new.business_date is distinct from old.business_date then
      raise exception 'attendance identity (employee, outlet, business date) is immutable';
    end if;
  end if;

  if auth.uid() is not null then
    if (tg_op = 'INSERT' and new.override_by is not null)
       or (tg_op = 'UPDATE' and (
            new.override_by is distinct from old.override_by
            or new.override_reason is distinct from old.override_reason
            or new.override_at is distinct from old.override_at
          )) then
      if public.app_role() not in ('franchise_admin', 'super_admin') then
        raise exception 'only a franchise admin or super admin may record an override';
      end if;
      if new.override_by is distinct from auth.uid() then
        raise exception 'override_by must be the overriding session';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger attendance_guarded
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

create trigger attendance_no_delete
  before delete on public.attendance
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Policies.

create policy expenses_select on public.expenses
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
    and recorded_by = auth.uid()
  );

-- employees: managers manage; an employee may read their own roster row
-- (name, code — what their attendance screen shows).
create policy employees_select on public.employees
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or profile_id = auth.uid()
    )
  );

create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy employees_update on public.employees
  for update to authenticated
  using (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  )
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

-- attendance reads: managers see the outlet; an employee sees only their own
-- rows — reviewing the team is a manager's job.
create policy attendance_select on public.attendance
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or employee_id in (
        select e.id from public.employees e where e.profile_id = auth.uid()
      )
    )
  );

-- attendance writes: an employee checks themselves in from their phone; the
-- counter tablet is the secondary path and stamps its source; a Franchise
-- Admin records for their outlet (including overrides, gated by trigger).
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and outlet_id = public.app_outlet_id()
    and (
      (
        public.app_role() = 'franchise_admin'
        and public.app_employee_outlet(employee_id) = public.app_outlet_id()
      )
      or (
        public.app_role() = 'employee'
        and check_in_source = 'phone'
        and employee_id in (
          select e.id from public.employees e where e.profile_id = auth.uid()
        )
      )
      or (
        public.app_role() = 'biller'
        and check_in_source = 'counter_tablet'
        and public.app_employee_outlet(employee_id) = public.app_outlet_id()
      )
    )
  );

create policy attendance_update on public.attendance
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or employee_id in (
        select e.id from public.employees e where e.profile_id = auth.uid()
      )
    )
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or employee_id in (
        select e.id from public.employees e where e.profile_id = auth.uid()
      )
    )
  );
