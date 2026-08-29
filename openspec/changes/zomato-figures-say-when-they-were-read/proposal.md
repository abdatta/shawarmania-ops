# Proposal: Zomato Figures Say When They Were Read

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · **Gate**:
> a measured Zomato or Swiggy figure on the ledger day view carries the moment
> its source was current — "As of Today, 11:23 pm" — and the month view carries
> one such stamp per channel rather than one per day, so a reading taken last
> night can no longer pass for a live value.

## Why

`aggregator-figures` already requires it: *"**WHEN** a reader opens a
provisional Swiggy figure captured partway through today **THEN** it names the
daily-reader origin, its capture/as-of time and its provisional state."* The
origin is named. The as-of time is not, on any screen.

`aggregator_channel_days.as_of_at` is written by every ingest, is already
fetched by the day read's `select('*')`, and is dropped on the floor by
`toZomatoSettlement`, which maps eleven other columns off the same row. So a day
read at 11 pm and superseded by the 4 am run looks identical to a day read a
minute ago, and whoever opens the ledger at noon cannot tell which they are
looking at.

## What Changes

- `toZomatoSettlement` carries `as_of_at` onto `ZomatoSettlement` as `asOfAt`.
  One mapper serves both the mock and the Supabase adapter, so both sides of the
  demo seam gain it together and cannot disagree.
- The day view prints it beneath each channel's reading block, through the
  existing `formatDayTime` helper that already renders `Today, 11:23 pm` /
  `Yesterday, 11:23 pm` / a full date in Asia/Kolkata. No new formatter.
- The month view prints one stamp **per channel**, beneath that channel's rows.

**Why per channel rather than one stamp for the month.** The instruction was one
stamp rather than forty, and forty was the thing to avoid: a run re-reads a
trailing window of days at once, so per-cell stamps would be forty repetitions
of two facts. But Zomato and Swiggy have independent sessions and independent
repair paths — the reason `aggregator-channel-sessions` carries a whole ladder
for one without the other. A single stamp taking the latest across both would
let a Zomato read from an hour ago vouch for a Swiggy session that lapsed four
days back, which is the exact class of lie this fix removes. Two stamps is still
not forty.

**The stamp means last confirmed, not last moved.** A 4 am run that re-read the
day and found it unchanged still refreshes it, because "checked again at 4 am
and it held" is the reassurance the stamp exists to give. Where a figure did
move, the movement is already told by the revised from → to beside it.

## Non-goals

- **No migration.** `as_of_at` exists and is populated.
- **No new formatter.** `formatDayTime` in `src/domain/datetime.ts` already
  renders exactly these words.
- **No stamp on a day with no measured figure.** Nothing was read, so there is
  no moment to name.
- **No backfill and no handling of a null `as_of_at`** beyond omitting the
  stamp. Rows written before sources were named carry null honestly.
- **No change to any figure, total, or authority rule.**
