-- a-deactivated-person-leaves-in-two-steps (#82): Deactivate records the day,
-- and Remove (Mark as left, as the design first named it) is a second step
-- taken only from a deactivated account,
-- dated by that day, freeing the person's phone (the account function frees
-- their username). Owner access is granted and removed only in the database.
-- change-gate: deactivate-then-leave
--
-- Everything here is new: a nullable column no published build selects, a new
-- service-only function, and the two gates' rows, off. `mark_account_as_left`
-- is left as it is for the build that calls it. No existing row changes; the
-- people already deactivated get their day from a reviewed data repair before
-- the gate is turned on (design D7).

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('deactivate-then-leave', 'DL', 'change', 'Deactivate, then leave',
   'A deactivated person moves to a Deactivated section and drops out of attendance after the day they were deactivated, and Remove is offered only there, ending their outlets on that day and freeing their username and phone.',
   'Deactivated people stay in the list and in attendance, and Mark as left is in Edit and ends outlets on the day it is pressed.',
   'a-deactivated-person-leaves-in-two-steps', 82),
  ('owner-access-in-the-database', 'OD', 'change', 'Owner access in the database',
   'Nobody grants or removes owner access, or deactivates an owner, from the app; the account function refuses it.',
   'The owner grants and removes owner access from Team, as today.',
   'a-deactivated-person-leaves-in-two-steps', 82);

-- The account function reads both gates on every request with the service role
-- (AGENTS.md: an Edge Function that changes behaviour reads `app_change_gate`),
-- and is the first to: the service role was never granted it.
grant execute on function public.app_change_gate(text) to service_role;

-- ---------------------------------------------------------------------------
-- 1. The day access was switched off (design D2).

alter table public.profiles add column deactivated_on date;

comment on column public.profiles.deactivated_on is
  'The Asia/Kolkata business day this account was last deactivated; null while active. Written by the admin-accounts function with is_active, cleared on reactivation. Read only with deactivate-then-leave on (a-deactivated-person-leaves-in-two-steps).';

-- The day, as the database reckons it, for the account function to stamp: the
-- browser never supplies it, and the function's own clock is not the calendar.
create function public.app_kolkata_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

revoke execute on function public.app_kolkata_today() from public, anon, authenticated;
grant execute on function public.app_kolkata_today() to service_role;

comment on function public.app_kolkata_today() is
  'Today on the Asia/Kolkata calendar, for the account function to date a deactivation (a-deactivated-person-leaves-in-two-steps, design D2).';

-- ---------------------------------------------------------------------------
-- 2. Mark as left, from a deactivated account only (design D3).

create function public.mark_account_as_left_v2(
  p_actor_id uuid,
  p_profile_id uuid,
  p_expected_fingerprint text
)
returns table (
  profile_id uuid,
  state_fingerprint text,
  left_on date
)
language plpgsql
set search_path = ''
set timezone = 'Asia/Kolkata'
as $$
declare
  v_current_fingerprint text;
  v_is_active boolean;
  v_deactivated_on date;
  v_left_on date;
begin
  if not public.app_change_gate('deactivate-then-leave') then
    raise exception 'deactivate-then-leave is off' using errcode = 'P0001';
  end if;

  select p.is_active, p.deactivated_on
    into v_is_active, v_deactivated_on
    from public.profiles p
   where p.id = p_profile_id
     for update;
  if not found then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;
  perform 1 from public.assignments a
   where a.person_id = p_profile_id and a.ended_on is null
   order by a.id for update;

  v_current_fingerprint := public.account_state_fingerprint(p_profile_id);
  if v_current_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'stale account state' using errcode = 'P0001';
  end if;

  if not public.account_actor_may_replace_set(p_actor_id, p_profile_id, '[]'::jsonb) then
    raise exception 'forbidden departure' using errcode = 'insufficient_privilege';
  end if;

  -- The order is a rule of the database, not of the page.
  if v_is_active then
    raise exception 'deactivate first' using errcode = 'P0001';
  end if;

  if public.app_change_gate('owner-access-in-the-database')
     and exists (
       select 1 from public.assignments a
        where a.person_id = p_profile_id
          and a.ended_on is null
          and a.role = 'super_admin'
     ) then
    raise exception 'owner access is changed in the database' using errcode = 'insufficient_privilege';
  end if;

  -- Dated by the deactivation, not by the clean-up; Kolkata today only where
  -- the day was never recorded.
  v_left_on := coalesce(v_deactivated_on, current_date);

  update public.assignments a
     set ended_on = greatest(v_left_on, a.started_on)
   where a.person_id = p_profile_id and a.ended_on is null;
  update public.profiles p
     set phone = null,
         deactivated_on = coalesce(p.deactivated_on, v_left_on)
   where p.id = p_profile_id;

  return query
  select p_profile_id,
         public.account_state_fingerprint(p_profile_id),
         v_left_on;
end;
$$;

revoke execute on function public.mark_account_as_left_v2(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_account_as_left_v2(uuid, uuid, text)
  to service_role;

comment on function public.mark_account_as_left_v2(uuid, uuid, text) is
  'Service-only departure of a deactivated account while deactivate-then-leave is on: ends every live assignment on the recorded deactivation day (never before its own start) and clears the phone, atomically. Refuses an active account, and an owner while owner-access-in-the-database is on.';
