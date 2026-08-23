# Proposal: Aggregator Login Live Stages

> **Model**: Opus · **Wave**: D · **Depends on**: #44 · **Gate**: when the
> owner taps Reconnect and the full-login rung fires, the screen shows where the
> sign-in actually is — starting, opening the partner portal, signing in as you,
> waiting for your code (with the input field appearing at that stage), checking
> your code, bringing Hyperpure along, done — each stage arriving within seconds
> of the runner reaching it and without a refresh; no auth-request content beyond
> the stage ever reaches a client; and below all of it, What changed becomes the
> ledger of runs: one item per run, newest first, loaded in pages as the owner
> scrolls, each carrying when it ran, whether it was scheduled or asked for, what
> actually changed if it succeeded, and why it failed if it did, with figures
> that were restated and did not move left unmentioned; and on the ledger, a
> measured Zomato figure carries its as-of time — "As of 11:23 pm" — so a
> reading taken last night can never pass for a live value; and the four-role
> demo walkthrough still walks.

## Why

Tonight's first live full-login rehearsal (2026-08-22) showed the gap in one
sentence: after tapping Reconnect, the screen went silent for four minutes
while a robot in a datacenter signed in on the owner's behalf. The one moment
that needed a human — a code — arrived with no countdown, no explanation, and
three prior attempts expired unclaimed while the screen said nothing. The biller
shift handshake already solved this exact shape: state lives in Supabase and
both sides follow it live. This change gives the aggregator login the same
nervous system.

**And once the sign-in is over, the screen stops telling the story.** The health
line says how the *last* run went; everything older than that is unreachable.
What changed today lists only highlights derived from the tables beside the runs
— settled weeks, disputed weeks, revised days — each capped at a handful of rows
and silent about the runs themselves. A scheduled run that read every cycle and
moved nothing appears nowhere; a run refused because the payout did not add up
appears as a week, never as the run that found it; an outcome still waiting on a
code appears as nothing at all. The owner asked for the other half: the ledger
of runs, with each one saying what it actually did.

The surface's own founding rule objects — "a row here is something that
happened, not a time the job ran" — and the objection was right when it was
written: two channels reading twice a day is well over a hundred runs a month,
nearly all of them quiet, and a row per run would have buried the two that
matter. What makes the same list survivable now is compression plus laziness.
A quiet run compresses to one short line whose summary omits every figure that
was restated and did not move; and the ledger loads in pages, so the hundred
quiet lines cost nothing until the owner actually scrolls into them. Anything
that wants something keeps its louder home in Needs you, exactly as today.

## Scope

**Two columns, not a new table.** `aggregator_auth_requests` gains `stage` and
`stage_at`. The table already carries "a login under way" semantics, its RLS,
its isolation tests and its lifecycle sweep; extending it inherits all of that.

**One new runner-authenticated action.** `aggregator-reader` gains
`report_stage`: validates `stage` against a fixed vocabulary, stamps the open
request for the channel. No free text crosses the boundary.

**The runner narrates milestones it already passes through** (`auth.mjs`, via
the shared sync-repo helper): browser up → portal reached → identifier entered
→ code screen rendered → code accepted → signing in → Hyperpure captured. Five
extra lines of reporting around existing steps.

**A plain-language stepper on the surface.** While a dispatched reconnect has
an open request, the Hyperpure line expands into the stage list — each stage in
owner words, past stages ticked, current one live:

| Stage | Shown as |
|---|---|
| 1 | Starting the sign-in |
| 2 | Opening the Zomato partner portal |
| 3 | Signing in as you |
| 4 | Waiting for your code ← the input field renders here, with its countdown |
| 5 | Checking your code |
| 6 | Bringing Hyperpure along |
| 7 | Done |

Stage four replaces today's disconnected code card: the input field appears
inside the stepper at the stage it belongs to. When the request closes, the
stepper collapses into the usual quiet/ended line per outcome.

**Transport is Supabase Realtime `postgres_changes` on the request row**, so
stages arrive within seconds without polling. Realtime honors RLS, and the
row's policy is owner-only with the `code` column unreadable to every client —
verified property: no session material or code can reach a browser through this
path. A dropped realtime socket degrades to today's behavior (the health poll
still closes the loop), never to a lie.

---

**Runs record how they started.** `aggregator_sync_runs` gains how the run began
— posted by the runner from its own trigger context, which genuinely knows
(a GitHub schedule versus a dispatched workflow), never inferred client-side
from timing or from which button happens to be visible. The vocabulary stays
two words wide. The SQL name dodges the reserved word `trigger`; decided during
propose.

**Runs record what they changed, at write time.** `aggregator_sync_runs` also
gains a summary written in the same transaction as the writes it describes:
which business days' figures actually moved (both figures, old and new), which
week settled against its payout, which days were measured for the first time,
which supply orders a Hyperpure read added or amended, and which dates remain
unwritten for want of a ledger row.

*Recorded rather than derived, deliberately.* The read adapter's header says
"nothing here is a table" and prefers derivation throughout — this is the
exception, and the reason is worth stating once rather than discovered twice.
"What did *this run* change" is only knowable while the run holds both sides:
the figures before and the figures after. Once the write commits, a day
restated identically is indistinguishable from a day touched, and a day
measured for the first time looks like any other — the retained/revised columns
capture some movements, but only the ones settling chose to mark. `ingest_`
already holds both sides; it computes revisions from them today. So the diff is
computed there, folded into the run's row atomically with the writes. A
co-written snapshot cannot drift from what it describes; the drift argument
against a second account applies to views of living data, not to one frozen in
the same transaction.

**Only movement enters the summary.** A settled sheet restating a fortnight-old
week whose figures still match contributes nothing to any row; a Hyperpure read
that re-fetched a two-day-old statement already booked says nothing about it.
Restatement without change is skipped from the summary and skipped nowhere
else — the write path is untouched, and a day that matches is still proof the
figures held.

**One paginated read.** The feed asks for runs newest first, rehearsals
excluded as always (a rehearsal wrote nothing and proves nothing), a page at a
time over the existing index on `(outlet_id, started_at desc)` — no new table,
no new index, no counting the whole history to render the first screen.

**A run ledger under What changed.** Every run gets one item. Each carries the
time it ran, the channel, whether it was scheduled or asked for, and then:

- *Succeeded*: short lines naming what moved, in owner words and ₹ — "12 Aug
  revised ₹9,410.00 → ₹9,286.50", "Week 3–9 Aug paid ₹10,642.70", "3 Hyperpure
  orders added". A run that changed nothing says so in one line and stops.
- *Failed*: why, in the vocabulary Needs you already speaks — signed out,
  reply unreadable, off by ₹X — so a failure healed an hour later is still
  findable an hour later.

The ledger grows downward by infinite scroll: a sentinel loads the next page as
it approaches the viewport, and the placeholder reserves the shape of arriving
run cards while a page is in flight. Needs you is untouched. The merged derived
list that sits under What changed today retires into these two sections:
anything unresolved surfaces in Needs you exactly as now, and history is the
ledger.

**The figure on the ledger says when it was read.** A measured Zomato figure
sits on the day view as a static number, and a static number reads as a live
one: a day read at 11 pm and settled by the 4 am run looks identical to a day
read a minute ago, and whoever opens the ledger at noon cannot tell which they
are looking at — or that the 11 pm reading was ever superseded at all. So the
reading carries its own freshness: "As of 11:23 pm", "As of yesterday, 11:23
pm", and by date once the day is further back, rendered in Asia/Kolkata like
every timestamp here.

This costs no new column and no migration. `aggregator_channel_days` already
maintains `updated_at` on every write, the ledger's read already fetches it
(`select('*')`), and the row mapper drops it on the floor; the change is to
carry it on `ZomatoSettlement`, print it beside the figures in the reading
block, and say in one line what the stamp means — the moment the figures were
last *confirmed*, not the moment they last *moved* (a 4 am run that re-read the
day and found it unchanged still refreshes the stamp, because "checked again at
4 am and it held" is exactly the reassurance the stamp exists to give). When a
figure did move, the movement itself is the run ledger's story and the revised
figures' own from → to; the stamp does not try to retell it.

## Non-goals

- **No streaming for the capture-only rung in v1.** It writes no mailbox row,
  and its five minutes are already covered by the Repairing note. Follow-up if
  wanted.
- **No new infrastructure for the stages** — no new table, no new credentials,
  no broadcast channels, no custom websocket layer.
- **No technical vocabulary.** No "browser context", "storageState", "CI". The
  stage words above and the feed's words are the contract.
- No change to the ladder itself, the probe, or anything #44 settled.
- **No backfilled summaries.** Runs recorded before this change carry their
  outcome, time and detail and render honestly coarse; deriving retroactive
  summaries is impossible by the same argument that makes recording necessary.
- **No search or filters on the ledger in v1.** Newest first and scrolling is
  the whole interface; a filter can be argued for once there is history worth
  filtering.
- **No streaming the ledger.** Pages load on demand; Realtime remains the
  stepper's transport, not the archive's.

## Design questions to settle during `/opsx:propose`

- Whether stage updates should also mark `updated_at` for staleness detection
  (a runner dying mid-stage leaves a stage frozen forever — what should the UI
  show after ten silent minutes?).
- Whether the stepper lives inline on the Hyperpure line or as a card between
  the health lines.
- How demo mode fakes the stage sequence (it should walk all seven against
  mocks, like every other state this surface shows).
- The exact column names and values for "how it started"
  (`trigger` is reserved), and the owner words beside a row — "Twice a day"
  versus "You asked".
- Whether rows predating the recording render as scheduled or as blank, and
  where the honest cut-off line sits ("summaries begin 26 Aug").
- How account-level Hyperpure runs present in a per-outlet ledger: what
  outlet_id a scheduled Hyperpure read carries, and whether its rows appear on
  both outlets' feeds or once.
- Where resolved non-run history lives once the merged list retires — dismissed
  duplicate pairs and accepted differences are decisions, not runs.
- The summary's jsonb shape as a typed contract: mocks compile from generated
  schema types, so the shape the database serves must be the shape the UI
  reads, and money inside it is integer paise.
- Whether consecutive quiet scheduled runs collapse under one day heading or
  stand as one line each.
- Whether the as-of stamp appears on the month grid's figures too, or only on
  the day view where a figure is mistaken for a live value — forty stamped
  cells is noise; a tooltip may be the middle way.
- The stamp's exact words and its formatting helper (today / yesterday / date),
  shared with the health lines so every freshness sentence on these surfaces is
  built by one function.
- Whether Hyperpure's supplied rows in the ledger — expenses, not day figures —
  deserve an equivalent stamp, or whether an expense row's own date already
  says everything an expense needs to say.

## Docs to update before archiving

`docs/SCREENS.md` (the stepper and the run ledger), `docs/OPERATIONS.md` (what
the owner sees during a sign-in, and how to read the run history).
