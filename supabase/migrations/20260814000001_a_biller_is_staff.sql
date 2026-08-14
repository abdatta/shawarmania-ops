-- A Biller is staff, so the elsewhere answer covers them (a-biller-is-staff).
--
-- `attendance_elsewhere` answers one question for a manager: "is this person,
-- whom you already manage, accounted for somewhere today?" It bounds the answer
-- to people on the caller's own outlets' staff lists, and it read that list as
-- `role = 'employee'` alone.
--
-- That is one role short. `identity-and-access` requires a live Biller
-- assignment to confer personal attendance at the outlet, and
-- `attendance_submit_attempt` has accepted `employee` **or** `biller` since
-- attendance-denial-and-retries. A Biller who worked at another outlet was
-- therefore never named, and their manager read an unexplained blank where the
-- roll-call should have said they were at work elsewhere. That is a false
-- statement about a day somebody is paid for.
--
-- Function body only. Same signature, same `security definer`, same
-- `search_path = ''`, so the existing revoke/grant pair still stands and is not
-- restated. No policy, column, constraint or row is touched (design D4). The
-- widening is strictly *which people the answer may mention*, and it cannot
-- name anybody the caller does not already see on their own roll-call: after
-- this change that roll-call is exactly this set.
--
-- Stated as the two roles it admits rather than as the roles it excludes, so a
-- role added to the enum later cannot join an outlet's staff list until
-- somebody decides that it should (design D1).

create or replace function public.attendance_elsewhere(
  p_outlets uuid[],
  p_business_date date
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid[];
begin
  -- Same two gates the select policy opens with, so a deactivated account or a
  -- revoked counter device learns nothing here that it could not read directly.
  if not public.app_account_active() or not public.app_device_ok() then
    return;
  end if;

  -- Intersect rather than refuse. The owner reads every outlet; everybody else
  -- reads the ones they hold a live Franchise Admin assignment at, which is
  -- exactly the set `attendance_select` would have returned rows for.
  if (select public.app_is_owner()) then
    v_scope := p_outlets;
  else
    select coalesce(array_agg(o), '{}')
      into v_scope
      from unnest(p_outlets) as o
     where public.app_has_role_at('franchise_admin', o);
  end if;

  if v_scope is null or cardinality(v_scope) = 0 then
    return;
  end if;

  return query
    select distinct a.person_id
      from public.attendance a
     where a.business_date = p_business_date
       and not (a.outlet_id = any (v_scope))
       -- On one of the caller's own staff lists. Somebody they do not already
       -- see on their roll-call is not somebody this may say anything about.
       -- Staff, for attendance, is an Employee or a Biller assignment.
       and exists (
         select 1
           from public.assignments s
          where s.person_id = a.person_id
            and s.outlet_id = any (v_scope)
            and s.role in ('employee', 'biller')
            and s.ended_on is null
       );
end;
$$;
