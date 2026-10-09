-- #69 the-day-change-finishes-paid-orders, after a trading day in production.
--
-- The day change cost nothing metered -- no request, no egress, no Realtime --
-- but pg_cron keeps a `cron.job_run_details` row for every run of every job,
-- forever: about 0.25 MB a day for each every-minute job, read on 2026-10-09
-- as 8,424 rows and 1.5 MB after four days of the receipt job and one of this.
-- Against the Free Plan's 0.5 GB that is a slow leak, not a cost, so (owner,
-- 2026-10-09):
--
--   * the day change runs every ten minutes. Its stamp is the cutover itself,
--     whatever minute it runs, so the records are unchanged; an unticked order
--     merely leaves the rail by 04:10 instead of 04:01;
--   * a daily job keeps a week of run history and deletes the rest, for every
--     job, `bill-receipt-recovery` included. A week is enough to answer "did it
--     run last night?", which is all the history is read for (docs/OPERATIONS.md).

-- Scheduling an existing name replaces its schedule (pg_cron 1.4+).
select cron.schedule(
  'day-change-finishes-paid-orders',
  '*/10 * * * *',
  'select public.finish_paid_orders_at_day_change()');

-- 23:30 UTC is 05:00 IST: after the cutover, before anybody opens.
select cron.schedule(
  'cron-run-history-keeps-a-week',
  '30 23 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
