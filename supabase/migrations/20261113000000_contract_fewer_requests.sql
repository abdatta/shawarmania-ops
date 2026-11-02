-- retire-fewer-requests, 3.1: the contract half of `fewer-requests`. Every
-- build since `0488b74c` (first live in Deploy 41154842156, 31 October) skips
-- the re-reads the gate's off path made and reports a tablet's minute through
-- `report_device_health_v2`. Every registered device runs a build that contains
-- it: on 3 November, Cafe Laptop, Conti Kitchen and Shawarma Kitchen on
-- `c83ec673`, after three services on it (31 October, 1 and 2 November).
-- release: contract fewer-requests
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or on a fresh reset, on 3 November.
--
-- 1. A tablet no longer calls `report_device_health` itself; only builds from
--    before the change did. `report_device_health_v2` still records through it,
--    as the function's owner, so it stays and only the client's grant goes.
-- 2. The row is retired.

-- 1. The old report -----------------------------------------------------------

revoke execute on function public.report_device_health(text, text[], integer, integer, integer, integer)
  from authenticated;

-- 2. The row -----------------------------------------------------------------

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'fewer-requests';
