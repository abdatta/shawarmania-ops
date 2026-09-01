# Proposal: A Degraded Sync Is Visible

> **Model**: Opus · **Wave**: — · **Depends on**: — · **Gate**: a run that wrote
> some of what it read is recorded once, as one run, carrying both the figures it
> moved and the reason it fell short — not as a success, and not as a failure that
> threw its own writes away; and a channel that has stopped running reads as
> stopped on the owner's surface rather than as its last success, within one
> missed read rather than after however many nobody noticed; and the four-role
> demo walkthrough still walks.

**No roadmap row.** This repairs a guarantee the surface already makes — *"The
surface SHALL state when the sync last ran and whether it succeeded"* — rather
than adding capability anyone asked for. It gets a change folder, a gate and a
spec delta, and no number or wave.

## Why

On 2026-08-31 Swiggy changed one GraphQL operation. Both scheduled Swiggy readers
died on it and stayed dead for eighteen hours. **The app said Swiggy was fine for
all eighteen of them**, and it was not lying by accident: it was reporting the
newest thing anybody had said about the channel, and the newest thing anybody had
said was the last success before the break.

Two faults in this repository, each of which would have shortened that outage on
its own.

### A run cannot say it partly worked

`ingest-aggregator-cycle` returns early when a non-`ok` outcome is declared:

```ts
if (declared && declared !== 'ok') {
  return await finish(declared, str(body['detail']) ?? null, 200)
}
```

The `cycles` in that same request are never looked at. So a runner has exactly
two sentences available to it — *"I wrote this"* or *"I failed"* — and a run that
read six settled weeks and could not read the open one has to pick one and lie
with it. Picking success hides a break; picking failure discards six weeks of
real settlement.

The runner has been taught to salvage those weeks (`shawarmania-sync`, *"A
rejected operation says what was rejected, and costs only its own cycle"*). It
now has figures to post and a reason it fell short, and no way to say both.

### A channel that stops running reads as its last success

`HealthLine` picks its word from `lastOutcome` alone. `ok` is `All quiet`, in
`text-content`, forever. Nothing on the surface consults the clock, so the only
difference between a channel that read successfully four minutes ago and one that
read successfully four days ago is the timestamp in the small grey line beneath —
which a reader has to convert, compare against a cadence, and disbelieve the
green word above.

Every failure mode that posts nothing at all lands here: a runner whose workflow
is disabled, a job that dies before it can report, a cold Ops Vault, a repository
whose Actions minutes ran out. **A dead channel and a healthy one are rendered
identically**, and the one signal that distinguishes them — the cadence the
runner reports with every run since #48 — is already on this surface and is used
only to grey out a button.

## What changes

1. `ingest-aggregator-cycle` ingests the cycles it was sent **and then** records
   the declared degradation, as one run, with the summary the writes actually
   produced. A declared failure with no cycles behaves exactly as it does today.
2. The owner's surface reads a channel that is past due as stopped, from the
   cadence the runner reports, and offers the read it is already able to offer.
3. `shawarmania-sync` posts its degradation with its cycles, so the Swiggy
   reader's partial run becomes one honest row instead of a success followed by a
   contradiction.

## What does not change

**No new outcome word, and no migration.** The five words in
`aggregator_sync_runs_outcome_known` already name every *reason* a run degrades;
what was missing was the ability to pair one with figures, which is a property of
the request, not of the vocabulary. See `design.md` D1.

**Nothing is derived that was recorded.** The summary still comes from inside the
write transaction. Staleness is the one thing genuinely not recordable by a run —
it is a statement about the run that did not happen — so it is computed at read
time from two recorded facts, and from nothing else.
