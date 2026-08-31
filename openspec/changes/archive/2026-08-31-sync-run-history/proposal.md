# Proposal: Sync Run History

> **Model**: Opus · **Wave**: D · **Depends on**: #47 · **Gate**: Zomato and
> Swiggy are one **Delivery** entry whose switch hides no waiting work — the
> entry's badge is the sum, each channel carries its own count without being
> selected, the channel is in the route so a link opens on it, and one channel's
> session, repair and history still cannot touch the other's; and every run the
> sync has made is readable on that surface, newest first,
> loaded in pages as the owner scrolls — the ones that moved figures, the ones
> that moved nothing, the ones that failed, the ones the owner asked for and the
> one happening right now; a run that moved something says what moved in ₹ and
> from → to, a run that failed says why in the words Needs you already speaks,
> and a later success stops the nagging without erasing the failures it healed;
> consecutive runs telling an identical story collapse to one line carrying its
> count and span, expandable, and never collapse across an outcome change, a run
> that moved a figure, a run the owner asked for, a channel or a day; and the
> four-role demo walkthrough still walks.

## Why

The surface reports the last run and nothing else. Everything older is
unreachable, and three whole classes of run are invisible even while they are
happening.

The list under **What changed** is derived from the tables beside the runs —
settled weeks, disputed weeks, revised days — each capped at a handful of rows
and silent about the runs themselves. `events()` asks for failures with
`.in('outcome', ['session_lapsed', 'shape_changed'])`, which is two of the five
words the `aggregator_sync_runs_outcome_known` constraint permits. So:

- a run refused because the payout did not add up (`reconciliation_failed`)
  appears as a disputed week, never as the run that found it;
- a run still holding for a code (`awaiting_one_time_password`) appears as
  nothing at all;
- a run in flight (`finished_at is null`) appears as nothing at all;
- a scheduled run that read every cycle and moved nothing appears nowhere.

There is a fourth absence, and it is the one that costs the most. The adapter
deliberately heals: *"One successful run ends every failure older than it — they
were all symptoms of the one dead session."* That rule is right for **Needs
you** and wrong for history. A session that died at 4:10 am and was repaired at
noon generated nine failed reads in between, and after the repair not one of
them can be found. The evidence disappears exactly when somebody starts asking
what happened.

The owner asked for the other half: the history of runs, with each one saying
what it actually did.

**The surface's own founding rule objects**, and it was right when it was
written. `aggregator-settlement-sync` says outright: *"a row on it SHALL be an
event... A run that changed nothing SHALL NOT occupy a row of its own"*, because
*"a row per run would bury the events worth reading inside a majority that
report nothing."* Two channels reading twice a day is well over a hundred runs a
month, nearly all of them quiet.

What makes the same list survivable now is **compression plus laziness**. Runs
that tell an identical story collapse into one line with a count; and the list
loads in pages, so a hundred quiet lines cost nothing until somebody scrolls
into them. Anything that wants something keeps its louder home in **Needs you**,
exactly as today.

## Scope

### First, the two tabs become one

Zomato and Swiggy are the same screen twice. They have been one component since
#47 — `AggregatorSyncSurface` rendered through an `AggregatorChannelConfig`
whose whole diff is a title, an icon, a few sentences of copy and whether
Hyperpure rides along. **Navigation is the last place the twin still exists**,
and it costs the owner two of their twelve tabs.

They become one **Delivery** entry. The channel is chosen on the surface, in the
shape the ledger and attendance already use for their own switches, and the
route carries it — `ledger/delivery/:channel` — so a badge, a link or a
returning reader lands on the channel the work is on. The old paths redirect.

**The switch hides nothing.** The entry's badge is the sum across both channels
and each channel carries its own count on the switch itself, unselected. The
surface already argues this for its outlet chips, in its own words: *"the tab
says three, the page shows one, and the other two are somewhere the reader has
to go looking for by switching outlets and hoping."* A channel switch that did
not decompose would reintroduce exactly that. Where only one channel has work
waiting, the surface opens on it.

**What stays independent stays independent, and it is not the packaging.**
`aggregator-settlement-sync` requires today that Swiggy's *"gate, route and
attention badge SHALL be independent from Zomato"*, and the reason given is
sound: Swiggy holds its own session, so its waiting work can be neither created
nor cleared by anything Zomato does. That reason is about **readers, sessions
and counts** — not about how many rows the navigation has. The requirement is
relaxed for the container and re-asserted for the substance: separate adapter
instances, separate sessions, separate histories, separate repairs, and a test
proving a Swiggy reconnect leaves a lapsed Zomato lapsed.

**This lands before anything else in the change, and that is the point.**
Section 6 rewrites the body of this surface and section 7 judges it on a phone
in both themes. Doing the merge afterwards would mean doing both twice, and
would mean discovering a navigation problem at archive time rather than on the
first day. Done first, the history is built into its finished container and
judged once.

### The list shows every run

Manual and scheduled, succeeded and failed, moved a figure and moved nothing,
finished and still running. **Rehearsals stay excluded** — every read on this
surface already excludes them (`rehearsal = false`) because a rehearsal writes
nothing and proves nothing about the live figures, and this change makes that an
explicit decision rather than an inherited filter.

**A later success no longer erases failures.** Healing is retained where it
belongs — the **Needs you** section and the tab badge keep the newest-run-wins
rule unchanged — and dropped from the history, where a healed failure is still
the record of an outage.

### Runs record how they started

`aggregator_sync_runs` gains how the run began — posted by the runner from its
own trigger context, which genuinely knows (a GitHub schedule versus a
dispatched workflow), never inferred client-side from timing or from which
button happens to be visible. The vocabulary stays two words wide. The SQL name
dodges the reserved word `trigger`; decided during propose.

### Runs record what they changed, at write time

`aggregator_sync_runs` also gains a summary written in the same transaction as
the writes it describes: which business days' figures actually moved (both
figures, old and new), which week settled against its payout, which days were
measured for the first time, which supply orders a Hyperpure read added or
amended, and which dates remain unwritten for want of a ledger row.

*Recorded rather than derived, deliberately.* The read adapter's header says
"nothing here is a table" and prefers derivation throughout — this is the
exception, and the reason is worth stating once rather than discovered twice.
"What did *this run* change" is only knowable while the run holds both sides:
the figures before and the figures after. Once the write commits, a day restated
identically is indistinguishable from a day touched, and a day measured for the
first time looks like any other — the retained/revised columns capture some
movements, but only the ones settling chose to mark. `ingest_aggregator_cycle`
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

### What a run says

- *Succeeded, something moved*: short lines naming what moved, in owner words
  and ₹ — "12 Aug revised ₹9,410.00 → ₹9,286.50", "Week 3–9 Aug paid
  ₹10,642.70", "3 Hyperpure orders added".
- *Succeeded, nothing moved*: one line, and it is the line that collapses.
- *Failed*: why, in the vocabulary **Needs you** already speaks — signed out,
  reply unreadable, off by ₹X — so a failure healed an hour later is still
  findable an hour later.
- *Still running*: its own row at the top, reading as under way.

### One collapse rule, not one per case

> **Consecutive runs that tell an identical story collapse into one line
> carrying the count and the span. The line stays expandable, and its count is
> always visible.**

One rule rather than a special case per outcome, so a future outcome word is
collapsed without anyone writing collapsing code for it. It buys two things at
once:

| | Reads as |
|---|---|
| The quiet majority | `6 scheduled reads, nothing moved · 24–26 Aug` |
| A session outage | `9 reads failed, signed out · since 24 Aug, 4:10 am` |

The second is the more valuable of the two and nobody asked for it. When a
session dies, every scheduled run until the repair fails identically — the
noisiest thing this list will ever produce, and the thing healing hides today.

**Collapsing breaks on**, and these are correctness rules rather than
preferences:

- **a change of outcome** — two quiet runs either side of a failure must never
  merge, or the line claims a continuity that did not happen;
- **a run that moved a figure** — a run carrying a summary is never collapsed;
  it is the reason the list exists;
- **a run the owner asked for** — always its own line, however many in a row.
  Four taps of Read now render four lines. The owner tapped it and will look for
  it by its time, which is the whole reason the run records how it started;
- **a change of channel**;
- **a day boundary**.

A run still in flight never collapses.

### Day headings

The list carries a date rail — `Today`, `Yesterday`, `26 Aug` — rendered in
Asia/Kolkata like every timestamp here. It costs almost nothing, it is what
makes a hundred lines scannable rather than soup, and it gives the collapse rule
a natural boundary so a group never silently spans three days.

### One paginated read

The feed asks for runs newest first, rehearsals excluded, a page at a time over
the existing index on `(outlet_id, started_at desc)` — no new table, no new
index, no counting the whole history to render the first screen. A sentinel
loads the next page as it approaches the viewport, and the placeholder reserves
the shape of arriving run cards while a page is in flight.

**Collapsing runs after the fetch, not inside it.** A group of seven straddling
a page boundary would otherwise render as a group of three with a group of four
beneath it. Groups are computed client-side over the accumulated list, and
adjacent groups re-merge on every page arrival.

### What retires

The merged derived list under **What changed** retires into two sections:
anything unresolved surfaces in **Needs you** exactly as now, and history is
this list. **Needs you** is untouched.

## Non-goals

- **No streaming.** Pages load on demand. Realtime belongs to #46's stepper, not
  to the archive.
- **No new table and no new index.** Two columns on `aggregator_sync_runs`.
- **No backfilled summaries.** Runs recorded before this change carry their
  outcome, time and detail and render honestly coarse; deriving retroactive
  summaries is impossible by the same argument that makes recording necessary.
  An honest cut-off line says where the summaries begin.
- **No search or filters in v1.** Newest first and scrolling is the whole
  interface; a filter can be argued for once there is history worth filtering.
- **No rehearsals in the list.**
- **No collapsing a reconnect into one episode.** Grouping the dispatched run,
  the code request, the sign-in and the resumed reads into a single "You
  reconnected · succeeded after 4 min" item reads beautifully and needs a parent
  entity the schema does not have, joining `aggregator_sync_runs` to
  `aggregator_auth_requests`. #46 is about to tell that story live on the same
  screen; let it ship, then decide whether the history still wants it.
- **No pairing a Zomato run with its Hyperpure companion.** They are one
  operation recorded as two rows and showing them as one item would be honest,
  but Hyperpure runs are account-level and it is unresolved what `outlet_id` a
  scheduled Hyperpure read carries or whether it belongs on both outlets' lists
  or one. That question is asked below; if it resolves cleanly the pairing may
  follow, and it is not a condition of the gate.
- **No combined feed.** The switch is exclusive: one channel's runs at a time.
  Interleaving two independent accounts' failure storms into one list, each
  wanting a different repair, is worse than two lists — and the collapse rule's
  channel break exists for Zomato's Hyperpure companion, not to make a merged
  feed legible.
- **No copy sweep from "aggregator" to "delivery".** The ledger and the
  statement surface say "aggregator" in visible prose today, in three places.
  The navigation entry reads Delivery because that is the owner's word for it
  and it fits a phone tab; a sentence explaining commission is a different
  register and nobody reads the two side by side. Reconciling them is a copy
  change with no business inside this one.
- **No per-channel gating retained.** One gate replaces two, knowingly. See D9.
- **No technical vocabulary.** No "browser context", "storageState", "CI".
- No change to the ladder, the probe, the write path, or anything #44 and #47
  settled.

## Design questions to settle during `/opsx:propose`

- **Settled already, on paper, before any code** — the two the merge raised:
  one gate replaces two and the old paths redirect (D9), and the entry reads
  **Delivery**, a word the application uses nowhere else a reader can see (D10).
  Neither needed an experiment; both are recorded so the apply session does not
  reopen them.
- The exact column names and values for "how it started" (`trigger` is
  reserved), and the owner words beside a row — "Twice a day" versus "You
  asked".
- Whether rows predating the recording render as scheduled or as blank, and
  where the honest cut-off line sits ("summaries begin 29 Aug").
- How account-level Hyperpure runs present in a per-outlet list: what
  `outlet_id` a scheduled Hyperpure read carries, and whether its rows appear on
  both outlets' feeds or once.
- Where resolved non-run history lives once the merged list retires — dismissed
  duplicate pairs and accepted differences are decisions, not runs.
- The summary's jsonb shape as a typed contract: mocks compile from generated
  schema types, so the shape the database serves must be the shape the UI reads,
  and money inside it is integer paise.
- Whether a collapsed group's span reads as a range of times within one day or
  as dates once it crosses one.
- How demo mode fakes a hundred runs' worth of history against mocks, including
  a collapsed group and a failure storm.

## Docs to update before archiving

`docs/SCREENS.md` on two counts: the Zomato and Swiggy entries — the line
stating that a row is an event rather than a run is the one this change
overturns — and the navigation itself, where the sentence *"Expenses, Zomato,
Swiggy and the notebook are all readings inside one group"* becomes one Delivery
reading in that group. And `docs/OPERATIONS.md` (how to read the run history,
what a collapsed line means, and which channel a Delivery link opens on).
