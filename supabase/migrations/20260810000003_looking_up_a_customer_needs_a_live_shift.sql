-- Looking a customer up requires a live shift, not merely the right job.
--
-- **Inherited from #32.** That change had to define who may search the global
-- customer directory by phone number before shifts existed, so it drew the line
-- at the set that could ring a bill at the time: an active tablet, or any
-- account holding a live `biller` assignment. That was the right line then and
-- it stopped being the right line the moment a shift became a thing.
--
-- What is wrong with it now is specific. A phone number is the most identifying
-- thing this system holds, and #32 spent a whole change making sure holding a
-- customer id widened nothing. But a Biller's assignment is a standing fact: it
-- is true at 3am, it is true on their day off, and it is true from their own
-- phone at home. So the lookup was reachable by somebody who was not at a
-- counter, was not serving anybody, and had no bill to attach the answer to.
--
-- A live shift is the honest test, because it is the same fact the directory
-- exists to serve: **somebody is at a counter right now, taking an order.** It
-- ends by itself at the cutover, it ends when they hand over, and it ends when a
-- manager removes the tablet — so the reach ends with the reason for it, rather
-- than lasting as long as the employment does.
--
-- Both principals are narrowed by the same clause. A tablet with no shift is a
-- screen in an empty shop; an account with a shift is the person standing at it.

create or replace function public.app_may_look_up_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     where s.ended_at is null
       and s.expires_at > now()
       and (
         -- The tablet the shift is open on.
         s.device_id = auth.uid()
         -- Or the person who opened it, on their own device. They are the one
         -- accountable for the drawer, so a lookup from their phone while they
         -- hold the counter is the same act as one from the tablet.
         or (s.person_id = auth.uid() and public.app_account_active())
       )
  )
$$;
