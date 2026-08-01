## Context

The database currently accepts `bills` and `bill_items` as separate writes and
models only `settled | void`. That cannot represent mutable unpaid orders or
guarantee that a numbered bill and every line commit together. It also has one
business date, although the owner has chosen original order date for revenue and
actual payment date for the drawer.

Launch enrolls one active device per outlet, but the server contract must remain
safe under concurrent requests so later multi-device support is an enrollment/UI
change rather than a rewrite of money history.

## Goals / Non-Goals

**Goals:**

- Separate mutable unpaid orders from immutable paid bills.
- Make direct payment and deferred payment atomic and exactly idempotent.
- Preserve original revenue date and actual payment/drawer date.
- Enforce device ownership, optimistic versions, historical grants, and audited recovery.
- Remove direct client DML from the money path.

**Non-Goals:**

- Queue draining, cache behavior, or live gate promotion.
- Multiple active devices at an outlet or ordinary cross-device editing.
- Partial/split/deposit payment, refunds, GST, printing, or digital sharing.

## Decisions

### Unpaid work lives in orders; paid history lives in bills

Add `orders` and `order_items`. Orders carry client UUID, outlet, originating
device, creator/grant, `ordered_at`, explicit `business_date`, status
`open | paid | cancelled`, optimistic `version`, customer/form snapshots, integer
totals, and update/cancel/recovery attribution. Lines retain their captured name
and price as the order changes. Paid/cancelled orders are immutable except for
non-business delivery metadata.

Payment creates a `bills` row and final `bill_items` snapshots, then marks the
order paid and links it, all in one transaction. Direct pay creates the same bill
without an order row. Expanding bills to be mutable while unpaid was rejected
because it weakens the simple invariant every historical bill already inherits.

### One bill row carries both sale and payment clocks

Bills store `ordered_at`/`business_date` for revenue and `paid_at`/
`payment_business_date` for payment and drawer accounting. Direct pay has equal
or near-equal clocks. Deferred payment copies the order clock/date and resolves
the payment date from `paid_at` using the same outlet cutover function.

A separate payments table was rejected for launch because payment is all-or-
nothing through one method; it adds joins without representing another business
fact. It can be introduced if split/partial/refund behavior is later approved.

### All mutations are versioned transactional RPC commands

Authenticated clients receive read grants but no direct insert/update/delete on
orders, lines, bills, or bill lines. Security-invoker RPCs (with narrowly scoped
definer helpers only where machine/human dual proof requires it) accept a
versioned JSON envelope and execute one command:

- create order;
- revise open order with expected version;
- cancel open order with reason;
- pay open order in full;
- pay now;
- void paid bill with reason;
- transfer/cancel an order from a revoked device under FA/SA recovery.

Parent, children, command receipt, number allocation, and state transition share
one database transaction. Independent REST writes were rejected because partial
failure can leave a numbered bill without its lines.

### A command receipt provides exact idempotency

`billing_commands` stores command UUID, outlet, device, grant, type, schema
version, canonical payload hash, received time, result category, and resulting
entity IDs/number for successful commands. The function first claims the UUID.
An exact replay returns the stored result without repeating effects or consuming
a number. A different hash/version/type for the UUID returns `idempotency_conflict`.

Treating every HTTP 409 as success was rejected because it can hide UUID reuse
with different money. Using only the bill primary key was rejected because edits,
cancel, transfer, and deferred payment are also retried commands.

### Bill numbers remain database-triggered and gapless on successful payment

The existing per-outlet counter/trigger remains inside the paid-bill insertion
transaction. Orders consume no official number. Failed commands and exact replay
consume none. This remains safe under concurrent requests even while enrollment
temporarily permits one device.

An Edge Function allocator was rejected because an extra network boundary cannot
be atomic with bill insertion and is already superseded by the landed trigger.

### Order versions and ownership are database-enforced

Normal revise/pay/cancel commands require machine device ID equal to the order's
current owner and expected version equal to the locked row. Each accepted edit
increments the version. Any eligible person holding the current daily grant on
that device may act; creator and each acting operator remain distinct facts.

FA/SA recovery first requires the source device to be revoked, a reason, and an
active replacement device at the same outlet. Transfer changes owner, increments
version, and appends an `order_events` audit row. General cross-device editing was
rejected for launch.

### Order events are the scoped audit trail

`order_events` records create, revise, cancel, pay, transfer, and recovery cancel
with order/outlet, before/after version, actor, device, grant, time, reason where
required, and command UUID. It does not duplicate customer phone or full payload.
This satisfies billing accountability without promoting the general audit-log todo.

### Day sign-off consumes a server-verifiable settlement gate

Add an outlet/device/business-date seal recording that the device has ended its
grant and, at that moment, has no pending, blocked, or quarantined local command
for the date. The seal is written online through a typed command and carries the
device's last acknowledged command watermark. A later accepted command for that
device/date invalidates the seal. The server exposes one readiness result: every
order for the date is paid or cancelled, no grant for the date remains live, and
every device that held a grant or command for it has a current valid seal.

The daily-cash sign-off in #12 must lock and recheck that result in the same
transaction that closes the day, then prevent a new grant for that closed date.
Reading open-order counts only in the UI was rejected because a hand-crafted close
could bypass it. Treating a stale “queue empty” heartbeat as a seal was rejected
because the device could accept more work afterwards without invalidating it.

### Historical authorization is evaluated against immutable grant facts

The server accepts a delayed command when its client creation time lies within
the referenced grant and before device revocation, even if the operator was later
demoted/deactivated or cutoff passed. Ordinary current requests still require an
active device; pre-revocation recovery requires authenticated FA/SA. Commands
created outside the grant, unreasonably future-dated, or against another outlet
are refused. Accepted late/recovery results carry explicit flags.

Rechecking only current assignment at sync was rejected because it would discard
honest offline work. Trusting any backdated client timestamp was rejected because
it would nullify revocation; grant bounds plus recovery authentication narrow it.

### Arithmetic and snapshots are validated as one aggregate

Every line uses integer paise and satisfies line total. The database validates
bill/order subtotal equals the sum of submitted lines and total equals subtotal
minus discount plus tax. Menu references must belong to the outlet but historical
snapshot price/name are never replaced with current menu values. Existing order
lines keep their captured price across later menu changes; newly added lines use
the price presented when added.

## Risks / Trade-offs

- **Late payment changes an earlier revenue day** → record both dates, flag late
  accounting, and make #12/#13 display exceptions rather than rewriting a closed drawer.
- **Client clocks can be wrong** → retain received time, validate future skew,
  surface material skew, and never derive business dates later.
- **Command receipt grows indefinitely** → receipts are compact and contain no
  bill payload/phone; retention remains a later policy decision.
- **Migration encounters real bills despite expected empty production** → preflight
  and stop for explicit migration design rather than reshape history silently.
- **Recovery authority is powerful** → require revoked source, same outlet,
  reason, FA/SA token re-derivation, and immutable event attribution.

## Migration Plan

1. Preflight production counts for bills/items/customers and abort unexpected money data.
2. Add orders, order items, order events, command receipts, device-day seals, new bill clocks/links,
   aggregate guards, RPCs, RLS, and grants while old UI remains demo-gated.
3. Migrate synthetic fixtures and regenerate types.
4. Revoke direct client money-table mutations and prove RPC-only operation.
5. Run concurrency/idempotency/tenancy suites before #31 builds against the types.

Before live data, rollback drops the new empty contract and restores prior grants.
After any real command exists, rollback is prohibited; use forward migrations.

## Open Questions

None.
