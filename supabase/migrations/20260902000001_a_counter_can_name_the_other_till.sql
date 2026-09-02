-- A tablet may read the label of the other tablet at its own outlet.
--
-- The pipeline is outlet-wide, so a counter has always displayed work it may
-- not touch. Until now it explained that with the **creator's name**, shown on
-- any card the person holding this tablet did not create, and that was a
-- complete explanation while one outlet held one tablet: another name meant
-- another till.
--
-- It stops being complete the moment one person may hold a shift on both
-- tablets, which `multiple-billing-devices` allows and its spec asserts. Then
-- the neighbouring tablet's order carries the reader's OWN name, no chip
-- appears, and the card is indistinguishable from their own work right up to
-- the point the database refuses them. That is the refusal an operator meets
-- without warning, and the label is the only fact that predicts it.
--
-- So the widening is one sentence, in the shape
-- `the-person-asked-can-see-which-tablet-asked` already established here: a
-- tablet may read the tablets at the outlet it is itself bolted to. It is
-- bounded by that outlet and by the reader being a counter at all, and a label
-- is explicitly not a security identifier — `counter-device-sessions` says so,
-- because it is a word somebody wrote on the back of the hardware.
--
-- Removed siblings are included deliberately. An order taken on a tablet that
-- has since been removed still sits on the pipeline until somebody clears it,
-- and a card that cannot name the till it came from is the exact confusion this
-- fixes.
--
-- What a tablet still cannot read: any tablet at any other outlet, any person's
-- profile, and anything about a shift on a tablet that is not its own. Nothing
-- about money or a customer is on this table at all.

-- ---------------------------------------------------------------------------
-- The two person branches move into a definer helper, and they had to.
--
-- `counter_shift_requests.person_id` is granted to no client role, on purpose.
-- The policy this replaces referenced it inline and worked anyway, because the
-- planner satisfied `id = auth.uid()` first and never executed the subquery for
-- a tablet reading its own row. That was luck, not a boundary: adding a third
-- OR branch below changes the plan, the subquery runs, and the column ACL
-- refuses the whole read — a tablet could not read even ITSELF, which is the
-- first thing it does at startup.
--
-- Definer rights are the house answer here for exactly the reason the other
-- helpers give: they keep a policy that reads these tables from tripping over
-- the grants and the policies on those tables. Behaviour is unchanged; what
-- changes is that it no longer depends on how the row is reached.
create or replace function public.app_may_read_counter_device(p_device uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from public.counter_shift_requests r
            where r.device_id = p_device
              and r.person_id = auth.uid()
              and r.resolution is null
              and r.expires_at > now()
         )
      or exists (
           select 1
             from public.counter_shifts s
            where s.device_id = p_device
              and s.person_id = auth.uid()
              and s.ended_at is null
              and s.expires_at > now()
         )
$$;

revoke execute on function public.app_may_read_counter_device(uuid) from public, anon;
grant execute on function public.app_may_read_counter_device(uuid) to authenticated;

drop policy counter_devices_select on public.counter_devices;
create policy counter_devices_select on public.counter_devices
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      -- The tablet reading its own row. First, and outside the person branch,
      -- because a tablet has no profile and `app_account_active()` is a question
      -- about a person.
      id = auth.uid()
      -- Or a tablet reading its own outlet's other tills. `app_counter_device_outlet()`
      -- is null for a person, so this branch is unreachable for one: null
      -- equality is not true, and a person's access stays exactly what the
      -- branch below grants.
      or outlet_id = (select public.app_counter_device_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          -- A tablet that has asked for this person while it is still asking,
          -- or one they are standing at right now. Unchanged in meaning; moved
          -- into a definer helper for the reason given above it.
          or public.app_may_read_counter_device(public.counter_devices.id)
        )
      )
    )
  );
