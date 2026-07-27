-- A closed outlet accepts no new check-ins.
--
-- `outlets.is_active` has existed since data-model-and-tenancy and has never
-- meant anything. outlet-and-staff-setup gives the owner a control that sets
-- it, so it now has to mean something, and the honest meaning is "this shop is
-- not trading".
--
-- Two halves, and the asymmetry is the point:
--
--   * A CHECK-IN at a deactivated outlet is refused. A closed shop that
--     silently records attendance is worse than one that says no — the rows
--     would be discovered weeks later by whoever reconciles payroll.
--   * A CHECK-OUT is never refused. Someone who checked in while the outlet
--     was trading and is still standing there when it is deactivated must be
--     able to close their day. This is design D3 of attendance restated: a
--     check-out is never blocked, for any reason.
--
-- Nothing else about deactivation cascades. Accounts, roster rows and recorded
-- attendance are untouched, and reactivating restores check-in with no other
-- intervention.

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
  v_active boolean;
begin
  select o.latitude, o.longitude, o.geofence_radius_m, o.is_active
    into v_lat, v_lng, v_radius, v_active
    from public.outlets o
   where o.id = new.outlet_id;

  if tg_op = 'INSERT' or old.check_in_at is null then
    -- Only the arrival of a check-in is refused, never a later amendment of a
    -- row that already carries one. A manager still has to be able to record
    -- an override against a day that was worked before the outlet closed.
    if new.check_in_at is not null and v_active is false then
      raise exception 'outlet is not trading' using errcode = 'check_violation';
    end if;

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
