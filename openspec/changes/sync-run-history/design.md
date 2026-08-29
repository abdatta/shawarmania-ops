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
- **Needs you** and the tab badge behave exactly as they do today.

**Non-Goals**

- Streaming the history. That is #46's transport, for #46's stepper.
- A parent "episode" entity joining runs to auth requests.
- Backfilled summaries for runs recorded before this change.
- Search, filters, or any control other than scrolling.
- Any change to what the sync writes. This change records; it does not decide.

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

### D2. The summary is computed inside `ingest_aggregator_cycle`, in the same transaction

The loop already has `v_existing` and the incoming figures. It accumulates
movements into a local jsonb and folds it into the run's row in the same
transaction as the writes it describes.

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
not. Two words wide. The column is **not** named `trigger` (reserved) — the name
is settled in tasks, with `origin` the working candidate and `started_by` the
alternative if `origin` collides with `aggregator_channel_days.origin` in
readers' heads.

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

**A group could hide a run somebody is looking for.** Mitigated by the count
always being visible and the group always expanding, never by making groups
smarter.

## Migration Plan

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

Steps 1–3 are safe in either order relative to 4. Nothing is destructive and
nothing needs a window: a run recorded without a summary renders coarse, which
is the same thing every pre-change run does permanently.

## Open Questions

- The column name for how a run started, and its two values.
- What `outlet_id` an account-level Hyperpure run carries, and whether it shows
  on both outlets' lists or one. This also decides whether the Zomato/Hyperpure
  pairing the proposal declined becomes cheap later.
- Where dismissed duplicate pairs and accepted differences live once the merged
  derived list retires. They are decisions, not runs, and they must not simply
  vanish.
- Whether a collapsed group's span reads as times within a day or as dates once
  it crosses one.
