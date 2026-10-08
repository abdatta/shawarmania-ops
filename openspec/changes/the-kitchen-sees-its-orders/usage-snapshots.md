# Supabase Usage Snapshots

What this release costs in usage, measured rather than guessed. #69
(`the-day-change-finishes-paid-orders`) and #70 (this change) ship in one push
(owner, 2026-10-08); the readings below bracket it. Task 11.2 adds the
before-push reading and, about a week after the push, a third.

Read from the owner's signed-in dashboard: Organization → Usage, filtered to the
production project `iefcidjbfnmsiqithqbj`. Figures are **cycle-to-date** for the
billing cycle shown, so compare per-day rates, not raw totals, across readings
taken at different points in a cycle. The organisation is on the Free Plan.

What to expect from this release: the kitchen re-reads its board every 20
seconds while visible and holds one Realtime subscription per kitchen tablet,
and every order write bumps a pulse row that kitchens listen to. #69 adds a
minute `pg_cron` job inside the database, which costs no egress.

## 2026-10-08 08:37 IST — baseline, before either change was built

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

## Before the push

*To be recorded (task 11.2).*

## About a week after the push

*To be recorded (task 11.2).*
