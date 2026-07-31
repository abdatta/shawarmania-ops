-- Attendance becomes a claim a human settles, and check-out ceases to exist.
--
-- Four changes to what a day means, all of them the owner's (2026-07-31):
--
--   1. A geofence is not a witness. A check-in is evidence of where a phone
--      was; it now counts as nothing until a manager records an approval, and
--      the approval carries its own position so the record shows whether that
--      manager was standing at the outlet when they gave it.
--   2. One rule governs every approver. Inside the fence, on the row's own
--      business day, is one tap with no reason. Anything else — off site, no
--      position at all, or settling a day that has already closed — requires a
--      reason that cannot be blank. Nothing is refused on distance alone: a
--      visible off-site approval is better oversight than a refusal a manager
--      routes around by telephone.
--   3. Check-out is removed. Ten columns, four constraints and a never-refuse
--      rule served a feature nobody used, and unused monitoring data is the
--      kind this repo's privacy rules say not to keep. THIS DESTROYS THE
--      CHECK-OUT TIMES AND POSITIONS ALREADY RECORDED IN PRODUCTION; the
--      decision was taken with that cost stated, and a full dump is held
--      outside the repo.
--   4. An outlet gains an arrival deadline, and each row records the one that
--      applied. Stamped rather than read live, for the same reason a bill line
--      snapshots its price: editing the outlet's rule next month must not
--      relabel a day recorded under the old one.
--
-- What this migration deliberately does NOT do: recompute a single existing
-- verdict. Every day already recorded keeps its status, with empty approver
-- evidence. Back-filling an approver onto historic days would fabricate the
-- exact human decision this change exists to record.

-- ---------------------------------------------------------------------------
-- 1. An override becomes the approval it now is.
--
-- The rename is semantically faithful to what is already stored: every
-- historic override carried an approver, a time and a reason, which is exactly
-- an off-site approval under the new rule. Nothing is reinterpreted, and the
-- column names stop teaching the next reader that the normal path is an
-- exception.

alter table public.attendance rename column override_by to approved_by;
alter table public.attendance rename column override_by_name to approved_by_name;
alter table public.attendance rename column override_reason to approval_reason;
alter table public.attendance rename column override_at to approved_at;

comment on column public.attendance.approved_by is
  'The manager who settled this day. Stamped by attendance_guard() as the '
  'approving session; never accepted from a client.';
comment on column public.attendance.approved_by_name is
  'The approver''s name as it stood when the approval was recorded. Filled by '
  'attendance_guard(); never accepted from a client. Snapshot rather than '
  'joined, because the employee the day is about may read their own row and '
  'nobody else''s profile.';
comment on column public.attendance.approval_reason is
  'Why this was approved. Required unless the approver was inside the '
  'outlet''s radius on the row''s own business day; never blank.';
comment on column public.attendance.approved_at is
  'When the approval was recorded. Stamped by attendance_guard().';

-- The completeness rule changes shape, not just name. An override always had a
-- reason; an approval given on site on the day does not, and demanding one
-- would turn the honest path into eight identical entries of "ok" a month.
--
-- So: the approver and the time travel together, and a reason may only exist
-- beside an approval.

alter table public.attendance
  drop constraint attendance_override_complete;
alter table public.attendance
  add constraint attendance_approval_complete
  check ((approved_by is null) = (approved_at is null));
alter table public.attendance
  add constraint attendance_reason_needs_approval
  check (approval_reason is null or approved_by is not null);

alter table public.attendance
  rename constraint attendance_override_reason_not_blank
  to attendance_approval_reason_not_blank;

-- ---------------------------------------------------------------------------
-- 2. The approval carries its own evidence.
--
-- Four columns mirroring the check-in leg exactly, for the same reason that
-- leg has them: a disputed day should be reviewable from stored inputs rather
-- than from a bare verdict. `approver_distance_m` is the database's answer,
-- recomputed from the coordinates below and never accepted from the client —
-- the one number a client has every incentive to shade.
--
-- "On site" is derived from these (distance within the outlet's radius) and is
-- not stored. A second column saying so could disagree with them, and the one
-- that would be believed is the one a client wrote.

alter table public.attendance
  add column approver_lat double precision,
  add column approver_lng double precision,
  add column approver_accuracy_m double precision
    check (approver_accuracy_m is null or approver_accuracy_m >= 0),
  add column approver_distance_m double precision;

comment on column public.attendance.approver_lat is
  'Where the approving device was, read in direct response to the approval and '
  'at no other moment. The approving manager is a subject of monitoring here '
  'exactly as the employee is (docs/SECURITY_AND_PRIVACY.md).';
comment on column public.attendance.approver_lng is
  'As approver_lat.';
comment on column public.attendance.approver_accuracy_m is
  'The approving device''s reported accuracy, in metres.';
comment on column public.attendance.approver_distance_m is
  'Metres from the outlet, recomputed by attendance_evaluate_geofence() from '
  'the stored approver coordinates. Null when the device supplied no position '
  'or the outlet has never been surveyed — both of which cost a reason.';

-- A position that vouches for nothing is not evidence, it is stray location
-- data about a manager. It may exist only beside the approval it belongs to.

alter table public.attendance
  add constraint attendance_approver_position_needs_approval
  check (approved_by is not null
      or (approver_lat is null and approver_lng is null
          and approver_accuracy_m is null and approver_distance_m is null));
alter table public.attendance
  add constraint attendance_approver_position_paired
  check ((approver_lat is null) = (approver_lng is null));

-- ---------------------------------------------------------------------------
-- 3. The arrival deadline: the outlet's rule, and the rule that applied.
--
-- 13:00 by default because that is the time the business actually cares about
-- (docs/BUSINESS_CONTEXT.md); it sits beside business_day_cutover as the other
-- per-outlet fact about when a day works.

alter table public.outlets
  add column arrival_deadline time not null default time '13:00';

comment on column public.outlets.arrival_deadline is
  'The time by which staff are expected to have arrived. Editable by the '
  'owner; editing it applies to arrivals from then on, never retrospectively, '
  'because each attendance row stamps the deadline that applied to it.';

alter table public.attendance
  add column arrival_deadline time;

comment on column public.attendance.arrival_deadline is
  'The outlet''s arrival deadline as it stood when this check-in landed. '
  'Stamped by attendance_guard() from the outlet and frozen with the rest of '
  'the captured evidence, so that later editing the outlet''s rule never '
  'changes whether a recorded day reads late. Null on a day with no check-in.';

-- ---------------------------------------------------------------------------
-- 4. Check-out is removed.
--
-- The constraints go first and by name. `attendance_entered_by_named` spans
-- both legs, so it is dropped and restated for the one leg that survives
-- rather than being silently taken down with the column.

alter table public.attendance
  drop constraint attendance_checkout_needs_checkin,
  drop constraint attendance_check_out_entered_iff_manual,
  drop constraint attendance_manual_check_out_unlocated,
  drop constraint attendance_entered_by_named;

alter table public.attendance
  add constraint attendance_entered_by_named
  check ((check_in_entered_by is null) = (check_in_entered_by_name is null));

alter table public.attendance
  drop column check_out_at,
  drop column check_out_lat,
  drop column check_out_lng,
  drop column check_out_accuracy_m,
  drop column check_out_distance_m,
  drop column check_out_source,
  drop column check_out_entered_by,
  drop column check_out_entered_by_name;

-- ---------------------------------------------------------------------------
-- 5. The fence stops being the authority and becomes evidence.
--
-- Three duties, and one of them is new:
--
--   * The stored check-in distance is recomputed from the stored coordinates,
--     so a row cannot claim a distance its own coordinates contradict.
--   * The approver's distance is recomputed the same way, on the arrival of
--     the approval.
--   * An unapproved check-in is never stored `present`. This replaces the old
--     conditional downgrade and is smaller than it was: the fence no longer
--     decides anything about status, because a human does. The fence still
--     never IMPOSES a status either, so a manager marking leave or half day on
--     an in-fence day is stored as written.
--
-- A manual entry is exempt from the downgrade: it carries no coordinates by
-- design, and attendance_guard() settles it with the enterer's own approval a
-- few lines later. Downgrading it here would strand every manual entry as
-- pending against a row that already names who decided it.

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
    -- row that already carries one. A day worked before the outlet closed must
    -- still be settleable afterwards.
    if new.check_in_at is not null and v_active is false then
      raise exception 'outlet is not trading' using errcode = 'check_violation';
    end if;

    new.check_in_distance_m :=
      public.app_distance_m(v_lat, v_lng, new.check_in_lat, new.check_in_lng);

    -- Whatever the distance says. The fence is evidence for a manager to read,
    -- not a witness that can vouch for anybody on its own.
    if new.check_in_at is not null
       and new.approved_by is null
       and new.check_in_source is distinct from 'manual'
       and new.status = 'present' then
      new.status := 'absent';
    end if;
  end if;

  if tg_op = 'INSERT' or old.approved_by is null then
    new.approver_distance_m :=
      public.app_distance_m(v_lat, v_lng, new.approver_lat, new.approver_lng);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The guard: identity, frozen evidence, the manual escape hatch, the
-- deadline stamp, and the approval rule.
--
-- The approval rule lives here rather than in the form because a form is a
-- suggestion. A hand-crafted approval missing its reason is refused by the
-- database, which is the only place that refusal means anything.

create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_writing_manual_in boolean;
  v_approving boolean;
  v_cutover time;
  v_deadline time;
  v_radius integer;
  v_is_admin_here boolean;
  v_on_site boolean;
  v_same_day boolean;
begin
  if tg_op = 'UPDATE' then
    if new.person_id is distinct from old.person_id
       or new.outlet_id is distinct from old.outlet_id
       or new.business_date is distinct from old.business_date then
      raise exception 'attendance identity (person, outlet, business date) is immutable';
    end if;

    -- The stamped deadline joins the frozen list: which rule applied to this
    -- arrival is a fact about the record, and a row that could be re-stamped
    -- would be a row whose lateness could be edited away.
    if old.check_in_at is not null
       and (new.check_in_at is distinct from old.check_in_at
            or new.check_in_lat is distinct from old.check_in_lat
            or new.check_in_lng is distinct from old.check_in_lng
            or new.check_in_accuracy_m is distinct from old.check_in_accuracy_m
            or new.check_in_source is distinct from old.check_in_source
            or new.check_in_entered_by is distinct from old.check_in_entered_by
            or new.check_in_entered_by_name is distinct from old.check_in_entered_by_name
            or new.arrival_deadline is distinct from old.arrival_deadline) then
      raise exception 'captured check-in evidence is immutable';
    end if;

    -- A recorded approval is a recorded human decision, so it is not editable
    -- afterwards. A manager who approved the wrong day corrects it by changing
    -- the STATUS, which stays theirs to set and leaves the approval visible —
    -- rather than by quietly rewriting who vouched for what.
    if old.approved_by is not null
       and (new.approved_by is distinct from old.approved_by
            or new.approved_at is distinct from old.approved_at
            or new.approval_reason is distinct from old.approval_reason
            or new.approver_lat is distinct from old.approver_lat
            or new.approver_lng is distinct from old.approver_lng
            or new.approver_accuracy_m is distinct from old.approver_accuracy_m
            or new.approver_distance_m is distinct from old.approver_distance_m) then
      raise exception 'a recorded approval is immutable';
    end if;
  end if;

  -- Is this write the arrival of a manual check-in, or of an approval? (Both
  -- are frozen above, so "arrival" is the only moment these can be true.)
  -- `is not distinct from` rather than `=`: a null source must read as plainly
  -- not-manual, not as an unknown that quietly skips the branch.
  v_writing_manual_in :=
    new.check_in_at is not null
    and new.check_in_source is not distinct from 'manual'
    and (tg_op = 'INSERT' or old.check_in_at is null);
  v_approving :=
    new.approved_by is not null
    and (tg_op = 'INSERT' or old.approved_by is null);

  -- The deadline that applied, taken from the outlet and never from the client.
  if new.check_in_at is not null and (tg_op = 'INSERT' or old.check_in_at is null) then
    select o.arrival_deadline into v_deadline
      from public.outlets o where o.id = new.outlet_id;
    new.arrival_deadline := v_deadline;
  end if;

  if auth.uid() is not null then
    v_is_admin_here := public.app_is_owner()
      or public.app_has_role_at('franchise_admin', new.outlet_id);

    if tg_op = 'UPDATE'
       and new.status is distinct from old.status
       and not v_is_admin_here then
      raise exception 'only an admin for this outlet may change an attendance status';
    end if;

    if v_writing_manual_in then
      if not v_is_admin_here then
        raise exception 'only a franchise admin or super admin may record a manual entry';
      end if;

      select o.business_day_cutover into v_cutover
        from public.outlets o where o.id = new.outlet_id;
      if new.business_date is distinct from public.app_business_date(now(), v_cutover) then
        raise exception 'a manual entry belongs to the outlet''s current business day';
      end if;

      if new.check_in_at > now() then
        raise exception 'a manual entry cannot be recorded for the future';
      end if;
      new.check_in_entered_by := auth.uid();
      select p.full_name into new.check_in_entered_by_name
        from public.profiles p where p.id = auth.uid();

      -- The recording IS the decision. An admin typing in this morning's
      -- arrival has already attested to it, and making them then approve their
      -- own entry would be a second signature on the same sentence. The
      -- enterer stamp is what the row shows in evidence's place, so this
      -- settlement is never mistaken for somebody having been on site.
      new.approved_by := auth.uid();
      new.approved_at := now();
      v_approving := true;
    end if;

    -- An enterer stamp on a non-manual event never comes from a client; the
    -- check constraint refuses the shape, this refuses the attempt by name.
    if not v_writing_manual_in
       and (tg_op = 'INSERT' and new.check_in_entered_by is not null
            or tg_op = 'UPDATE' and new.check_in_entered_by is distinct from old.check_in_entered_by) then
      raise exception 'check_in_entered_by is stamped by the database, not supplied';
    end if;

    if v_approving then
      if not v_is_admin_here then
        raise exception 'only a franchise admin or super admin may record an approval';
      end if;
      if new.approved_by is distinct from auth.uid() then
        raise exception 'approved_by must be the approving session';
      end if;
      -- A day nobody claimed is not a day anybody can settle.
      if new.check_in_at is null then
        raise exception 'an approval requires a check-in on the row';
      end if;
      -- The approval time is the database's, not the request's.
      new.approved_at := now();

      -- The one rule. A manual entry is outside it: it carries no coordinates
      -- by design, so the fence has nothing to judge, and the enterer stamp is
      -- already the named accountability a reason would be asking for.
      if not v_writing_manual_in then
        select o.geofence_radius_m, o.business_day_cutover into v_radius, v_cutover
          from public.outlets o where o.id = new.outlet_id;
        v_on_site := new.approver_distance_m is not null
          and new.approver_distance_m <= v_radius;
        v_same_day := new.business_date = public.app_business_date(now(), v_cutover);

        if not (v_on_site and v_same_day) then
          if new.approval_reason is null or length(btrim(new.approval_reason)) = 0 then
            raise exception 'an approval from away from the outlet, or after the '
              'row''s own business day, requires a reason';
          end if;
        end if;
      end if;
    end if;
  end if;

  if new.approved_by is null then
    new.approved_by_name := null;
  elsif tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by then
    select p.full_name into new.approved_by_name
      from public.profiles p where p.id = new.approved_by;
  else
    -- The approver has not changed, so the recorded name is a snapshot and is
    -- not rewritable. Re-deriving it here instead would be actively harmful: a
    -- Franchise Admin amending a row the Super Admin approved cannot read that
    -- profile, and the "refresh" would silently blank the name.
    new.approved_by_name := old.approved_by_name;
  end if;

  return new;
end;
$$;
