-- The person a request names may read the tablet that named them.
--
-- The approval card has to say **which tablet**, and it has to say it in the
-- words somebody wrote on the back of the hardware: "Kalyani counter tablet".
-- Without that the card reads "somebody wants you to open a counter", which is
-- precisely the shape of prompt people tap through without reading — the thing
-- the four-digit code exists to prevent. A card that names the tablet is a card
-- a person can compare against the object in front of them.
--
-- `counter_devices_select` admitted the owner, that outlet's manager, and the
-- tablet reading itself. An operator was left out because before this change a
-- tablet WAS a Biller and there was nothing to name.
--
-- The widening is exactly one sentence: a person may read a tablet that has
-- asked for them, or that they are standing at. It is bounded by the request and
-- the shift rather than by employment, so it starts when the tablet asks and
-- stops when the request resolves or the shift ends. An Employee who has never
-- been named by any tablet still sees no tablets at all.

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
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          -- A tablet that has asked for this person, while it is still asking.
          or exists (
            select 1
              from public.counter_shift_requests r
             where r.device_id = public.counter_devices.id
               and r.person_id = auth.uid()
               and r.resolution is null
               and r.expires_at > now()
          )
          -- Or one they are standing at right now.
          or exists (
            select 1
              from public.counter_shifts s
             where s.device_id = public.counter_devices.id
               and s.person_id = auth.uid()
               and s.ended_at is null
               and s.expires_at > now()
          )
        )
      )
    )
  );
