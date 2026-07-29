-- Manual attendance entry: an admin records the event, the row records the
-- admin.
--
-- The kiosk was rejected (one shared device, usually busy billing), so the
-- escape hatch that keeps hard geofence blocking humane is a human: a
-- Franchise Admin records a check-in or check-out on somebody's behalf, at a
-- past time on the current business day — the phone died, the person forgot.
-- The Super Admin can do the same at any outlet.
--
-- An override and a manual entry are deliberately not the same columns. An
-- override is a recorded decision about a person's own blocked claim; a
-- manual entry is the admin supplying the event itself. Conflating them would
-- make "who approved this block" and "who typed this in" one column and lose
-- one of the answers the moment both happen to one row.
--
-- A manual event carries no coordinates — the admin was not standing where
-- the person was, and fabricated evidence is worse than none. The geofence
-- already declines to judge it without modification: its denial branch names
-- `phone` for the no-coordinates case, and the distance comparison cannot
-- fire on a distance that is null. The enterer stamp is the accountability
-- in evidence's place, snapshotted by name for the same reason
-- override_by_name is: the person the entry is about may read their own row
-- and nobody else's profile.

-- ---------------------------------------------------------------------------
-- 1. The stamp: per event, because check-in and check-out can be entered by
-- different admins on different occasions.

alter table public.attendance
  add column check_in_entered_by uuid references public.profiles (id),
  add column check_in_entered_by_name text,
  add column check_out_entered_by uuid references public.profiles (id),
  add column check_out_entered_by_name text;

comment on column public.attendance.check_in_entered_by is
  'The admin session that recorded a manual check-in. Stamped by '
  'attendance_guard(); never accepted from a client. Null unless '
  'check_in_source is manual.';
comment on column public.attendance.check_in_entered_by_name is
  'The enterer''s name as it stood when the entry was recorded. Filled by '
  'attendance_guard(); never accepted from a client.';
comment on column public.attendance.check_out_entered_by is
  'As check_in_entered_by, for the check-out leg.';
comment on column public.attendance.check_out_entered_by_name is
  'As check_in_entered_by_name, for the check-out leg.';

-- An event is manual exactly when it carries an enterer; a manual event
-- carries no coordinates. `is distinct from` keeps the no-event case (a null
-- source on an absent day) on the no-enterer side.

alter table public.attendance
  add constraint attendance_check_in_entered_iff_manual
  check ((check_in_entered_by is null) = (check_in_source is distinct from 'manual'));
alter table public.attendance
  add constraint attendance_check_out_entered_iff_manual
  check ((check_out_entered_by is null) = (check_out_source is distinct from 'manual'));
alter table public.attendance
  add constraint attendance_entered_by_named
  check ((check_in_entered_by is null) = (check_in_entered_by_name is null)
     and (check_out_entered_by is null) = (check_out_entered_by_name is null));
alter table public.attendance
  add constraint attendance_manual_check_in_unlocated
  check (check_in_source is distinct from 'manual'
      or (check_in_lat is null and check_in_lng is null and check_in_accuracy_m is null));
alter table public.attendance
  add constraint attendance_manual_check_out_unlocated
  check (check_out_source is distinct from 'manual'
      or (check_out_lat is null and check_out_lng is null and check_out_accuracy_m is null));

-- ---------------------------------------------------------------------------
-- 2. The guard learns the manual duties.
--
-- On top of everything the previous version enforced: a manual event may be
-- written only by a Franchise Admin or the Super Admin (the row policies
-- already pin the employee branch to `phone` and the biller branch to
-- `counter_tablet`, but a rule this load-bearing does not get to be an
-- accident of policy branch shapes); the enterer is the writing session,
-- stamped here and never accepted; the event time is not in the future; and
-- the entry lands on the outlet's current business day — back-filling prior
-- days is out of scope until somebody needs it, and the smaller surface is
-- deliberate. The enterer columns join the frozen-evidence lists: who typed
-- an event in is a fact about the record.

create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_writing_manual_in boolean;
  v_writing_manual_out boolean;
  v_cutover time;
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
            or new.check_in_source is distinct from old.check_in_source
            or new.check_in_entered_by is distinct from old.check_in_entered_by
            or new.check_in_entered_by_name is distinct from old.check_in_entered_by_name) then
      raise exception 'captured check-in evidence is immutable';
    end if;

    if old.check_out_at is not null
       and (new.check_out_at is distinct from old.check_out_at
            or new.check_out_lat is distinct from old.check_out_lat
            or new.check_out_lng is distinct from old.check_out_lng
            or new.check_out_accuracy_m is distinct from old.check_out_accuracy_m
            or new.check_out_source is distinct from old.check_out_source
            or new.check_out_entered_by is distinct from old.check_out_entered_by
            or new.check_out_entered_by_name is distinct from old.check_out_entered_by_name) then
      raise exception 'captured check-out evidence is immutable';
    end if;
  end if;

  -- Is this write the arrival of a manual event? (A settled event is already
  -- frozen above, so "arrival" is the only moment these can be true.)
  -- `is not distinct from` rather than `=`: a null source must read as
  -- plainly not-manual, not as an unknown that quietly skips both branches.
  v_writing_manual_in :=
    new.check_in_at is not null
    and new.check_in_source is not distinct from 'manual'
    and (tg_op = 'INSERT' or old.check_in_at is null);
  v_writing_manual_out :=
    new.check_out_at is not null
    and new.check_out_source is not distinct from 'manual'
    and (tg_op = 'INSERT' or old.check_out_at is null);

  if auth.uid() is not null then
    if tg_op = 'UPDATE'
       and new.status is distinct from old.status
       and public.app_role() = 'employee' then
      raise exception 'an employee cannot change their own attendance status';
    end if;

    if v_writing_manual_in or v_writing_manual_out then
      if public.app_role() not in ('franchise_admin', 'super_admin') then
        raise exception 'only a franchise admin or super admin may record a manual entry';
      end if;

      select o.business_day_cutover into v_cutover
        from public.outlets o where o.id = new.outlet_id;
      if new.business_date is distinct from public.app_business_date(now(), v_cutover) then
        raise exception 'a manual entry belongs to the outlet''s current business day';
      end if;

      if v_writing_manual_in then
        if new.check_in_at > now() then
          raise exception 'a manual entry cannot be recorded for the future';
        end if;
        new.check_in_entered_by := auth.uid();
        select p.full_name into new.check_in_entered_by_name
          from public.profiles p where p.id = auth.uid();
      end if;
      if v_writing_manual_out then
        if new.check_out_at > now() then
          raise exception 'a manual entry cannot be recorded for the future';
        end if;
        new.check_out_entered_by := auth.uid();
        select p.full_name into new.check_out_entered_by_name
          from public.profiles p where p.id = auth.uid();
      end if;
    end if;

    -- An enterer stamp on a non-manual event never comes from a client; the
    -- check constraints refuse the shape, this refuses the attempt by name.
    if not v_writing_manual_in
       and (tg_op = 'INSERT' and new.check_in_entered_by is not null
            or tg_op = 'UPDATE' and new.check_in_entered_by is distinct from old.check_in_entered_by) then
      raise exception 'check_in_entered_by is stamped by the database, not supplied';
    end if;
    if not v_writing_manual_out
       and (tg_op = 'INSERT' and new.check_out_entered_by is not null
            or tg_op = 'UPDATE' and new.check_out_entered_by is distinct from old.check_out_entered_by) then
      raise exception 'check_out_entered_by is stamped by the database, not supplied';
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
