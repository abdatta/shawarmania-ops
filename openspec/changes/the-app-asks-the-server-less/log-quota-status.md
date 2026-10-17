# Supabase Log Quota: Where It Stands

The running record for the decision this change serves: whether the
Shawarmania organisation can stay on Supabase's Free plan once log quotas are
enforced in early 2027. Read this first to pick the work up; append to the
timeline, newest last, whenever something moves.

## The problem

Supabase now meters logs. On the Free plan, from early 2027: **1 GB of log
ingestion a month** and **100 GB of log query** (what anybody reads back). The
production project `iefcidjbfnmsiqithqbj` was at 1.02 GB on day 19 of the cycle
that runs 27 September to 27 October 2026, on course for about 2 GB.

About 96% of the volume is the API gateway's `edge_logs`: one ~2.8 KB line per
request the app makes, about 30,000 a day on 15 October. No Supabase setting
reduces it today, and the Postgres settings Supabase's guide names are already
at their quietest defaults. `docs/OPERATIONS.md` → *Supabase log volume* has
the measurement method and the query-allowance habits.

**Why it matters.** Supabase support confirmed that a Free organisation over
its log ingest falls under the general Fair Use Policy, not a "stop logging at
1 GB" rule. The listed restrictions include pausing projects, a read-only
database and 402 responses, any of which stops the counter.

## The plan (owner, 2026-10-15)

1. Cut our own requests: this change, gate `fewer-requests` (FR), about 30%
   fewer, which is about 1.5 GB a month. Still over 1 GB on its own.
2. Ask Supabase for a way to reduce gateway logs, and keep asking until
   **31 December 2026**.
3. If nothing changes by then, **upgrade the organisation to Pro** ($25 a month:
   20 GB ingest, 2,000 GB query). It is a minute's change on the billing page,
   so it is the backstop, not a project.

## Timeline

- **2026-10-15**: production measured (`design.md` → Context).
- **2026-10-15**: support ticket *Free plan: please let us turn off or filter
  API gateway logs*, from the dashboard's support form. Replies go to the
  account email, iamrohandatta@gmail.com. "Allow support access to your
  project" was turned off before sending. Supabase's AI agent ("Sam") answered
  that no setting exists and that overuse falls under Fair Use, as above.
- **2026-10-15**: feature request opened as abdatta:
  [supabase discussions #51817](https://github.com/orgs/supabase/discussions/51817),
  *Logs: let us filter, sample or turn off API gateway (edge_logs) ingest*.
- **2026-10-15**: comment on Supabase's pricing announcement,
  [#50925](https://github.com/supabase/supabase/discussions/50925#discussioncomment-18960277),
  linking #51817.
- **2026-10-15**: we replied to the ticket asking for a person, with two
  questions: which enforcement action applies to a Free organisation over log
  ingest, and from what date; and whether gateway-log filtering or sampling is
  on the roadmap. Sam handed the ticket to a teammate a minute later. No person
  has written as of 2026-10-16.
- **2026-10-15**: this change reached `stage` (`aef1206d`); Staging run
  38795129252 passed. `fewer-requests` is in staging, not yet in production.
- **2026-10-15**: Supabase's pricing and offering manager, `leizerbeam`,
  [replied on #50925](https://github.com/supabase/supabase/discussions/50925#discussioncomment-18953313).
  Log drains do not reduce ingest. They are proposing internally a per-service
  log *verbosity* control, like Postgres's `log_min_messages`, for the API
  gateway, Realtime and Edge Functions, so gateway logs could be set to errors
  only. He asked whether that would solve it.
  [diarmidmackenzie](https://github.com/supabase/supabase/discussions/50925#discussioncomment-18953618)
  (Free plan) answered yes, on three conditions: it is available on Free, it
  ships before enforcement, and Free organisations face no Fair Use restriction
  for log ingest meanwhile. `riglar` asked for drop rules by endpoint, and
  `Fab-Ver` added a +1.
- **2026-10-16**: the owner turned `fewer-requests` on in staging.
- **2026-10-16**: promoted to `main` as `8951e81a` (Promote 07:06 UTC, Deploy
  of `f0b4c7c6` green) and turned on in production at 07:11 UTC (12:41 IST).
  Both production tablets, *Shawarma Kitchen* and *Kalyani Counter 2*, ran
  build `f0b4c7c` with the gate on through that day's service: about 2
  requests a minute idle, no failures.

## Open items

- **Reply to leizerbeam on #50925**, under his comment, saying the verbosity
  control would solve it for us on diarmidmackenzie's three conditions, with
  our numbers and a link to #51817. Drafted on 2026-10-16 and awaiting the
  owner's approval; not posted.
- **A person on the support ticket.** Supabase owes us an answer to the two
  questions. Nudge politely in the same thread if two weeks pass with nothing.
- **Measure `fewer-requests` in production.** On since 16 October, mid-cycle.
  The daily *Log Ingestion per day* chart on Organization → Usage should fall
  from about 70–80 MB to about 50 MB a day from 16 October; the first full cycle
  with it on is 27 October to 27 November. The archive waits for that reading
  (`tasks.md` 7.1).
- **`cron.log_statement` off**: about 2% more. Production configuration and the
  owner's call, outside trading hours; the command is in `docs/OPERATIONS.md`.
- **Decide by 31 December 2026**: stay on Free if Supabase ships a gateway
  verbosity control on Free in time, or commits in writing to one; otherwise
  upgrade to Pro.

## How it is being followed

- A scheduled task, `supabase-logs-followup`, runs each Monday on the owner's
  PC, in the Claude desktop app, until 31 December 2026. It reads the ticket
  thread and both GitHub threads, reports what changed, and drafts a nudge when
  one is due. It never sends or posts; every message goes out only after the
  owner approves it. It lives outside this repository, so another machine or
  account does not have it; anyone resuming elsewhere checks the threads by hand.
- Posts go out as GitHub user `abdatta` and from iamrohandatta@gmail.com. Every
  post and email so far was approved by the owner before it went out.
