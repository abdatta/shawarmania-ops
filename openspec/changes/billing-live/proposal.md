# Proposal: Billing Live

> **Model**: Opus · **Wave**: D · **Depends on**: #7, #9, #30, #31, #32, #33, #36, #38 · **Gate**: **Billing V1.** The real menu is entered through the app by a person with no SQL; one tablet at each outlet takes real payments, immediate and on handover; the tablet can correct only a paid bill's Cash/UPI allocation for five minutes without rewriting the bill; every accepted write commits locally before the UI reports success and lands exactly once; unsent work survives logout and restart; bill numbers never collide; only a resolved online queue receives the tablet's end-of-day confirmation; and the ledger stops carrying that outlet's cash and UPI revenue on the day it goes live while keeping its typed aggregator figures.

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
- **Accept only Cash or UPI in live billing commands and for expenses.** Swiggy
  and Zomato are withdrawn as tender methods by owner decision on 2026-08-11, so
  an aggregator order is not rung at the counter and its revenue stays a typed
  ledger figure. Card and Other were never dormant options either: #31 removed
  them from the shared vocabulary and the database enum after proving production
  held no matching bills or expenses. This change narrows `payment_method` to
  `cash | upi` by the same audited migration pattern, so an aggregator bill is
  refused by the database and not merely absent from the tender dialog.
- Carry one or more exact `payments` allocations through IndexedDB and the
  command RPC; mixed bills remain one fully paid bill, and drawer close sums
  only their Cash allocations.
- Read the latest menu while reachable, and keep the active shift's menu snapshot
  so a transient failure does not interrupt an already-open counter. **Keep the
  counter fresh on two triggers, not one**: it re-reads the menu and the activity
  rail when the screen returns to the foreground, and again when the backend
  reports that outlet's menu or work changed. A tablet that resolved its menu once
  when the screen opened sells the morning's prices all evening, and because a line
  captures its price at the tap, that is wrong money rather than a stale display.
- Commit every accepted counter command to IndexedDB before clearing its form,
  never await the network, deliver payments without a five-minute hold, and retry
  through one page leader with backoff.
- **Replace the six-second direct-payment Undo with one five-minute tender-correction
  path for every paid bill.** Immediate payments and saved orders paid on handover
  appear in Bills this shift as soon as they are accepted locally. For five minutes
  from the original `paid_at`, the originating tablet may reopen the existing tender
  dialog, change only the exact Cash/UPI allocation, and keep the same bill and bill
  number. The action reads `Edit (N min)` and, below one minute, `Edit (N sec)`;
  it disappears at expiry. The database enforces the deadline. The bill, original
  allocation and every correction remain immutable records, while drawer, shift,
  ledger and reporting reads use the latest accepted allocation.
- Open a new payment dialog with neither Cash nor UPI styled as already selected.
  Cash remains identifiable without colour alone, but the current two-method layout
  and its unused space are unchanged in this change.
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
  that outlet's cash and UPI revenue comes from bills, and the ledger's entry for
  each says so on screen rather than inviting the figure to be typed twice.
  Zomato and Swiggy revenue stays typed at every outlet on every date, because
  there are no aggregator bills to read it from. Aggregator commission, cash in
  and out, and the counted drawer stay manual until #12 and #13.
- **Let the Tablets surface say what the counter is doing, not only that the
  tablet is switched on.** Each card gains the live shift, the person holding it,
  and — on a live outlet's current business date — that shift's bills, effective
  Cash and UPI, open orders waiting and drawer cash, every figure taken through
  the same effective-allocation boundary the drawer reads. It states when it was
  read, re-reads when opened and on request, and subscribes to nothing. **Added
  2026-08-12** from the owner's Kalyani session, where the answer to "how is the
  counter doing" turned out to be a last-seen timestamp. Opening the biller's own
  screen, and practising on a copy of it, is #39 and stays out of this change.

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
  data with durable local acknowledgement, one-tablet ownership and the same
  five-minute tender-only correction path.
- `billing-command-contract`: A payment correction becomes an atomic, replay-safe,
  historically validated command that appends an attributed adjustment without
  mutating the paid bill or its original allocations.
- `menu-management`: The menu becomes a real editable record, and billing reads
  the latest live menu, falling back to the active shift's snapshot only after a
  real backend failure.
- `manual-ledger`: A live outlet's cash and UPI revenue is sourced from bills, and
  the ledger says so instead of accepting a second hand-typed figure, while its
  aggregator revenue and rates stay hand-entered.
- `daily-cash-reconciliation`: Cash receipts and expected drawer figures use each
  bill's latest accepted effective allocation, never the superseded original
  tender or more than one revision.
- `counter-device-sessions`: Tablet management reports the counter rather than
  only the hardware — the live shift, its operator and that shift's effective
  figures, scoped by the reader's own outlets, stated as of one reading and
  re-read on request rather than subscribed to.
- `demo-mode`: Promoted surfaces keep their coherent synthetic path.
- `app-shell`: Tablet, billing, history and menu gates reach their final live
  states without exposing personal navigation on the counter.

## Impact

Dexie dependency and schema, billing, menu, customer and history adapters, the
live menu editor, the feature registry, sync indicators, page lifecycle
coordination, end-of-day confirmation wiring, the manual ledger's revenue entry,
integration tests, transient-failure Playwright tests, and live gates change. One
migration narrows `public.payment_method` to `cash | upi`, which touches the
shared billing vocabulary, the tender dialog, shift summaries, the expense form,
the generated database types and the `expenses_insert` policy. A further migration
adds outlet-scoped append-only payment-correction and allocation records, their RLS
and command RPC, plus one effective-allocation read boundary used by every total.

## Non-goals

- Several active tablets at one outlet; #35 adds them after V1.
- Deliberate offline restart and extended-outage operation; #34 adds them after V1.
- Redesigning #31, or weakening the #9, #32 and #33 contracts.
- Order transfer or any recovery path; a manager cancels a stranded order.
- Retiring the manual ledger, which #12 owns.
- Aggregator billing of any kind. Swiggy and Zomato orders are not rung, settled
  or reconciled at the counter in V1, and integrating them stays a later change.
- Attendance from the tablet, emergency personal-device billing, manager-side
  re-ring or cross-device draft handoff, printing, GST, digital sharing,
  discounts, deposits or partially paid orders. V1 sends `discount_paise = 0` and
  exposes no discount control.
- Editing paid item lines, quantities, customer facts, totals, payment time or
  business dates. After five minutes, the existing manager void and manual re-ring
  path is the only correction.
- Rearranging the payment dialog or filling the space left when aggregator tender
  buttons were removed. This change only removes Cash's false default-selection
  treatment.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`,
`docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`
and `docs/LIMITATIONS.md`.
