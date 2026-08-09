# Proposal: Billing Transaction Contract

> **Model**: Opus · **Wave**: D · **Depends on**: #9, #32 · **Gate**: an order can be taken, prepared and paid, or paid outright, and both produce the same immutable bill; an order carries a daily order number and a bill carries a permanent bill number; a retry lands the money once; a bill and every line commit together or not at all; a command accepted on the tablet survives logout and restart without duplicating or vanishing; and an unpaid order or an unconfirmed tablet blocks the day from being signed off, refused by the database rather than by a screen.

## Why

The current schema treats every counter action as an already-settled bill. It
cannot represent an order that is being cooked, it cannot guarantee a bill and
its lines commit together, and it has no answer for the same write arriving
twice. These are the invariants every later billing change inherits, so they are
fixed before any real money is written.

## What the counter actually does

A customer gives an order. It is recorded so the kitchen knows what to make and
the counter knows what is owed. Minutes later the food is handed over and paid
for, and the order becomes a bill. A Swiggy or Zomato order behaves the same way,
with the rider as the person who collects it. Sometimes nobody records the order
at all and the whole thing is rung and paid in one go.

That is the entire lifecycle. **An order is short-lived working state, not a tab.**
This proposal is scoped to exactly that and no further.

## What Changes

- Introduce `orders` and `order_items`: unpaid, editable, owned by the tablet that
  created them, carrying a client UUID, an explicit business date, integer-paise
  totals, line snapshots, and attribution for who created, changed, cancelled or
  paid them.
- Give each order a **daily order number**, sequential per outlet and reset each
  business day, which is the number the customer is called by. It is never a bill
  number and consumes none.
- Support an atomic pay-now command and an atomic order-to-paid-bill command that
  both produce the identical bill shape.
- Assign the permanent per-outlet bill number only when payment succeeds, and keep
  paid bills immutable except for the attributed void transition.
- Store order time and business date separately from payment time and business
  date. Revenue uses the first, the drawer uses the second.
- Replace independent client inserts with versioned transactional RPC commands
  that atomically validate parent, lines, snapshots and integer-paise totals.
- Distinguish an exact replay from reuse of the same UUID with different content.
- Let that outlet's FA or an SA cancel any open order with a reason, which is how
  an order stranded on a removed tablet is resolved.
- Expose a database-verifiable readiness answer for a business date: no open
  orders, no live shift, and a current end-of-day confirmation from every tablet
  that worked the date.
- Require every command argument to be transmitted explicitly, so a value nobody
  supplied cannot be dropped in transit and leave the command unmatched.
- Establish the versioned IndexedDB operation store that carries those commands:
  it commits locally before a screen reports success, survives logout, cutover and
  browser restart, elects one page to drain, retries transient failures, and keeps
  refused entries for a human rather than discarding them.

## Capabilities

### New Capabilities

- `order-lifecycle`: Editable unpaid orders, tablet ownership, daily order
  numbers, cancellation, and conversion to a paid bill.
- `billing-command-contract`: Versioned atomic commands, exact idempotency,
  historical authorisation, refusal categories, and replay responses.
- `offline-operation-store`: Durable device-scoped operation storage, queue
  states, local acknowledgement, leader election, and lifecycle persistence.
  **Moved here from #9 on 2026-08-09**, because the queue's envelope, its
  canonical hash and its idempotency key are the same design as the command
  contract, and building it before the contract existed meant building it against
  a made-up payload shape.

### Modified Capabilities

- `counter-billing`: Paid bills are created by a successful payment command,
  carry final snapshots, and stay append-only. Direct pay-now remains supported.
- `daily-cash-reconciliation`: Revenue uses the order business date while cash
  uses the payment business date.
- `outlet-tenancy`: Order, payment and command paths stay outlet-isolated and
  tablet-scoped at the database boundary.

## Impact

Billing migrations, tables, triggers and RPCs, end-of-day confirmations,
generated types, RLS and grants, domain arithmetic, Supabase command adapters,
IndexedDB infrastructure, tablet telemetry, seeds, and DB, RLS and browser tests
change. Production billing tables are expected to be
empty; the migration refuses to proceed if they are not.

## Non-goals

- Deliberate offline restart or prolonged offline trading. Roadmap change #34
  adds that after Billing V1; what lands here is the durable acknowledgement
  boundary, not offline operation as a mode.
- Gate promotion. #10 makes billing live.
- Several active tablets at one outlet, or ordinary cross-tablet order editing.
- **Order transfer between tablets, and any privileged recovery path.** Cut
  deliberately: an order is short-lived working state, and a manager cancelling it
  with a reason is the whole answer.
- **A user-facing version-conflict contract.** Cut deliberately: the pay command
  requires the order to still be open when it locks the row, which is the only
  race that exists once one tablet owns the order.
- **Late-payment accounting machinery.** Both clocks are stored, but the flags,
  exception surfaces and reconciliation displays for payment days after the order
  day are cut, because minutes separate the two.
- Partial, split or deposit payments; hard deletion of orders; editing paid bills.
- Printing, GST, digital sharing, refunds, or emergency personal-device billing.

## Docs to update before archive

`docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/BUSINESS_CONTEXT.md`,
`docs/OFFLINE_AND_SYNC.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/GLOSSARY.md`
and `docs/LIMITATIONS.md`.
