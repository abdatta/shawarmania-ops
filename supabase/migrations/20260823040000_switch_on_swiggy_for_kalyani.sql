-- Switch on the Swiggy sync over its audited history.
--
-- outlet_channel_sync.guarded refuses any synced_from that is not in the
-- future: day-to-day scheduling must never be back-dated. Switching a channel
-- on for the first time is different - Zomato's rows cover dates already
-- past, set deliberately when its handover shipped. Swiggy now does the same,
-- covering the window its coverage audit reconciled.
--
-- The switch follows the enabled mapping, wherever it points: an environment
-- with no enabled Swiggy restaurant switches nothing on, and this migration
-- stays silent there. The guard trigger is disabled for exactly these
-- statements and re-enabled immediately; every later path keeps refusing
-- back-dating.

alter table public.outlet_channel_sync
  disable trigger outlet_channel_sync_guarded;

insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
select r.outlet_id, 'swiggy', date '2026-07-01'
from public.outlet_channel_restaurants r
where r.channel = 'swiggy'
  and r.state = 'enabled'
on conflict (outlet_id, channel) do update
  set synced_from = excluded.synced_from;

alter table public.outlet_channel_sync
  enable trigger outlet_channel_sync_guarded;
