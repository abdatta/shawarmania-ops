# Proposal: a-swiggy-week-with-no-orders-is-empty

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · corrects `aggregator-settlement-sync` · **Code**: `abdatta/shawarmania-sync` only, commit `1808a17` on branch `swiggy-empty-open-week`, fast-forwarded onto `main` 2026-10-15 · **Gate**: the first scheduled Swiggy read after the push, in a payout week with no Swiggy order, reads `ok`, and its log says `no orders yet this payout week`; `npm test` in the sync repository passes, and its two new tests fail with the reader change reverted.

## Why

Since 2026-10-11 every Swiggy read for Kalyani Cafe has ended `shape_changed` with *"getRestaurantPayoutDetailsV3 returned a current payout period with no usable dates"*. This keeps the Delivery badge lit, and `an-accepted-week-is-written` task 11 cannot read `ok`.

**Nothing changed shape.** Swiggy dates its current payout period by the orders in it. Until a payout week has its first order, it answers `week: { startDate: 0, endDate: 0 }`. The production record shows this:

- Every undated run from 2026-09-20 to 2026-10-15 (`aggregator_sync_runs`) falls in a gap that starts at the beginning of a payout week. Each gap ends on the run that first wrote an order dated inside that week (`aggregator_channel_days.created_at`). Examples: Sunday 20 Sep cleared at 19:50 IST, and the first 20 Sep day was written at 19:51. Sunday 27 Sep cleared at 15:42 and its day was written at 15:42. The 1 Oct short cycle cleared at 02:50 on 2 Oct, the same minute 1 Oct was written. Sunday 4 Oct had no order, so the gap ran on until 5 Oct 17:20, the moment 5 Oct was written.
- The current week began on Sunday 11 Oct. The Cafe's last Swiggy order was on 8 Oct (₹278). The reader's own daily telemetry shows net sales of 0 for every day from 9 to 15 Oct. With no order this week, the open period never got dates, so every run degraded.
- The record still carries `week` with `startDate,endDate`, which is the same key list as the 2026-09-01 diagnosis. The field names did not move.

So the sync is not failing here. It reports a shortfall for a week that has nothing in it to read. Until now this cost Sunday mornings. With the Cafe taking almost no Swiggy orders, it costs every run.

## What Changes

- **Sync reader (`shawarmania-sync`, `readPayouts`)**: an undated open period whose `orderCount` is exactly `0` is treated as an empty week. It is not degraded, no cycle is invented for it, and the run log says so. The settled weeks behind it read as before.
- An undated open period that states orders, or gives no count, **still degrades**. Orders that exist without a window are a real shortfall. The degraded reason now carries `orderCount` beside the key names. It is a count, so it carries nothing private, and it is what tells the two cases apart.
- `aggregator-settlement-sync` gains a requirement that names the line between an empty week and a short read.

Nothing in this repository's code, schema or functions changes. `ingest-aggregator-cycle` already records a run with no declared shortfall as `ok`, or as `reconciliation_failed` when a settled week does not reconcile, and that is what it will receive.

## Change gate

No gate: the change is in the sync repository, which the Change gates page does not reach. Nothing in the app, the database or the Edge Functions changes. Its scheduled readers run from that repository's `main`, so the push is the release, and reverting `1808a17` is the off switch.

## Rejected

- **Treating every undated open period as "not yet readable".** That is simpler, but it would hide the 2026-09-01 class of fault. If Swiggy ever moves the window to another field while the week holds orders, those orders would vanish from the run without a word. Swiggy's own order count is what separates the two cases.
- **Deriving the open window from the last settled cycle.** The 2026-09-01 repair refused this for good reason: it posts provisional figures against a period Swiggy never named.
- **Leaving it as a Swiggy-side question** (the earlier operational note). That was right for one Sunday morning. It is wrong for an outlet whose Swiggy week can stay empty from start to finish, because the owner's surface then reads `Stuck` for days about a healthy channel. That is the opposite of what the run history exists to say.

## Non-goals

- Why the Cafe takes so few Swiggy orders: five order days since 1 Oct, four of them ₹0 gross. That is a question for the owner about the listing, not for the reader.
- The `reconciliation_failed` runs on the morning of 14 Oct. These are a separate settled-week read, already covered by `an-accepted-week-is-written`.
- Confirming the actual `orderCount` value Swiggy sends in this state is **done**. A read-only rehearsal of the fixed reader against production Swiggy (sync run 38694683756, 2026-10-15 12:19 IST, `rehearse=true`, posted nothing) logged `cycle (open period) 1096540: no orders yet this payout week, nothing to read`, with the four settled cycles read as before. Swiggy states `orderCount: 0` for the undated week.
