-- #45 preparing-order-pipeline, production follow-up.
--
-- Preparation tracking deployed onto a counter with nine days of history.
-- Every order already paid carries its settled bill -- payment has always
-- settled bills, before preparation existed -- but a null prepared_at, and
-- the pipeline's paid-but-unprepared rule therefore read all of history as
-- work still owed. It was not: those orders were served and settled before
-- the preparation axis existed. This migration says so in data -- a paid
-- order that predates preparation counts as prepared at the moment it was
-- paid -- and the pipeline drains back to genuinely unpaid work.
--
-- The order guard admits exactly this change on a paid row (only
-- prepared_at moves), but only under a billing-command context; the helper
-- sets that context itself. Execute is revoked from client roles: marking
-- history prepared is a maintenance act, not a counter verb.

create or replace function public.backfill_prepared_history()
returns integer language plpgsql
security definer set search_path = '' as $$
declare
  v_moved integer;
begin
  perform set_config('app.billing_command', '1', true);
  with moved as (
    update public.orders
      set prepared_at = paid_at
      where status = 'paid' and prepared_at is null and paid_at is not null
      returning 1
  )
  select count(*) into v_moved from moved;
  return v_moved;
end;
$$;

revoke execute on function public.backfill_prepared_history()
  from public, anon, authenticated;

-- Run it once here, so every environment built from this chain agrees with
-- production the moment the chain reaches this file.
select public.backfill_prepared_history();
