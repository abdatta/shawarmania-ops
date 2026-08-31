# Design: Sync Run History

## Context

The Zomato and Swiggy surfaces answer one question well — *did the last read
work?* — and cannot answer the next one at all: *what has it been doing?*

Three facts about the current code set the shape of this change.

**1. The failure filter is narrower than the vocabulary.** `events()` in
[`aggregator-sync.ts`](../../../src/data-access/supabase-adapters/aggregator-sync.ts)
selects failures with `.in('outcome', ['session_lapsed', 'shape_changed'])`.
The check constraint `aggregator_sync_runs_outcome_known` permits five words:
`ok`, `session_lapsed`, `awaiting_one_time_password`, `shape_changed`,
`reconciliation_failed`. Two of the three unlisted states are exactly the ones
somebody would go looking for — a run holding for a code, and a run that refused
to write because the payout did not add up. A sixth state is implied rather than
stored: `finished_at is null` means still running, and the health line already
derives `running` from it.

**2. The adapter heals, and healing is destructive to history.** A `recovered`
query takes the newest `ok` run and drops every failure older than it. The
comment states the reasoning plainly — they were symptoms of one dead session —
and it is correct for the badge and for **Needs you**. Applied to history it
deletes the record of an outage at the moment the outage ends.

**3. The write path already holds both sides of every figure.**
`ingest_aggregator_cycle` reads `v_existing` before every upsert and computes
`superseded_*` and `provisional_*` from the comparison. The information needed
to say *what this run changed* is in scope inside that loop and nowhere else
afterwards.

**4. The two surfaces have been one component since #47.**
[`aggregator-sync-surface.tsx`](../../../src/features/aggregator-sync/aggregator-sync-surface.tsx)
is rendered through an `AggregatorChannelConfig`, and the whole difference
between the channels is a title, an icon, a few sentences of copy and whether
Hyperpure rides along. Navigation is the only place the twin still exists. This
change rewrites the body of that surface, so it is the change that can merge the
container for free — or the change that pays to judge the same surface twice.

The governing spec requirement says a row is an event, not a run, and gives a
sound reason: over a hundred runs a month, nearly all quiet. This change
overturns it and has to carry the burden of that reason.

## Goals / Non-Goals

**Goals**

- Every non-rehearsal run is reachable, including failures a later success
  healed, runs in flight, and runs that changed nothing.
- A run states what it did, in rupees and in owner words, from a record written
  when it could still be known.
- A hundred quiet runs cost one line and no bytes until scrolled to.
- **Needs you** behaves exactly as it does today, and the badge counts exactly
  what it counts today — now summed across both channels and decomposed onto
  the switch, so no waiting work moves out of view.
- One navigation entry for the restaurant channels, with their sessions,
  readers, counts and repairs still fully independent.

**Non-Goals**

- Streaming the history. That is #46's transport, for #46's stepper.
- A parent "episode" entity joining runs to auth requests.
- Backfilled summaries for runs recorded before this change.
- Search, filters, or any control other than scrolling.
- Any change to what the sync writes. This change records; it does not decide.
- A combined feed showing both channels' runs interleaved.
- Reconciling the word "aggregator" in existing visible copy with "Delivery".

## Decisions

### D1. Two columns on `aggregator_sync_runs`, no new table

`origin` (how the run began) and a jsonb `summary` (what it changed).

*Rejected: a `aggregator_sync_run_changes` child table, one row per movement.*
Better normalised, and it buys nothing here. Nothing queries movements across
runs, nothing aggregates them, and the read is always "this run's changes" —
which is a fetch of the parent row either way. A child table adds a join, an
index, an RLS policy and an isolation test case to serve a payload that is
rendered as prose and never filtered.

*Rejected: deriving the summary at read time from `superseded_*`/`revised_*`.*
This is the load-bearing decision and it is worth stating once. Those columns
capture the movements *settling chose to mark*, not the movements that happened.
After the write commits, a day restated identically is indistinguishable from a
day touched, and a first measurement looks like every other row. The question
"what did this run change" stops being answerable the moment the transaction
ends.

### D2. The summary is computed inside `ingest_aggregator_cycle`, in the transaction that writes

The loop already has `v_existing` and the incoming figures. It accumulates
movements into a local jsonb and returns them with the rest of the cycle's
result.

**Amended during apply, and the amendment is worth reading.** This decision, and
the requirement written from it, both said the summary is *folded into the run's
row* in the same transaction as the writes. It cannot be, and the reason is
structural rather than a shortcut: `ingest_aggregator_cycle` is one RPC per
cycle and **the run's row does not exist yet while it runs**.
`record_aggregator_sync_run` is called afterwards by the Edge Function, once,
covering every cycle, and each RPC is its own transaction. Nothing knew the run
id at ingest time before this change and nothing does after it.

So the boundary moves by one step and the load-bearing property is kept whole:

- **The diff is computed inside the writing transaction**, from `v_existing` and
  the incoming figures, while both sides are still known. This is the whole of
  the argument — after the write commits, a day restated identically is
  indistinguishable from a day touched.
- The cycle **returns** its movements, and the Edge Function carries them onto
  the run's record in the call it already makes.

What is given up is only that the run row and the figures commit together, and
its consequence is one already present today: an ingest that commits and a run
record that then fails leaves writes with no run row, which is exactly what
happens now and is already logged loudly. What is *not* given up is the reason
the recording exists — the summary is never derived from stored figures after
the fact.

The alternative was opening the run row before the cycles and passing its id
in, which makes it literally atomic and rewrites the run lifecycle: an open row
that a crashed function never closes reads as "Reading" forever and disables
Read now, where today a crash leaves no row. That is #46's territory and the
proposal put it out of scope.

**This is the money-path edit and it carries the change's real risk.**
Mitigations, all mandatory:

- The accumulator is **write-only bookkeeping**. It reads `v_existing` — already
  read — and appends. No control flow branches on it; delete every accumulator
  line and the function must write byte-identical rows.
- Money inside the summary is **integer paise**, the same `bigint` values the
  columns hold, never formatted, never divided. Rupee formatting happens in the
  UI.
- The existing `%_paise` integer assertions on the payload stay ahead of it.
- A test asserts the invariant directly: run the same cycle through the old and
  new function and diff `aggregator_channel_days`, `manual_ledger_expenses` and
  `aggregator_cycle_reconciliations`. Any difference is a bug in this change.

*Rejected: computing the diff in the edge function around the RPC.* It would
need to read every affected day before and after, in two extra round trips, and
the window between them is not the transaction — a concurrent settlement would
be attributed to the wrong run.

### D3. A skipped day contributes nothing, and that is correct

A settled day hits `continue` before the upsert, so it is not read, not written,
and not summarised. A run whose payload is entirely already-settled days
summarises as nothing moved, which is true.

### D4. `origin` is posted by the runner, never inferred

The runner knows its own trigger context; a client looking at timestamps does
not. Two words wide.

**Settled during apply: the column is `started_by text`, and its two values are
`schedule` and `owner`.** Not `trigger`, which is reserved. Not `origin`, and
the collision this decision anticipated is real rather than theoretical:
`aggregator_channel_days.origin` already exists in the same domain, is read
through the same adapter file, and holds four values that all name *where a
figure came from* — `daily_reader`, `settlement`, `supplied_by_hand`,
`legacy_typed`. A second `origin` a table away, meaning something else entirely,
would be read as the same kind of thing.

`started_by` carries one known trap and the column comment names it: everywhere
else in this schema a `_by` column holds a uuid (`accepted_by`, `recorded_by`).
This one holds a word. It is still the best name available, because it is the
plain English answer to what the column records — the schedule started this run,
or the owner did — and the check constraint makes a uuid impossible rather than
merely unexpected.

*Rejected: inferring "the owner asked for it" from proximity to a dispatch.* Two
scheduled runs and one manual run inside the same minute are indistinguishable
by time, and this list exists to be believed.

### D5. Healing splits: kept for Needs you, dropped for history

The `recovered` query stays exactly as it is and keeps feeding **Needs you** and
the badge. The history read does not consult it. One rule per audience, both
stated where they apply.

### D6. One collapse rule, applied client-side after pagination

Collapsing is a rendering decision over the accumulated list, not a query.

*Rejected: collapsing in SQL with a window function.* It cannot be correct
across pages — the first page cannot know that the run just past its boundary
belongs to the group it just closed. It would produce a group of three followed
by a group of four where one group of seven belongs.

The grouping function takes the accumulated array and returns groups; it re-runs
on every page append, so adjacent groups merge as the boundary fills in. It is
pure and unit-tested against the boundary case explicitly.

**The break rules** are the spec's, not the renderer's preferences: outcome
change, a run carrying a summary, a manual run, a channel change, a day
boundary, and a run in flight.

### D7. Rehearsals stay out

Every other read here excludes them and the reasoning holds: a rehearsal writes
nothing, so it says nothing about the figures. Recorded as a decision so the
next person does not read `rehearsal = false` as an oversight in a list that
claims to show everything.

### D8. Pagination over the existing index

`(outlet_id, started_at desc)` already exists. Keyset pagination on
`started_at`, not `offset`, so a run arriving mid-scroll cannot shift a page
boundary and duplicate a row. No count query: the list ends when a page returns
short.

### D9. One gate at `ledger/delivery/:channel`; the two channel gates go `hidden`

A single `owner-delivery-sync` entry carries the navigation, the label and the
aggregated attention source. `owner-zomato-sync` and `owner-swiggy-sync` become
`state: 'hidden'` rather than being deleted — the registry's own convention,
stated on `admin-daily-cash`: *"Not deleted, deliberately."*

What two gates buy is promoting or demoting one channel without the other, and
today that is worth nothing: both are `live`, and #46 touches them equally. If
it is ever needed the cheaper lever already exists and is not the registry — the
channel is **data in `channel-config.ts`**, so a channel can be withheld by not
building its config, with no route, gate or badge involved.

*Rejected: two gates sharing one label.* `visibleSurfaces` dedupes navigation by
label and takes the lower order, which is how `admin-expenses` and
`admin-ledger-expenses` already share one Expenses tab, so this would work. It
is refused because the switch would then be navigating between two routes under
two gates, and "the badge lands on the channel that raised it" becomes gate
resolution instead of a route parameter.

**One consequence, accepted explicitly.** `hidden` means *"no navigation entry,
no reachable route, in any mode"*, and
[`gated-surface.tsx`](../../../src/routes/gated-surface.tsx) renders `NotFound`
for it. So `ledger/zomato` and `ledger/swiggy` stop resolving on their own. Two
plain redirect routes are added in `surfaces.tsx` outside `GatedSurface` — there
is no redirect precedent in that file, so this is a new small pattern, and it is
preferred to a 404 on a URL the owner may well have on their phone.

### D10. The entry reads **Delivery**

Checked rather than assumed. No user-visible "Delivery" string exists anywhere
in the application: the `BillingDelivery*` names throughout the billing adapter
are the offline outbox delivering commands to the server, internal and never
rendered. Billing has no dine-in/takeaway/delivery order type to collide with,
and the counter names Swiggy and Zomato only individually, never collectively.

The one genuine finding is that visible prose already has a collective noun and
it is "aggregator" — `ledger-month.tsx` twice and `ledger-statement-surface.tsx`
once. Two words for one pair is a real cost, and it is accepted rather than
swept: a navigation label and a sentence about commission are different
registers, they are never read side by side, and "Delivery" is the word the
owner reached for unprompted, which is better evidence about their vocabulary
than what the code happens to say.

### D11. The channel switch is a scope selector, and therefore badged

It will look like the ledger's One day / The month and attendance's Day / Staff,
because a reader should not have to learn a second idiom for "switch what this
screen is about". It is not the same *kind* of control, and the difference
decides one thing. Those two switch **lenses on one dataset**; this one switches
between **two independent accounts**, which is what the outlet chip row on this
very surface already does — and that row carries a count per outlet, for the
reason its own code gives: *"the tab says three, the page shows one, and the
other two are somewhere the reader has to go looking for by switching outlets
and hoping."*

So: the ledger's shape, the outlet chips' semantics. Each segment carries its
own count, readable without selecting it. The rule is written into
`attention-badges` rather than into this surface, because it is a general
property of badging a container and the outlet chips have been obeying it
unwritten since they were built.

**Amended during apply, on the owner looking at it: the two controls nest,
outlet first.** The navigation badge counts every channel at every outlet; each
outlet chip carries that outlet's share across both channels; the channel switch
beneath carries the selected outlet's share per channel. Chips add to the badge,
segments add to the filled-in chip.

Built the other way round first — segments totalled across outlets, chips scoped
to the selected channel — which is equally consistent arithmetic and reads
wrongly for one reason: **everything else beneath the chips is already scoped to
the chosen outlet**, so a chip whose number changed when the reader switched
channel tabs was the single control on the page that did not mean what it looked
like. The chip has to mean here what it means on attendance and the ledger.

The two were indistinguishable in the demo, which is how it survived a phone
review: the fixture was 1, 2, 1, 2 across the grid, and a symmetric grid shows
identical digits whichever way the arithmetic runs. It is 1, 2, 3, 4 now, and the
change is not cosmetic — a demo that cannot tell two designs apart cannot be used
to choose between them.

Arrival: where exactly one channel has waiting work, the surface opens on that
channel; otherwise it opens on the channel in the route.

### D12. The merge is section 0, and that is what makes bundling it safe

Section 6 rewrites the body of this surface; task 7.2 judges a hundred runs on a
phone in both themes. Both are invalidated by a container change landing after
them. Sequenced first, the merge is a small self-contained edit — registry,
route, one attention source, badged switch — that is finished and judged before
the migration is written, and the history is then built into its final home and
judged once.

This also converts the main risk of bundling. A navigation defect found in
section 0 costs a day; the same defect found at gate time holds a migration, two
rewritten ingest functions and an external repo change hostage. Sections 0 and
1–8 touch disjoint files, so either can be reverted without the other.

### D13. The cadence is reported by the runner, not asserted by the app

Added during apply, on the owner noticing the surface said "twice a day" when the
readers had run four times a day for weeks.

It could not have been right. The cadence was prose in this repository about
crons in another one, so nothing could fail when they diverged — the same class
of defect as D4's origin, and the same answer: **the process that runs under the
schedule is the only one that knows.** It has its own workflow file in its
checkout and GitHub hands it the path in `GITHUB_WORKFLOW_REF`, so it parses the
cron and posts `reads_per_day` with each run.

*Recorded per run rather than as configuration.* The health line already reads
the newest run, so it costs no query; and a run that ran under the old schedule
keeps saying so, which means the history reads correctly across a cadence change
instead of retelling every past run under today's number.

*And the lockout is derived from it.* `READ_AGAIN_AFTER_HOURS` was a constant six
— one read interval at four a day, and half an interval as soon as that changed.
It is `24 / readsPerDay` now, because the rule it means to express is "there is
nothing new until the next scheduled read".

*Rejected: deriving the cadence from observed run timings.* Self-correcting and
needs no new field, but it reads low for exactly as long as an outage lasted, and
the caption would then shorten the lockout at the moment the sync was least
healthy. *Rejected: fetching the workflow from GitHub at read time.* Needs a
token the browser must not hold, so an Edge proxy and a rate limit for a caption.

**A bad value is dropped, not refused**, unlike an unknown `started_by`. A third
origin word means a caller invented one; a bad cadence means a cron parse
slipped, and failing a settlement run over a caption would trade a wrong number
for no run record at all.

## Risks / Trade-offs

**The money function is the risk.** `ingest_aggregator_cycle` has been rewritten
nine times and writes settlement figures under `security definer`. D2's
mitigations exist because a summary is worth nothing next to a wrong figure. If
the byte-identical test in tasks cannot be made to pass, the change stops there.

**The founding rule is being overturned, not amended.** If compression and lazy
loading do not actually make the list readable, the surface gets worse, not
better. The demo fixture in tasks builds a hundred runs including a failure
storm precisely so this is judged before it ships rather than after.

**`origin` is null for every existing row.** Honest rendering of a pre-change
run is a blank, not a guess. The cut-off line says where recording begins.

**This change now carries two concerns, and that is a real cost.** A schema and
money-path change and a navigation change share one gate, so a defect in either
holds both. It is taken deliberately, on the owner's decision, and contained
three ways: the merge lands first (D12), the two halves touch disjoint files and
revert independently, and the merge half is entirely settled on paper before the
apply session starts — D9 and D10 answer the only two questions it raised. What
remains genuinely undecided in section 0 is cosmetic: where a count sits on a
segment, judged by looking at it on a phone.

**Two founding requirements are being overturned now, not one.** Alongside *a
row is an event rather than a run*, `aggregator-settlement-sync` also requires
that Swiggy's *"gate, route and attention badge SHALL be independent from
Zomato"*. The delta relaxes that for the container and re-asserts it for the
substance — separate adapters, sessions, histories and repairs — with a scenario
proving a Swiggy reconnect leaves a lapsed Zomato lapsed. If that scenario
cannot be made to pass, the merge is wrong and section 0 stops, which is the
whole reason it runs first.

**A group could hide a run somebody is looking for.** Mitigated by the count
always being visible and the group always expanding, never by making groups
smarter.

## Migration Plan

0. **The merge, first and alone.** Registry, route and redirects, the aggregated
   attention source, the badged switch, tests, and the navigation half of
   `docs/SCREENS.md`. No schema, no adapter, no data. Judged on a phone before
   step 1 begins; revertible on its own.
1. Migration adds `origin text` and `summary jsonb`, both nullable, both with
   column comments. No backfill. No new RLS policy — the table's existing
   owner-scoped policy covers both columns, and the isolation test case for
   `aggregator_sync_runs` already exists and is re-asserted rather than added.
2. `ingest_aggregator_cycle` and `ingest_supply_statement` gain the accumulator
   and write the summary. The byte-identical test lands with them.
3. Sync repo posts `origin`. Deployable independently and before the UI: an
   unread column breaks nothing.
4. Adapter gains the paginated read; the surface gains the list; the merged
   derived list retires.

Step 0 stands alone and is safe before all of them. Steps 1–3 are safe in
either order relative to 4. Nothing is destructive and
nothing needs a window: a run recorded without a summary renders coarse, which
is the same thing every pre-change run does permanently.

## Open Questions

- ~~The column name for how a run started, and its two values.~~ Settled in D4:
  `started_by`, holding `schedule` or `owner`.

- ~~Where dismissed duplicate pairs and accepted differences live once the merged
  derived list retires.~~ **Settled during apply: a third section, `What you
  decided`, between *Needs you* and the history.** It carries exactly the
  resolved rows that record a DECISION — a dismissed duplicate pair and an
  accepted difference — and nothing else. A settled week and a revised day were
  resolved rows too, and both are now runs that say what moved and by how much,
  so listing them here as well would be the same fact twice under two headings.
  It reads from the events the surface already has, so nothing new is fetched
  and nothing vanished.

- ~~Whether a collapsed group's span reads as times within a day or as dates
  once it crosses one.~~ **Settled by the collapse rule itself: it cannot cross
  one.** A day boundary breaks a group, so a span is always two times within one
  day — `3 reads · 5:15 am–11:15 pm` — and the date is on the rail above it. The
  question dissolved rather than being answered.

- **Still open: what `outlet_id` an account-level Hyperpure run carries**, and
  whether its rows appear on both outlets' feeds or one. Untouched by this
  change, which is why it is still here: Hyperpure runs are recorded on the
  `hyperpure` channel and the history reads one restaurant channel at a time, so
  none of them appear in it. What a Hyperpure read *moved* does reach the
  history — the supply-order counts ride the Zomato run that towed them — and
  that is the half the owner asked for. This also still decides whether the
  Zomato/Hyperpure pairing the proposal declined becomes cheap later.
