-- the-app-asks-the-server-less: the change gate that releases it, and the one
-- function its on path calls.
-- change-gate: fewer-requests
--
-- With the gate on the app skips re-reads it does not need (design D1-D8). Only
-- one of those needs the database: a tablet's minute health report brings back
-- every gate's answer, so the tablet stops reading the gates separately each
-- minute (D8). That is a new function, report_device_health_v2, which records
-- the report by calling report_device_health unchanged and then answers as a
-- read of change_gates does. A build published before this migration calls v1
-- as it always has; a build after it calls v2 only with the gate on.
--
-- No change_number: this change has no roadmap row, so the Change gates page
-- names it by its folder.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name)
values
  ('fewer-requests', 'FR', 'change', 'Fewer requests',
   'The app skips re-reads it does not need: menus and categories when nothing changed, badges seconds after the last read, a tablet’s separate gate check.',
   'Every screen re-reads exactly as it does today.',
   'the-app-asks-the-server-less');

-- A tablet reports its health, as report_device_health does, and is answered
-- with every live gate's answer, { key: enabled }, as the device's own read of
-- change_gates gives it. The device and its outlet still come from the caller's
-- own device session inside v1, which refuses anybody else.
create function public.report_device_health_v2(
  p_build text,
  p_booted_gates text[],
  p_window_seconds integer,
  p_requests integer,
  p_failed integer,
  p_slowest_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.report_device_health(
    p_build, p_booted_gates, p_window_seconds, p_requests, p_failed, p_slowest_ms);
  return coalesce(
    (select jsonb_object_agg(key, enabled)
       from public.change_gates
      where retired_at is null),
    '{}'::jsonb);
end;
$$;

revoke execute on function public.report_device_health_v2(text, text[], integer, integer, integer, integer)
  from public, anon;
grant execute on function public.report_device_health_v2(text, text[], integer, integer, integer, integer)
  to authenticated;
