# 10.3 evidence (2026-08-24)

- swiggy-daily.yml schedules UTC cron 45 5,17 * * * (11:15/23:15 IST) inside
  concurrency group aggregator-swiggy-session - the same boundary Read again
  and payout runs share.
- Workflow syntax proven live by three successful dispatches (runs
  32728115121..32734639981) including write-mode posts through ingest.
