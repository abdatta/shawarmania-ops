## Context

The database currently accepts `bills` and `bill_items` as separate writes and
models only `settled | void`. That cannot represent an order being cooked, and it
cannot guarantee that a numbered bill and every one of its lines commit together.
It also carries one business date, although the owner has chosen order date for
revenue and payment date for the drawer.

The counter's real workflow is narrow and was confirmed by the owner: an order is
recorded so the kitchen can cook it, and it is paid minutes later when the food
is handed over, to a walk-in customer or to an aggregator's rider. It is never a
tab that stays open for days. **This design is scoped to that and is deliberately
smaller than the original proposal**, which modelled deferred payment as a
first-class accounting event.

Launch runs one tablet per outlet, but the server contract stays safe under
concurrent requests so #35 is later a setup change, not a rewrite of money
history.

**The local operation store moved here from #9 on 2026-08-09.** #9 would have
built the queue before anything defined what it carries, against a payload shape
invented for the purpose. The envelope, the canonical hash and the idempotency
key below are that shape, so the queue belongs with them.

## Goals / Non-Goals

**Goals:**

- Separate editable unpaid orders from immutable paid bills.
- Make pay-now and pay-an-order atomic and exactly idempotent.
- Give the customer a number to be called by that is not a bill number.
- Preserve both clocks in storage without building exception machinery on them.
- Remove direct client writes from the money path.
- Give the tablet a durable local acknowledgement boundary, so money already
  taken cannot be lost to a request that never completed.

**Non-Goals:**

- Caching, prolonged offline trading, or gate promotion.
- Order transfer, privileged recovery, or a version-conflict contract.
- Partial, split or deposit payment, refunds, GST, printing or digital sharing.

## Decisions

### Unpaid work lives in orders; paid history lives in bills

`orders` carries a client UUID, outlet, owning tablet, creator, shift, ordered
time, explicit business date, status `open | paid | cancelled`, customer form
snapshot, integer totals, and attribution for change, cancellation and payment.
`order_items` keeps each line's captured name and price as the order is edited.
A paid or cancelled order is immutable.

Payment creates a `bills` row and its final `bill_items` snapshots, marks the
order paid and links it, all in one transaction. Pay-now creates the same bill
with no order row at all.

Making `bills` mutable while unpaid was rejected because it weakens an invariant
every historical bill already inherits.

### Two numbers, and they can never be confused

`orders.order_number` is a small integer, sequential per outlet **per business
day**, restarting each day. It is the number called out when the food is ready,
it exists from the moment the order is recorded, and it says nothing about money.

`bills.bill_number` is the existing permanent per-outlet sequence, allocated by
the landed database trigger only when a payment succeeds, never reused, and never
consumed by a failed command, an exact replay, or a cancelled order.

The two are formatted differently on every surface that shows them. A pay-now
sale has a bill number and no order number, which is correct: nobody waited for it.

### There is no order-events table

Attribution lives in columns on the order itself: who created it, who last
changed it and when, who cancelled it and why, who paid it. `bills` already
carries void attribution.

A separate event trail was in the original design and is cut. It earns its keep
for a record that lives for weeks and passes through several hands; it does not
for a slip of working state that exists for eleven minutes on one tablet. The
general `audit-log` todo remains the place this returns if a franchise dispute
ever needs it.

### One bill row carries both clocks, and nothing is built on the gap

Bills store `ordered_at` and `business_date` for revenue, and `paid_at` and
`payment_business_date` for the drawer. Pay-now writes near-identical clocks. A
paid order copies the order clock and resolves the payment date from `paid_at`
through the same outlet cutover function.

The columns are kept because the alternative is a migration against real money
later, and because an order taken at 03:55 and paid at 04:05 is a real event. The
**flags, late-accounting exceptions and reconciliation displays** the original
design specified are cut, because they existed to explain a payment days after
the sale, which this business does not do.

### All mutations are transactional RPC commands

Authenticated clients get read grants and no direct insert, update or delete on
orders, order lines, bills or bill lines. Security-invoker RPCs accept a
versioned envelope and execute exactly one command:

- create order
- revise open order
- cancel open order with a reason
- pay open order in full
- pay now
- void paid bill with a reason
- confirm the tablet's end of day

Parent, children, receipt, number allocation and state transition share one
transaction. Independent REST writes were rejected because a partial failure can
leave a numbered bill with no lines under it.

### Status at lock time replaces the version contract

A revise, pay or cancel command locks the order row and requires it to still be
`open`. If a manager cancelled it thirty seconds earlier, the pay command fails
with `order_not_open` and the counter is told what happened.

Optimistic version numbers were in the original design and are cut. They defended
against two writers editing one order, and with one tablet owning the order the
only second writer is a manager cancelling it, which the status check catches
exactly. The row lock stays; the user-facing conflict story goes.

### A manager cancels a stranded order; nothing recovers it

That outlet's FA, or an SA, can cancel any open order at that outlet with a
reason, from their own phone. This is an ordinary capability, not a break-glass
one, and it is the whole answer to an order left open on a tablet that has been
removed or has died.

Transfer to a replacement tablet and the privileged upload-only recovery path
were in the original design and are cut. They were built for orders worth
rescuing; a kitchen ticket is re-rung in ten seconds and the food is standing on
the counter either way.

### A command receipt provides exact idempotency

`billing_commands` stores command UUID, outlet, tablet, shift, type, schema
version, canonical payload hash, received time, result category, and the resulting
entity IDs and number for successful commands. The function claims the UUID
first. An exact replay returns the stored result without repeating effects or
consuming a number. A different hash, version or type for the same UUID returns
`identity_conflict`.

Treating every HTTP 409 as success was rejected because it hides UUID reuse
carrying different money.

### Every argument is transmitted explicitly

A command argument whose value is unknown is sent as an explicit null, never
omitted. `undefined-command-arguments-vanish-on-the-wire` records exactly this
failure reaching production in attendance on 2026-08-04: the key was dropped by
serialisation, the function matched nothing, the backend reported no such
command, and the person was invited to try again for a write that never happened
and never would. That failure mode is survivable for a check-in. It is not for
money. Command signatures therefore default every optional argument, and one test
fails if any command sends a payload missing a declared key.

### Arithmetic and snapshots are validated as one aggregate

Every line is integer paise and satisfies its line total. The database validates
that subtotal equals the sum of submitted lines and that total equals subtotal
minus discount plus tax. Menu references must belong to the outlet, and captured
price and name are never replaced with current menu values. Lines already on an
order keep their captured price across a menu change; a line added afterwards
uses the price shown when it was added.

### Day sign-off consumes a server-verifiable end-of-day confirmation

A tablet writes an **end-of-day confirmation** for its outlet and business date,
online, only after its shift has ended and it has nothing unsent for that date. It
carries the tablet's last acknowledged command watermark, and a later accepted
command for that tablet and date invalidates it. The server exposes one readiness
answer: every order for the date is paid or cancelled, no shift for the date is
live, and every tablet that worked the date has a current confirmation.

#12 must lock and recheck that answer inside the transaction that closes the day,
then refuse a new shift for the closed date. Reading open-order counts only in the
UI was rejected because a hand-crafted close would walk straight past it.

The original name for this was "device-day seal". It is renamed because #12 has to
tell the owner why a day will not close, and "the seal is stale" is not something
anybody can act on.

### Historical authorisation is evaluated against immutable shift facts

The server accepts a delayed command when its client creation time falls inside
the referenced shift and before the tablet was removed, even if the operator was
later deactivated or the cutoff has passed. Ordinary requests still require an
active tablet. Commands created outside the shift, unreasonably future-dated, or
naming another outlet are refused.

Rechecking only current assignment at sync was rejected because it would discard
honest work. Trusting any backdated client timestamp was rejected because it would
nullify tablet removal.

### IndexedDB is the local acknowledgement boundary

Dexie stores versioned immutable operation envelopes by client UUID, tablet,
shift, type, created time, payload version, and canonical payload hash — the same
five values the command receipt is keyed on, which is the whole reason this
section sits in this change rather than the previous one. The local transaction
must commit before a screen reports acceptance or clears input. If it fails, the
form stays exactly as it was.

The network response cannot be the acknowledgement boundary, because a payment
already taken could be lost during an outage. In-memory state was rejected
because the demo's synchronous behaviour does not survive process death.

Queue rows survive shift end, device session refresh, reload and browser restart.
Logging never includes payload contents, and never includes a customer's phone
number.

### One page drains, and the response says what happened

Web Locks elects a foreground drain leader, with a short IndexedDB lease fallback
where unavailable. `navigator.onLine` is only a wake-up hint; the response
categories defined above drive state. A removed tablet cannot drain or read.

Every refusal category the command surface defines maps onto exactly one queue
state, so there is no category a person could meet that the queue has no answer
for. An identity conflict in particular moves to needs-attention rather than
being reported as success, because "the same id already carried different
content" is not a delivery.

Service-worker Background Sync was rejected as a correctness dependency, because
availability differs by browser.

**Upload-only recovery from a removed tablet is cut.** It existed to rescue
unpaid orders stranded on dead hardware, and orders are short-lived kitchen
tickets that get re-rung rather than rescued. Removing a tablet with unsent paid
bills remains possible, and is recorded as a limitation with an operational
answer — remove the tablet only once its queue is clear, which the Tablets
surface shows — rather than a privileged upload path nobody will ever exercise.

## Risks / Trade-offs

- **Client clocks can be wrong** → retain received time, validate future skew, and
  never derive a business date at read time.
- **Command receipts grow indefinitely** → receipts are compact and carry no bill
  payload or phone number; retention stays a later policy decision.
- **Migration finds real bills despite an expected-empty production** → preflight
  and stop for explicit migration design rather than reshape history silently.
- **Daily order numbers collide across a cutover** → the number is allocated
  against the resolved business date, not the calendar date, in the same
  transaction as the order insert.
- **Cutting order events removes forensic detail** → attribution columns cover who
  did what; the `audit-log` todo is where this returns if a dispute ever needs more.
- **IndexedDB can be cleared or quota-exhausted** → fail before the UI reports
  success, request persistence best-effort, and surface storage failure rather
  than swallowing it.
- **A removed tablet still holds queued customer phone numbers** → origin-scoped
  storage, no payload logging, and the Tablets surface warns before removing a
  tablet that still reports unsent work.

## Migration Plan

1. Preflight production counts for bills, bill items and customers, and abort on
   unexpected money data.
2. Add orders, order items, command receipts, end-of-day confirmations, the new
   bill clocks and link, aggregate guards, RPCs, RLS and grants, while the old UI
   stays demo-gated.
3. Migrate synthetic fixtures and regenerate types.
4. Revoke direct client mutation on money tables and prove RPC-only operation.
5. Add the local operation store against the settled envelope, behind the same
   non-live gates.
6. Run the concurrency, idempotency and tenancy suites before #31 builds against
   the generated types.

Before live data, rollback drops the new empty contract and restores prior grants.
Once any real command exists, rollback is prohibited; use forward migrations.

## Open Questions

None.
