# Proposal: Billing Transaction Contract

> **Model**: Fable · **Wave**: D · **Depends on**: #9, #32 · **Gate**: direct and deferred payment produce the same immutable bill contract; orders are device-owned and versioned; revenue and drawer dates remain distinct; retries are exact and bill plus lines commit atomically under concurrent requests; open orders or unresolved device days remain database-visible sign-off blockers.

## Why

The current schema treats every counter action as an already-settled bill and
cannot safely represent unpaid orders, later payment, atomic bill lines, or
device ownership. These invariants must be fixed before real money is written.

## What Changes

- Introduce mutable unpaid orders with client UUIDs, originating-device ownership,
  optimistic versions, cancellation attribution, and audited FA/SA recovery transfer.
- Support an atomic pay-now command and an atomic order-to-paid-bill command.
- Assign a per-outlet bill number only when payment succeeds; keep paid bills
  immutable except for the attributed void transition.
- Store order creation time/business date separately from payment time/business
  date. Revenue uses the former; drawer reconciliation uses the latter.
- Record order creator and payment operator/device independently when needed.
- Replace independent client inserts with versioned transactional RPC commands
  that atomically validate parents, lines, snapshots, and integer-paise totals.
- Distinguish exact replay from UUID reuse with different content and keep the
  server contract concurrency-safe even though launch enrolls one device per outlet.
- Preserve invalid attempts for correction/discard with attribution; replacements
  receive new UUIDs linked to their originals.
- Expose database-verifiable business-day settlement readiness: no open orders,
  no live grant, and a current queue-empty seal from every device that worked the day.

## Capabilities

### New Capabilities

- `order-lifecycle`: Mutable unpaid orders, device ownership, cancellation,
  payment conversion, recovery transfer, and concurrency rules.
- `billing-command-contract`: Versioned atomic commands, exact idempotency,
  historical authorization, rejection categories, and replay responses.

### Modified Capabilities

- `counter-billing`: Paid bills are created by successful payment, carry final
  snapshots, and remain append-only; direct paid billing remains supported.
- `daily-cash-reconciliation`: Revenue uses order business date while cash uses
  payment business date, including payment after a cutover or close.
- `outlet-tenancy`: New order, payment, command, and recovery paths remain
  outlet-isolated and device-scoped at the database boundary.

## Impact

Billing migrations, tables/triggers/RPCs, device-day seals, generated types, RLS/grants, domain
arithmetic, Supabase command adapters, seeds, and DB/RLS tests change. Existing
production billing data is expected to be empty; migration checks must refuse
unsafe assumptions if it is not.

## Non-goals

- Offline drain orchestration or live gate promotion.
- Several active billing devices at one outlet or ordinary cross-device order editing.
- Partial, split, or deposit payments.
- Hard deletion of orders or editing paid bills.
- Printing, GST, digital sharing, refunds, or emergency personal-device billing.

## Docs to update before archive

`docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/BUSINESS_CONTEXT.md`,
`docs/OFFLINE_AND_SYNC.md`, `docs/SECURITY_AND_PRIVACY.md`, and
`docs/LIMITATIONS.md`.
