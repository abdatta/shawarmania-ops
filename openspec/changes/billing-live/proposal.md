# Proposal: Billing Live

> **Model**: Opus · **Wave**: D · **Depends on**: #7, #9, #30, #31, #32, #33 · **Gate**: **Billing V1.** The real menu is entered through the app by a person with no SQL; one tablet at each outlet takes real payments, immediate and on handover; every accepted write commits locally before the UI reports success and lands exactly once; unsent work survives logout and restart; bill numbers never collide; only a resolved online queue receives the tablet's end-of-day confirmation; and the ledger stops carrying that outlet's counter revenue on the day it goes live.

## Why

This is the integration and rollout change: the counter starts taking real money.
The tablet boundary, customer identity, transaction contract and the whole
lifecycle UI land first, so this stays a true adapter swap rather than a redesign
during rollout.

## What Changes

- **Make menu management real.** The manager's menu surface becomes a live editor
  for categories, items, prices and availability, and the owner enters both
  outlets' real menus through it. Nothing about billing can go live until a real
  menu exists, and the roadmap forbids it arriving by any route a franchisee could
  not repeat.
- Connect the counter, open orders, customer lookup, shift history, manager void,
  originating-tablet correction/discard and read-only manager-diagnostic adapters
  to the real contracts from #9, #32 and #33.
- Read the latest menu while reachable, and keep the active shift's menu snapshot
  so a transient failure does not interrupt an already-open counter.
- Commit every accepted counter command to IndexedDB before clearing its form,
  never await the network, preserve Pay now's six-second guaranteed Undo before
  that command becomes deliverable, and retry through one page leader with backoff.
- Preserve unsent work through the shift ending, restart, cutover and app update.
  A restart may drain old work, but starting or resuming billing requires online
  approval on the operator's phone.
- Show an offline banner, classify actual request results instead of trusting
  `navigator.onLine`, and stop new work at cutover.
- Treat an exact replay as success, reuse of a UUID with different content as a
  conflict, and a permanent refusal as needing attention with the approved
  correction or discard flow.
- Let the counter finish a business date only once its queue is resolved, end the
  shift, and write the end-of-day confirmation #12 consumes.
- Enforce exactly one active tablet at each outlet while keeping server numbering
  and idempotency concurrency-safe for #35.
- Promote billing, menu, history, customer and tablet surfaces from `demo` to
  `live`, one outlet at a time, while preserving the synthetic walkthrough.
- **Mark the handover in the manual ledger.** From the day an outlet goes live,
  that outlet's counter revenue comes from bills, and the ledger's revenue entry
  for it says so on screen rather than inviting the figure to be typed twice.
  Aggregator commission, cash in and out, and the counted drawer stay manual until
  #12 and #13.

## Capabilities

### New Capabilities

- `billing-delivery`: Local envelopes, retry ordering, exact replay, cutover
  behaviour, needs-attention handling, and end-of-day confirmation for the counter.
  **This is the only capability describing the durable queue.** #33 briefly carried
  a second one, `offline-operation-store`, which was deleted on 2026-08-09 rather
  than archived, because two capabilities describing one queue would have drifted
  and because #34 extends this one.

### Modified Capabilities

- `counter-billing`: Immediate payment and payment on handover operate on real
  data with durable local acknowledgement and one-tablet ownership.
- `menu-management`: The menu becomes a real editable record, and billing reads
  the latest live menu, falling back to the active shift's snapshot only after a
  real backend failure.
- `manual-ledger`: A live outlet's counter revenue is sourced from bills, and the
  ledger says so instead of accepting a second hand-typed figure.
- `demo-mode`: Promoted surfaces keep their coherent synthetic path.
- `app-shell`: Tablet, billing, history and menu gates reach their final live
  states without exposing personal navigation on the counter.

## Impact

Dexie dependency and schema, billing, menu, customer and history adapters, the
live menu editor, the feature registry, sync indicators, page lifecycle
coordination, end-of-day confirmation wiring, the manual ledger's revenue entry,
integration tests, transient-failure Playwright tests, and live gates change.

## Non-goals

- Several active tablets at one outlet; #35 adds them after V1.
- Deliberate offline restart and extended-outage operation; #34 adds them after V1.
- Redesigning #31, or weakening the #9, #32 and #33 contracts.
- Order transfer or any recovery path; a manager cancels a stranded order.
- Retiring the manual ledger, which #12 owns.
- Attendance from the tablet, emergency personal-device billing, manager-side
  re-ring or cross-device draft handoff, printing, GST, digital sharing,
  discounts, partial payments or split tender. V1 sends `discount_paise = 0` and
  exposes no discount control.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md` and
`docs/LIMITATIONS.md`.
