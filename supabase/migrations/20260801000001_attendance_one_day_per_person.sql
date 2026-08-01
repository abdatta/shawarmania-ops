-- attendance-one-day-per-person: a day belongs to the person, not to the shop.
--
-- #28 modelled attendance as one row per person per outlet per business day, on
-- the assumption that a split day across two outlets was a real thing to record.
-- It is not: somebody staffed at two outlets works at one of them on any given
-- day, and the month is a mix of days at each. Under the wrong model a person
-- who worked at Kalyani was derived ABSENT at Kanchrapara on the same date,
-- which is a false statement about the days they are paid for.
--
-- Read read-only against production on 2026-08-01 before writing this:
--
--   attendance ......................................  7 rows, 5 people
--   split days (person + date at two outlets) .......  0
--   duplicate (person, date) pairs of any kind ......  0
--   people with live staff assignments at 2 outlets .  1
--
-- The wrong model is live but has produced no wrong row, so the constraint goes
-- on with no backfill and no repair.
--
-- Reversing this, if split shifts are ever wanted, is the two statements below
-- run the other way plus one module in the client
-- (src/features/attendance/attendance-record.ts). Rows written under one row
-- per person per day already satisfy one row per person per outlet per day, so
-- a rollback loses no data.

-- ---------------------------------------------------------------------------
-- The invariant.
--
-- Postgres is the only place this can hold. There is no server-side application
-- layer in this system: `checkIn` is a direct insert from the browser client,
-- so the adapter and the UI are both client code and neither is a boundary. A
-- hand-crafted request would otherwise create a second waiting row at another
-- outlet, which a manager there could approve into a day nobody worked.

alter table public.attendance
  drop constraint attendance_one_per_person_outlet_day;
alter table public.attendance
  add constraint attendance_one_per_person_day unique (person_id, business_date);

-- ---------------------------------------------------------------------------
-- The one bit that crosses the outlet boundary (design D3).
--
-- The collapse rule says a person carrying a row anywhere is not absent
-- anywhere. A Franchise Admin at Kalyani cannot see rows written at
-- Kanchrapara — `attendance_select` scopes them to their own live assignments —
-- so their client cannot compute that rule. Left alone the roll-call would keep
-- deriving absent for somebody who was at work, which is the bug this change
-- exists to remove.
--
-- So exactly one bit is disclosed: "this person, whom you already manage, is
-- accounted for somewhere today". Person ids and nothing else. Never which
-- outlet, the arrival time, the distance, the accuracy, the status, the
-- approver, or whether it was approved. The surface renders it as "Working at
-- another outlet today" with no outlet named.
--
-- Bounded twice: to people on the caller's own outlets' staff lists, and to one
-- boolean per person per day. The underlying rows stay refused — proved by the
-- isolation test in supabase/tests/18_attendance_elsewhere.sql.
--
-- Takes a SET of outlets rather than one, because the roll-call is a
-- multi-select since this change. The caller's set is intersected with what
-- they may actually see rather than refused, which is the same rule the outlet
-- selector already follows: naming an outlet confers nothing.
--
-- A person holding a row at an outlet inside the selection is deliberately not
-- returned. Their real row is already on screen, and the unique constraint
-- above means they cannot hold a second one elsewhere.

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
       and exists (
         select 1
           from public.assignments s
          where s.person_id = a.person_id
            and s.outlet_id = any (v_scope)
            and s.role = 'employee'
            and s.ended_on is null
       );
end;
$$;

revoke execute on function public.attendance_elsewhere(uuid[], date) from public, anon;
grant execute on function public.attendance_elsewhere(uuid[], date) to authenticated;

-- ---------------------------------------------------------------------------
-- The person-range read (design D4).
--
-- #28's D7 pinned an explicit outlet on the by-person read so that "a query
-- should mean one thing rather than quietly widening to whatever RLS happens to
-- allow". That held while the intended meaning was one outlet. The intended
-- meaning is now exactly the set the policy already computes — every outlet the
-- reader may see — so naming a set client-side would either duplicate the
-- policy or contradict it. The filter is dropped from the adapter instead.
--
-- No policy change is needed, and none is made. `attendance_select` (last
-- rewritten in 20260729000004) already resolves to precisely the right set:
--
--   the owner ....................... every outlet
--   a Franchise Admin ............... app_outlets_for('franchise_admin')
--   anybody reading themselves ...... person_id = auth.uid()
--
-- A Franchise Admin holding one assignment therefore reads that outlet, one
-- holding two reads exactly those two, and a third outlet's days are not
-- returned however the request is shaped. That is asserted rather than assumed,
-- in supabase/tests/18_attendance_elsewhere.sql.
