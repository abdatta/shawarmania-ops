# Offline And Sync

> Describes the design. Not built yet.

**The counter never stops.** A biller with a customer waiting cannot be blocked by a spinner, and a dropped connection must not cost the business a sale or a record of one. Everything on this page follows from that.

## What works offline

Deliberately asymmetric, because the risk is asymmetric.

| Works offline | Online only |
|---|---|
| Ring up and settle a bill | Inventory, expenses |
| Read the menu | Daily cash close |
| View this device's bills for today | Profit and loss, reports |
| Open and close a shift | All admin and owner screens |
| Attendance check-in from the counter tablet | Attendance from personal phones |

Manager and owner screens are used by people who can wait thirty seconds for a connection. Making them offline-capable would multiply conflict-resolution complexity for no operational gain — and every additional offline write path is another way for two devices to disagree about the truth.

Attendance from a personal phone stays online-only for a second reason: an offline check-in cannot be geofence-verified at the moment it happens, and a queued check-in that is validated later is a check-in that can be gamed.

## The outbox

Counter writes never go straight to the network. They go to a durable local queue.

```
  Biller settles a bill
          │
          ▼
  ┌───────────────────┐   client UUID assigned, totals computed locally,
  │  IndexedDB outbox │   business_date resolved from the outlet cutover
  │  (Dexie)          │
  └─────────┬─────────┘   screen clears immediately — nothing awaited
            │
     drain loop: online? → POST keyed by client UUID
            │
            ├─ 2xx ────────────► drop entry, store server bill_number
            ├─ 409 duplicate ──► drop entry (already landed — success)
            ├─ 4xx other ──────► quarantine, surface to the manager
            └─ network / 5xx ──► retry with backoff, entry stays queued
```

The queue survives page reload, app close, and device restart. It has to: the realistic failure is not a five-second blip, it is a tablet that has been offline all evening.

## Rules that make this safe

**Client-generated UUIDs.** Every counter record gets its ID on the device, before it is ever sent. The client can therefore reference its own rows immediately, and a retry carries the same identity as the original.

**Idempotency by primary key.** The server upserts on the client UUID. A retry that arrives twice inserts once. This is the whole duplicate-prevention story, and it is why the UUID must be generated at creation and never regenerated on retry.

**Bill numbers are assigned by the server, never the client.** Two offline tablets cannot safely agree on the next number in a sequence. Until a bill syncs, the UI shows a clearly provisional local reference; the real per-outlet number arrives with the server's response. Showing a fake number that later changes would be worse than showing an honest placeholder.

**Totals are computed on the device, in the domain layer, and stored.** The server does not recompute them. If the client's arithmetic and the server's ever disagreed, the biller's number — the one the customer actually paid — would be the one silently overwritten. Server-side validation checks internal consistency (`total = subtotal − discount + tax`) and rejects a malformed bill rather than repairing it.

**Business date is resolved on the device** from the outlet's cutover time, at the moment of settlement. Not at sync time — a bill rung at 00:20 and synced at 09:00 the next morning belongs to the night it was rung.

**Menu is cached and versioned.** The tablet keeps a local copy so billing works cold. Prices are snapshotted onto bill lines anyway, so an outdated cache produces an honest record of what was actually charged rather than a corrupt one. The staleness is visible in the UI, and a menu change is one of the things the drain loop refreshes first on reconnect.

## Conflicts

There are fewer than you would expect, by design.

**Bills do not conflict.** They are immutable inserts with globally unique client IDs. Two tablets at one outlet — an unusual but supported case — produce two disjoint sets of bills, and the server sequence keeps numbering coherent.

**Shifts can overlap** if a device was offline when another opened one. Both are recorded; the manager sees an overlap flag. The app does not silently pick a winner, because the correct resolution depends on what actually happened in the shop.

**The genuine hard case is a late bill against a closed day.** A tablet offline all evening syncs after the manager has already counted the drawer and closed the business date.

The rule: **a closed cash record is a snapshot and is never silently recomputed.** The late bill is stored with its true business date and raised as a **reconciliation exception** on that day's record — showing the manager what arrived, when, and how it changes the expected figure. They can reopen and re-close the day, or accept the discrepancy with a note. What the system must never do is quietly change a number a human already signed their name to.

## Failure modes worth designing for

| Situation | Behaviour |
|---|---|
| Offline all evening, 200 bills queued | All settle locally; drain on reconnect; progress is visible, not a frozen screen |
| Tablet dies with unsynced bills | **Data is lost.** IndexedDB is the only copy until sync. Mitigation: the pending count is always visible, and a persistent backlog is surfaced as a warning to the manager |
| Server rejects a bill as malformed | Quarantined, not silently dropped; surfaced to the manager with the reason |
| Clock skew on the tablet | Both client and server timestamps are stored. Material disagreement is a signal worth surfacing, not something to paper over |
| Two tablets at one outlet | Supported. Disjoint bill sets, server-assigned numbers, overlapping shifts flagged |
| Device revoked while holding a queue | Drain fails with an auth error and quarantines. Revoking a device with pending bills should warn the admin first |

The dead-tablet case is the one real hole, and it is stated plainly rather than hidden: an unsynced bill exists in exactly one place. Reducing that window — drain aggressively, warn loudly on a growing backlog — is the mitigation. Eliminating it would require a second local device, which is out of proportion to the risk at this scale.

## What the biller sees

Almost nothing, which is the point.

- A small persistent indicator: synced, or *N pending*.
- No spinner, no blocking dialog, no error toast on a failed sync — the queue handles it.
- One honest exception: if the backlog grows past a threshold or an entry has failed repeatedly, the indicator escalates to a visible warning, because at that point someone genuinely does need to know.
