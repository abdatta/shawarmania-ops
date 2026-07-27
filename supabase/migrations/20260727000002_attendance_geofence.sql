-- Geofence evaluation, and the evidence that makes it reviewable.
--
-- data-model-and-tenancy built the attendance table with the evidence columns
-- beside the verdict, but nothing ever evaluated the fence: check_in_distance_m
-- was whatever the writer said it was. This migration makes the database the
-- authority on that number, and on what it implies.

-- ---------------------------------------------------------------------------
-- An outlet's position is a surveyed fact, so it records how it was surveyed.
-- Without this a placeholder pair of coordinates is indistinguishable from one
-- captured standing at the counter — which is precisely the confusion the
-- capture screen exists to end.

alter table public.outlets
  add column location_accuracy_m double precision
    check (location_accuracy_m is null or location_accuracy_m >= 0),
  add column location_captured_at timestamptz;

comment on column public.outlets.location_accuracy_m is
  'Reported accuracy, in metres, of the fix saved as this outlet''s position.';
comment on column public.outlets.location_captured_at is
  'When the stored position was captured on site. Null means never captured.';

-- ---------------------------------------------------------------------------
-- Distance. Haversine on a spherical earth: at the scale of a geofence the
-- difference from an ellipsoidal model is centimetres, far below the accuracy
-- of any phone fix. The client implements the same formula with the same
-- radius, and a shared fixture table pins the two together.

create or replace function public.app_distance_m(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000.0 * 2 * asin(
      -- least(1, …) guards the case where floating point nudges the argument
      -- of asin above 1 for two effectively identical points.
      least(1.0, sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2))
          * power(sin(radians(lng2 - lng1) / 2), 2)
      ))
    )
  end
$$;

revoke execute on function public.app_distance_m(
  double precision, double precision, double precision, double precision)
  from public, anon;
grant execute on function public.app_distance_m(
  double precision, double precision, double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The verdict is derived from the evidence, never accepted from the client.
--
-- Two rules, and the boundary between them matters:
--
--   * The stored distance is always recomputed from the stored coordinates, so
--     a row cannot claim a verdict its own coordinates contradict.
--   * The fence only ever DENIES a claim of `present`. It never imposes one —
--     a manager marking half_day or leave on an in-fence day is a legitimate
--     write the geofence has no business overruling.
--
-- Both apply only while a leg is being written for the first time. Re-deriving
-- a settled check-in when the row is later updated would silently rewrite
-- history the moment an owner re-captures the outlet's position or adjusts its
-- radius; the captured evidence is frozen by attendance_guard() for the same
-- reason.

create or replace function public.attendance_evaluate_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
begin
  select o.latitude, o.longitude, o.geofence_radius_m
    into v_lat, v_lng, v_radius
    from public.outlets o
   where o.id = new.outlet_id;

  if tg_op = 'INSERT' or old.check_in_at is null then
    new.check_in_distance_m :=
      public.app_distance_m(v_lat, v_lng, new.check_in_lat, new.check_in_lng);

    -- A distance can be null for two quite different reasons, and conflating
    -- them would either strand everyone or gut the fence.
    --
    --   * The OUTLET has no captured position. Nothing can be judged, and that
    --     is not the employee's doing — nobody is denied, and the screens
    --     report the outlet as unsurveyed.
    --   * The DEVICE supplied no coordinates on a phone check-in — permission
    --     denied, or no fix. Judging is impossible for a reason the fence
    --     exists to care about, so it is not counted present until a manager
    --     says so. Without this, refusing location permission would be the
    --     simplest way to defeat the geofence entirely.
    --
    -- The counter tablet is exempt: it is an enrolled device standing in the
    -- outlet, and it has no GPS to offer.
    if new.check_in_at is not null
       and new.override_by is null
       and new.status = 'present'
       and v_lat is not null
       and v_lng is not null then
      if new.check_in_lat is null or new.check_in_lng is null then
        if new.check_in_source = 'phone' then
          new.status := 'absent';
        end if;
      elsif new.check_in_distance_m > v_radius then
        new.status := 'absent';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or old.check_out_at is null then
    new.check_out_distance_m :=
      public.app_distance_m(v_lat, v_lng, new.check_out_lat, new.check_out_lng);
  end if;

  return new;
end;
$$;

-- Fires between attendance_business_date_valid and attendance_guarded: BEFORE
-- triggers run in name order, and the guard must have the last word.
create trigger attendance_evaluate_geofence
  before insert or update on public.attendance
  for each row execute function public.attendance_evaluate_geofence();

-- ---------------------------------------------------------------------------
-- An override with a blank reason is not a recorded decision.

alter table public.attendance
  add constraint attendance_override_reason_not_blank
  check (override_reason is null or length(btrim(override_reason)) > 0);

-- ---------------------------------------------------------------------------
-- The approver's name, snapshot onto the row.
--
-- Not denormalisation for speed — it is the only way the employee's own view
-- can show what the manager's view shows. An Employee may read their own
-- profile and no one else's, so `override_by` alone is an opaque uuid to the
-- very person the decision was about. Asymmetric visibility in a monitoring
-- feature is how it becomes something staff resent.
--
-- Snapshot rather than joined, for the same reason a bill line item snapshots
-- its price: who approved this, on the day, is a fact about the record and must
-- not be rewritten by a later rename.

alter table public.attendance add column override_by_name text;

comment on column public.attendance.override_by_name is
  'The approver''s name as it stood when the override was recorded. Filled by '
  'attendance_guard(); never accepted from a client.';

-- ---------------------------------------------------------------------------
-- The guard gains two duties beyond freezing identity.
--
-- Captured evidence is frozen once written. Without this, erasing the
-- coordinates on an update would erase the fence's ability to judge them —
-- a blocked row could be laundered into a present one by nulling the very
-- inputs that blocked it.
--
-- And an employee does not write their own payroll status. They check in and
-- they check out; whether a day counts is a manager's call, and the only route
-- from blocked to present is a recorded override.

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

  -- The approver's name is derived here, never accepted: a client could
  -- otherwise write any name it liked beside a real approval. The read is
  -- always of the approver's own profile row (the check above forces
  -- override_by = auth.uid()), which every role may read; seeds run as the
  -- owner and bypass RLS entirely.
  if new.override_by is null then
    new.override_by_name := null;
  elsif tg_op = 'INSERT' or new.override_by is distinct from old.override_by then
    select p.full_name into new.override_by_name
      from public.profiles p where p.id = new.override_by;
  else
    -- The approver has not changed, so the recorded name is a snapshot and is
    -- not rewritable. Re-deriving it here instead would be actively harmful:
    -- a Franchise Admin amending a row the Super Admin overrode cannot read
    -- that profile, and the "refresh" would silently blank the name.
    new.override_by_name := old.override_by_name;
  end if;

  return new;
end;
$$;
