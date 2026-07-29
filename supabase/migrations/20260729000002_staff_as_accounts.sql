-- Staff exist only as accounts.
--
-- The roster/accounts split rested on two assumptions the owner removed on
-- 2026-07-28: payroll data lives in the app (it will not — attendance is kept
-- because it feeds payroll done *outside* the app), and some staff never touch
-- the app (everyone gets an account; restore the assumption later if usage
-- says otherwise). What remained of `employees` after those cuts was a second
-- copy of names the accounts already hold, a linking step whose only job was
-- reconnecting what the split separated, and a name-drift bug where the two
-- copies disagree.
--
-- So: staff facts move onto `profiles`, attendance re-attaches to the account,
-- and the roster table dies — policies, triggers, isolation cases and all.
-- Production staff data is at baseline (the one real check-in was test data,
-- since deleted), which makes this the cheapest this migration will ever be;
-- it is nevertheless written to carry real data, because a migration that only
-- works on empty tables is a habit, not a tool.
--
-- Two facts about a person are deliberately two columns:
--
--   * `is_active`  — may this account sign in. Also the immediate
--                    session-kill lever; deactivation must not remove the
--                    person from today's attendance surface.
--   * `left_on`    — null means current staff. Departure removes a person
--                    from lists while every recorded row survives.
--
-- One bit cannot express "access cut but still works here": overloading it
-- would either falsify the attendance surface every time the panic button is
-- pulled, or let ex-staff accumulate in every list forever under the
-- no-deletion rule. No constraint couples them; the four combinations all
-- mean something (docs/ROLES_AND_PERMISSIONS.md at archive time).
--
-- No payroll columns move. `salary_paise` and `address` die with the table:
-- nothing in the app ever read them, and a salary payment is recordable as an
-- ordinary expense when the owner wants it in the books.

-- ---------------------------------------------------------------------------
-- 1. Staff facts on the account.

alter table public.profiles
  add column staff_code text,
  add column role_title text,
  add column joined_on date,
  add column left_on date;

comment on column public.profiles.staff_code is
  'Per-outlet display code (KAL-7KQ2). Issued by the database for person '
  'roles (franchise_admin, employee) at an outlet; null for the Super Admin '
  'and counter devices. Its only job is telling two people with the same '
  'name apart in lists.';
comment on column public.profiles.role_title is
  'Free-text job label ("Griller", "Counter staff") — the human answer to '
  '"what do they do here", distinct from the app-capability role.';
comment on column public.profiles.left_on is
  'Null means current staff. Set, it removes the person from staff lists and '
  'new attendance days while every recorded row survives. Deliberately '
  'independent of is_active: "access cut but still works here" is a state '
  'the emergency lever needs.';

-- ---------------------------------------------------------------------------
-- 2. Linked roster rows fold onto their accounts.
--
-- The account's name and phone win where the copies drifted: the account is
-- the identity the person actually signs in as, and the roster copy is the
-- one nobody could see drift. `employment_status` collapses per the two-fact
-- model: terminated → departed (the real date is unknown to the database, so
-- the migration date stands in — production is at baseline, so this decides
-- nothing real); inactive → access cut, still current staff.

update public.profiles p
   set staff_code = e.employee_code,
       role_title = e.role_title,
       joined_on  = e.joined_on,
       left_on    = case when e.employment_status = 'terminated'
                         then current_date else null end,
       is_active  = case when e.employment_status in ('inactive', 'terminated')
                         then false else p.is_active end
  from public.employees e
 where e.profile_id = p.id;

-- ---------------------------------------------------------------------------
-- 3. Unlinked roster rows get an account.
--
-- Every staff member gets an account now, so a roster row with no login
-- becomes one: an auth user with a placeholder address on `.invalid` (the
-- RFC 2606 reserved TLD — mail to it cannot route) and a password nobody
-- knows, plus the profile carrying the row's staff facts. No one-time code is
-- issued here: issuing is an admin's deliberate act, done after fixing the
-- address with the existing set-email machinery, and nothing is ever sent to
-- a placeholder because no code exists for it.
--
-- The roster row's own uuid becomes the account's id. That is not a
-- convenience — it means attendance rows for these people keep the id they
-- already carry when step 4 re-keys the table.
--
-- The auth insert mirrors supabase/seed.sql column-for-column; that file
-- already owns the risk of writing GoTrue's tables directly. A phone that
-- would collide with an existing account's unique phone is dropped rather
-- than aborting a deploy over a duplicate contact number.

do $$
declare
  e record;
begin
  for e in
    select * from public.employees where profile_id is null
  loop
    insert into auth.users
      (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new,
       email_change_token_current, email_change, phone_change,
       phone_change_token, reauthentication_token, is_sso_user)
    values
      ('00000000-0000-0000-0000-000000000000', e.id, 'authenticated',
       'authenticated', e.id::text || '@placeholder.invalid', now(),
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
       '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), '', '', '', '', '', '', '', '', false);

    insert into auth.identities
      (provider_id, user_id, identity_data, provider,
       last_sign_in_at, created_at, updated_at)
    values
      (e.id::text, e.id,
       jsonb_build_object('sub', e.id::text,
                          'email', e.id::text || '@placeholder.invalid',
                          'email_verified', true),
       'email', null, now(), now());

    insert into public.profiles
      (id, full_name, phone, role, outlet_id, is_active,
       staff_code, role_title, joined_on, left_on)
    values
      (e.id, e.full_name,
       case when exists (select 1 from public.profiles p where p.phone = e.phone)
            then null else e.phone end,
       'employee', e.outlet_id,
       e.employment_status = 'active',
       e.employee_code, e.role_title, e.joined_on,
       case when e.employment_status = 'terminated' then current_date end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Attendance re-attaches to the account.
--
-- The column is renamed, not just repointed: after the merge the people on it
-- can be Franchise Admins as well as Employees, and every test keyed on it
-- has to be rewritten for the id-space change anyway — the rename is free at
-- the only moment it will ever be. No cascade, matching every other foreign
-- key in this schema: recorded attendance is precisely the history that must
-- refuse its person's deletion (section 8).
--
-- The old policies name employee_id and the dead helper, so they go first;
-- their replacements are section 5.

drop policy attendance_select on public.attendance;
drop policy attendance_insert on public.attendance;
drop policy attendance_update on public.attendance;

alter table public.attendance
  add column person_id uuid references public.profiles (id);

update public.attendance a
   set person_id = coalesce(e.profile_id, e.id)
  from public.employees e
 where a.employee_id = e.id;

alter table public.attendance
  alter column person_id set not null;

alter table public.attendance
  drop constraint attendance_one_per_employee_day;
alter table public.attendance
  add constraint attendance_one_per_person_day unique (person_id, business_date);

alter table public.attendance drop column employee_id;

-- ---------------------------------------------------------------------------
-- 5. The attendance policies, restated for the account.
--
-- The employee branch collapses from a roster subquery to `person_id =
-- auth.uid()` — an employee *is* the person record now. The outlet of the
-- person on the row is resolved by a security-definer helper rather than a
-- subquery on profiles, because the counter tablet writes rows for people
-- whose profiles its select policy happens to permit today — and a policy
-- that silently depends on the width of another table's select policy stops
-- being readable as a boundary.
--
-- New against the old shape: the Super Admin can write attendance at any
-- outlet. The owner's manual-entry capability (20260729000003) spans outlets,
-- and the old policy's top-level `outlet_id = app_outlet_id()` conjunct
-- silently excluded the outlet-less owner from every branch. Every branch
-- still requires the row's outlet to be the person's own.

create or replace function public.app_person_outlet(person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.outlet_id from public.profiles p where p.id = person
$$;

revoke execute on function public.app_person_outlet(uuid) from public, anon;
grant execute on function public.app_person_outlet(uuid) to authenticated;

create policy attendance_select on public.attendance
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or person_id = auth.uid()
    )
  );

create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and public.app_person_outlet(person_id) = outlet_id
    and (
      public.app_role() = 'super_admin'
      or (
        public.app_role() = 'franchise_admin'
        and outlet_id = public.app_outlet_id()
      )
      or (
        public.app_role() = 'employee'
        and outlet_id = public.app_outlet_id()
        and check_in_source = 'phone'
        and person_id = auth.uid()
      )
      or (
        public.app_role() = 'biller'
        and outlet_id = public.app_outlet_id()
        and check_in_source = 'counter_tablet'
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
      or person_id = auth.uid()
    )
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or person_id = auth.uid()
    )
  );

-- The guard, restated for the rename. Same duties as before — identity
-- frozen, captured evidence frozen, an employee never writes their own
-- status, overrides are recorded manager decisions. 20260729000003 extends it
-- with the manual-entry duties; this version exists so no window in this
-- deploy holds a guard naming a column that no longer exists.

create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
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
            or new.check_in_source is distinct from old.check_in_source) then
      raise exception 'captured check-in evidence is immutable';
    end if;

    if old.check_out_at is not null
       and (new.check_out_at is distinct from old.check_out_at
            or new.check_out_lat is distinct from old.check_out_lat
            or new.check_out_lng is distinct from old.check_out_lng
            or new.check_out_accuracy_m is distinct from old.check_out_accuracy_m
            or new.check_out_source is distinct from old.check_out_source) then
      raise exception 'captured check-out evidence is immutable';
    end if;
  end if;

  if auth.uid() is not null then
    if tg_op = 'UPDATE'
       and new.status is distinct from old.status
       and public.app_role() = 'employee' then
      raise exception 'an employee cannot change their own attendance status';
    end if;

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
-- 6. The roster dies.
--
-- The table drop takes its policies, triggers and constraints with it. The
-- functions that existed only to serve it go by name, and the enum that
-- encoded one fact in three values goes with them.

drop table public.employees;

drop function public.employee_profile_same_outlet();
drop function public.app_employee_outlet(uuid);
drop function public.issue_employee_code();
drop function public.employee_code_guard();

drop type public.employment_status;

-- ---------------------------------------------------------------------------
-- 7. The staff-code machinery, repointed at the account.
--
-- The #18 contract survives the roster's death — codes are how two same-named
-- people are told apart on the staff list and the attendance day, and that
-- need did not go away. Same prefix + Crockford-suffix shape, same
-- issue-on-insert, same "only the owner changes one afterwards". Person roles
-- only: a counter device is not a person one reads a code aloud for, and the
-- Super Admin has no outlet to prefix from.
--
-- No `default ''` sentinel this time: the column is nullable (a Super
-- Admin's is null forever), so the generated Insert type is already optional
-- and the sentinel would buy nothing.

create or replace function public.issue_staff_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
  v_code text;
  v_attempt integer := 0;
begin
  if new.role not in ('franchise_admin', 'employee') or new.outlet_id is null then
    return new;
  end if;

  -- Blank and absent both mean "issue me one"; a supplied code is honoured.
  if coalesce(btrim(new.staff_code), '') <> '' then
    return new;
  end if;

  select staff_code_prefix into v_prefix
    from public.outlets where id = new.outlet_id;

  if v_prefix is null then
    raise exception 'outlet % has no staff code prefix', new.outlet_id;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := v_prefix || '-' || public.random_staff_suffix();

    exit when not exists (
      select 1 from public.profiles
       where outlet_id = new.outlet_id and staff_code = v_code
    );

    if v_attempt >= 10 then
      raise exception
        'could not issue a unique staff code for outlet % after % attempts',
        new.outlet_id, v_attempt;
    end if;
  end loop;

  new.staff_code := v_code;
  return new;
end;
$$;

-- Who may change a code afterwards. Two rules, one trigger:
--
--   * Renaming is the owner's alone — profiles_update_staff (section 9)
--     permits a Franchise Admin the row, and a row policy permits every
--     column on a row it permits, so the column rule lives here.
--   * An issued code is never blanked or nulled, by anyone. On insert,
--     blankness was a request; on update the row already has a code, and
--     clearing the field is a mistake, not a request.

create or replace function public.staff_code_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.staff_code is not null
     and coalesce(btrim(new.staff_code), '') = '' then
    raise exception 'a staff code cannot be removed once issued';
  end if;

  -- Nested rather than one AND-chain, and not only for readability: the
  -- privileged function updates profiles (is_active, above all) as the
  -- service role, which holds no EXECUTE on app_role() — and SQL makes no
  -- short-circuit promise, so a flat conjunction can evaluate the call it
  -- appears to have guarded. Nesting is the evaluation-order guarantee.
  if new.staff_code is distinct from old.staff_code and auth.uid() is not null then
    if public.app_role() is distinct from 'super_admin' then
      raise exception 'only the owner may change a staff code'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_issue_code
  before insert on public.profiles
  for each row execute function public.issue_staff_code();

create trigger profiles_code_guarded
  before update on public.profiles
  for each row execute function public.staff_code_guard();

-- The prefix freezes once any code reads from it — the predicate moves from
-- "any roster row exists" to "any profile at this outlet carries a code".

create or replace function public.outlet_prefix_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.staff_code_prefix is distinct from old.staff_code_prefix
     and exists (select 1 from public.profiles
                  where outlet_id = old.id and staff_code is not null) then
    raise exception
      'staff codes have already been issued from this outlet''s prefix'
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

comment on column public.outlets.staff_code_prefix is
  'The three characters every staff code at this outlet begins with. Unique '
  'across outlets, and frozen once any staff code has been issued — every '
  'code already issued reads from it.';

-- Backfill: people who predate the trigger get their code now. Carried roster
-- codes were folded in sections 2–3; this reaches the accounts that never had
-- a roster row — the seeded Franchise Admins, pending staff — so "a staff
-- account never lacks a code" is true of the whole table, not just new rows.

do $$
declare
  p record;
begin
  for p in
    select id, outlet_id from public.profiles
     where role in ('franchise_admin', 'employee')
       and outlet_id is not null
       and staff_code is null
     order by created_at
  loop
    update public.profiles
       set staff_code = sub.code
      from (
        select o.staff_code_prefix || '-' || public.random_staff_suffix() as code
          from public.outlets o where o.id = p.outlet_id
      ) sub
     where id = p.id
       and not exists (
         select 1 from public.profiles p2
          where p2.outlet_id = p.outlet_id and p2.staff_code = sub.code
       );

    -- One collision in a million-code space is already unlikely; a second
    -- attempt covers it, and the unique constraint below is the backstop.
    update public.profiles
       set staff_code = (
         select o.staff_code_prefix || '-' || public.random_staff_suffix()
           from public.outlets o where o.id = p.outlet_id
       )
     where id = p.id and staff_code is null;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Constraints, after the data they must hold is in place.
--
-- On deletion: no trigger is added, deliberately. Every foreign key pointing
-- at profiles(id) is plain NO ACTION except account_invites (whose cascade is
-- the recorded design: an invite is plumbing, not history), so an account
-- with any recorded row already refuses deletion in Postgres — including a
-- delete aimed at auth.users, whose cascade onto profiles is stopped by the
-- same keys. That is the outlets precedent exactly: the absence of cascades
-- IS the boundary, with no flag to maintain. The check below makes this
-- migration refuse to deploy if that property ever regresses, and
-- 09_outlet_and_staff_setup.sql proves it with hand-crafted deletes.

alter table public.profiles
  add constraint profiles_staff_code_unique_per_outlet unique (outlet_id, staff_code);
alter table public.profiles
  add constraint profiles_staff_code_not_blank
  check (staff_code is null or length(btrim(staff_code)) > 0);
alter table public.profiles
  add constraint profiles_left_after_joining
  check (left_on is null or joined_on is null or left_on >= joined_on);

do $$
declare
  v_bad text;
begin
  select string_agg(cl.relname || '.' || att.attname, ', ') into v_bad
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
    cross join lateral unnest(c.conkey) as k(local_attnum)
    join pg_catalog.pg_attribute att
      on att.attrelid = c.conrelid and att.attnum = k.local_attnum
   where c.contype = 'f'
     and c.confrelid = 'public.profiles'::regclass
     and c.confdeltype = 'c'
     and ns.nspname = 'public'
     and not (cl.relname = 'account_invites' and att.attname = 'profile_id');

  if v_bad is not null then
    raise exception
      'cascading foreign key(s) onto profiles(id): % — a cascade here erases '
      'history when an account dies, inverting the no-deletion rule', v_bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Staff facts get a client write path; identity stays privileged.
--
-- profiles has had zero client write grants since it was created — every
-- write went through the admin-accounts function. That stays true for what
-- the function exists to protect: role, outlet, active state, email, and
-- creation itself, where authority is re-derived from the caller's token.
-- Staff facts are different: they are the roster edits the capability matrix
-- always gave admins, and they belong to the admin's own session under
-- Row-Level Security, exactly as they did on the roster table. The grant is
-- column-level, so the policy decides which rows and this list decides which
-- columns — a client that can rename a person still cannot touch is_active.

grant update (full_name, staff_code, role_title, joined_on, left_on)
  on public.profiles to authenticated;

create policy profiles_update_staff on public.profiles
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );
