# Proposal: Billing Live

> **Model**: Opus · **Wave**: D · **Depends on**: #7, #9, #30, #31, #32, #33 · **Gate**: one registered device at each outlet takes immediate and deferred payments; every accepted write commits locally before UI success and lands exactly once; pending writes survive logout/restart; official numbers do not collide; history and recovery reconcile; only a resolved online queue receives the device-day seal; gates promote `demo → live`.

## Why

This final integration lets both counters take real money. The UI, device/session
boundary, customer identity, and transaction contract land first so this remains
a true `*-live` adapter swap rather than a redesign during rollout.

## What Changes

- Connect counter, open-order, customer lookup, history, void, correction,
  device recovery, and manager recovery adapters to real contracts.
- Read the latest menu while reachable and retain the active session's menu
  snapshot so a transient request failure does not interrupt an already-open counter.
- Commit every accepted counter command to IndexedDB before clearing its form,
  never await the network, and retry through one page leader with backoff.
- Preserve pending operations through logout, restart, cutoff, and app updates;
  a restart may drain old work but starting or resuming billing requires online sign-in.
- Show an offline banner, classify actual request results instead of trusting
  `navigator.onLine`, and stop new work at cutoff until online authentication succeeds.
- Treat exact replay as success, UUID reuse with different content as conflict,
  and permanent rejection as quarantine with the approved correction/discard flow.
- Sync valid pre-cutoff commands later and recover valid pre-revocation writes
  through the authenticated upload-only path, with admin-visible flags.
- Let the counter finish a business date only after its queue is resolved, end
  the grant, and write the current device-day seal consumed by #12 sign-off.
- Enforce exactly one active registered billing device at each outlet while
  retaining concurrency-safe server numbering/idempotency for later expansion.
- Promote billing, menu, history, customer, and device surfaces from `demo` to
  `live` while preserving the synthetic demo walkthrough.

## Capabilities

### New Capabilities

- `billing-delivery`: Billing-specific local envelopes, retry ordering, exact
  replay, cutoff behavior, quarantine, and recovery for transient failures.

### Modified Capabilities

- `counter-billing`: Immediate/deferred payment operates on real data with
  durable local acknowledgement and one-device ownership.
- `menu-management`: Billing reads the latest live menu and uses the active
  session snapshot only after real backend failure.
- `demo-mode`: Promoted surfaces retain their coherent synthetic adapter path.
- `app-shell`: Device, billing, history, and recovery gates reach final live
  states without exposing personal-role navigation on the counter.

## Impact

Dexie dependency/schema, billing/menu/customer/history adapters, feature
registry, sync indicators, recovery wiring, page lifecycle coordination,
device-day finish/seal wiring, integration tests, transient-failure Playwright
tests, and live gates change.

## Non-goals

- Multiple active devices at one outlet; roadmap change #35 adds them after V1.
- Deliberate offline restart and extended-outage operation; roadmap change #34 adds them after V1.
- Redesigning #31 or weakening #9/#32/#33 contracts.
- Attendance, emergency personal-device billing, printing, GST, digital sharing,
  partial payments, or split tender.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, and
`docs/LIMITATIONS.md`.
