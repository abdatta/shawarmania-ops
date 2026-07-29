-- A third way an attendance event can arrive: typed in by an admin.
--
-- `check_in_source` has held two values since the enums migration: `phone`
-- (the person's own device, judged by the geofence) and `counter_tablet` (an
-- enrolled device standing in the outlet, exempt from judging because it has
-- no GPS to offer). staff-as-accounts adds `manual`: a Franchise Admin or the
-- Super Admin recording an event on somebody's behalf — the phone died, the
-- person forgot, the network was down. It replaces the rejected kiosk as the
-- escape hatch that keeps hard geofence blocking humane.
--
-- This lives in its own migration because a value added to an enum cannot be
-- referenced in the transaction that adds it, and the migration that puts
-- `manual` to work (20260729000003) names it in check constraints and the
-- attendance guard. Each migration file runs in its own transaction, so the
-- split is the whole fix.

alter type public.check_in_source add value 'manual';
