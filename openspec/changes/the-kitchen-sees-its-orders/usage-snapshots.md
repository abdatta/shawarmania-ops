# Supabase Usage Snapshots

What the kitchen work costs in usage, measured rather than guessed. #69
(`the-day-change-finishes-paid-orders`) shipped on its own on 2026-10-08, and
#70 (this change) ships after it, so the readings bracket each release: a
baseline before #69, a reading before #70's push that carries #69's effect, and
one about a week after #70's push, which is recorded outside this change.

Read from the owner's signed-in dashboard: Organization → Usage, filtered to the
production project `iefcidjbfnmsiqithqbj`. Figures are **cycle-to-date** for the
billing cycle shown, so compare per-day rates, not raw totals, across readings
taken at different points in a cycle. The organisation is on the Free Plan.

What to expect from this release: the kitchen re-reads its board every 20
seconds while visible and holds one Realtime subscription per kitchen tablet,
and every order write bumps a pulse row that kitchens listen to. #69 adds a
minute `pg_cron` job inside the database, which costs no egress.

## 2026-10-08 14:07 IST — baseline, before #69 shipped

Billing cycle 27 Sep – 27 Oct 2026, day 12 of 31. Kalyani Cafe has traded since
1 Oct, so roughly 8 trading days are in these totals; nothing traded 27–30 Sep.

| Metric | Cycle to date | Note |
|---|---|---|
| Egress | 0.34 GB | daily chart tops out near 53 MB; about 42 MB per trading day on average |
| Cached egress | 0 GB | |
| Database size | 0.058 GB (55.73 MB) | Free Plan includes 0.5 GB |
| Realtime messages | 2,261 | daily chart tops out near 378 |
| Realtime concurrent peak connections | 3 | |
| Edge Function invocations | 777 | daily chart tops out near 135 |
| Monthly active users | 7 | |
| Storage size | 0 GB | |
| Log ingestion | 0.365 GB | not billed until 2027 |
| Log query | 0.638 GB | not billed until 2027 |

API request counts are not on this page; they are under the project's own
Reports → API, if a later reading wants them.

## 2026-10-09 10:31 IST — before #70's push, a trading day after #69

Same billing cycle, day 13 of 31; #69 had been live about twenty hours, across one
evening's trading at Kalyani Cafe.

| Metric | Cycle to date | Since the baseline |
|---|---|---|
| Egress | 0.396 GB | +0.056 GB — one trading day, in line with the ~42–53 MB days before it |
| Cached egress | 0 GB | — |
| Database size | 57.45 MB | +1.72 MB |
| Realtime messages | 2,997 | +736; the daily chart now tops out near 742, up from 378 |
| Realtime concurrent peak connections | 3 | unchanged |
| Edge Function invocations | 889 | +112 |
| Monthly active users | 7 | unchanged |
| Storage size | 0 GB | — |
| Log ingestion | 0.41 GB | +0.045 GB |
| Log query | 0.638 GB | unchanged |

**What #69 itself costs, read from production at the same time.** The day change
runs inside Postgres under `pg_cron`, so it makes no request, no Edge Function call
and no egress. It had run 1,211 times, all succeeding, averaging 17 ms (worst
199 ms), and finished no order — nothing was left unticked overnight. Its only
footprint is `pg_cron`'s run history: `cron.job_run_details` holds one row per run
of each job (8,424 rows, 1.5 MB, for this job and `bill-receipt-recovery`
together), about 0.25 MB a day per every-minute job, kept forever unless purged.
`cron.log_statement` is on, so each run also writes a log line, a small share of the
log-ingestion figure. The higher Realtime peak on 8 Oct is not the job: it writes no
row in a published table unless it finishes an order, and it finished none; a
second Kalyani Cafe tablet set up on 6 Oct doubles the subscribers each order
change reaches.

## About a week after #70's push

Not held in this change, so it can archive once the kitchen is in real use. The
reading is taken after the push and recorded under *Attributing an egress spike*
in `docs/OPERATIONS.md`, against the two readings above.
