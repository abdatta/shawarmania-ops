# Design: The Counter Shows What It Saved

## Context

Every counter write is local-first. `saveOrder`, `reviseOrder`, `settleBill`,
`payOrder`, `markOrderLinesPrepared`, `correctBillPayment`, `unpayOrder` and
`cancelPaidOrder` in `src/data-access/supabase-adapters/billing.ts` each accept a
command into the IndexedDB outbox, update the adapter's in-memory caches
(`orderCache`, `localBillCache`) and return. None of them waits on the network.

**The screens wait anyway.** What each surface does after a save, with
`dish-ticks` on, as of `main` on 2026-10-14:

- **Order** (`saveOrder` in `billing-counter.tsx`) discards the `BillingOrder`
  the adapter returned, clears the composer and bumps `pipelineRefresh`. The rail
  (`DishOpenOrdersSurface`) re-reads through `listOpenOrders` → `readOrders`, which
  reads the envelopes, then the `orders` select, then the
  `billing_event_device_labels` RPC (sequential), and only then lays the envelopes
  over the rows. The read goes through `useRefreshQueue`, so it can also wait for
  a read already in flight to finish first.
- **Save changes** (`reviseEditedOrder`): the same. In the two-column rail the
  order under edit stays listed, so its card shows its *old* dishes until the read
  lands.
- **Pay now** (`settle`) bumps `billRefresh`, lifted through `CounterShell` to
  `CounterRecords` → `MyShiftSurface` (records mode, also a refresh queue), which
  reads `listShiftHistory`: the `bills` select, then `effective_bill_payments` and
  the device labels.
- **A rail card's Paid** goes through the rail's `act`, which already draws the
  paid card at once; its `onActivityChanged` bumps `billRefresh`, so the bill waits
  for the same re-read.
- **Bills' Edit payment, Take back, Cancel after paid** (`resolve` and the
  payment dialog's `.then` in `my-shift-surface.tsx`) `await load()` after the
  write. In records mode `CounterRecords` passes no `onActivityChanged`, so the rail
  learns of a take-back only from the server's change notice after delivery. A
  failed re-read lands in the action's `catch` and shows the action's failure
  words.
- **Table picker** (`openTables`) opens at once on the last `tableOrders` it
  had (empty on first open) and replaces it with a fresh `listOpenOrders`.

The rail's own `act` and `tickLine` are the precedent: draw the adapter's returned
order, `queue.invalidate()`, then re-read in the background. #74 also taught the
adapter that a read begun before a write must not put older rows back over it:
`wroteLocally` and `newer()` in `readOrders` keep, and if necessary add, the
locally written order.

The Supabase client sets no request timeout. Every fallback the counter has
(`readOrders` serving `orderCache` on error, `listShiftHistory` serving the resume
record) runs when a request **fails**, never while it is merely slow. So the
counter copes with a dead connection and struggles on a weak one.

## Goals

- A save is on screen in the same frame the composer clears, from what the tablet
  holds, on any connection.
- The server's answer, when it comes, replaces what was drawn, as now.
- No new requests, no new command, no change to the outbox.
- Off is today, untouched.

## Decisions

### D1. Two reads that never touch the network

The `BillingAdapter` interface gains:

```ts
/** The pipeline as this tablet holds it now, with no request. Null before the
 *  first read of this outlet on this page has given it anything to hold. */
peekOpenOrders(outletId: string): Promise<BillingOrder[] | null>
/** This shift's bills as this tablet holds them now, with no request. Null
 *  when it holds none: no server read of this shift yet and no resume record. */
peekShiftHistory(shiftId: string): Promise<ShiftBillingHistory | null>
```

**`peekOpenOrders` is the half of `readOrders` that does not ask the server.**
`readOrders` already has a branch that serves the tablet's own rows: when the
server read fails it takes `orderCache` for the outlet in place of the response,
then projects the envelopes over it and keeps the newer locally written orders.
`peekOpenOrders` runs exactly that, without asking first. Factor the local half
out of `readOrders` so both paths call one function and cannot drift. It reads
the envelopes (IndexedDB, milliseconds) and no table.

It returns `null` until a `readOrders` of that outlet has completed on this page
(success or the cache fallback), or the cache was seeded from a resume record. A
fresh page that has read nothing has nothing to draw, and drawing a lone new
order over the rail's shimmer would look like the rail had emptied.

**`peekShiftHistory` is `listShiftHistory` with the last server answer in place of
a new one.** `listShiftHistory` keeps the server bills it last read for each
shift in a new in-memory map. The peek takes those (or the resume record's bills
when the page cold-started offline), runs `overlayDurableBills` over them with the
shift's envelopes, and computes the totals with the same code. Factor the totals
into one helper so both paths compute them identically. `null` when there is
nothing to start from.

The demo adapter implements both by returning what `listOpenOrders` and
`listShiftHistory` return. It never touches a network, so its lists are already
the tablet's own record, and the demo behaves the same with the gate on or off.

### D2. Draw the real card, not a placeholder

The owner's first idea (2026-10-14) was a shimmer or a partly filled card, held
disabled until the database confirms the order. **Rejected.** Offline, that
confirmation may not come for an hour, and the counter must keep working: the
order's dishes are ticked, it is paid, edited or cancelled, all as queued
commands over the same local record. A card held disabled until the server
answers would make offline billing worse than it is today, when the order's card
is already fully usable once the rail has read. The card is drawn exactly as the
projection draws a queued order today, with the number's awaiting shape
(`AWAITING_ORDER_NUMBER`, and *Unsent work shows the shape of its number* in the
spec). Nothing on the card says *saving* or *unsent*: the sync indicator says
that once, for everything.

### D3. A save tells the surfaces directly, apart from refreshes

Today one signal means two things. `pipelineRefresh` and `billRefresh` are bumped
by this tablet's own saves and by everything else: the outlet's change notice,
the return to the foreground, the menu refresh. With the gate on, those become
two signals:

- **A refresh** (change notice, foreground): unchanged. Queue a server read.
- **An own save** (a new `ownSave` key per surface): invalidate any read in
  flight (D4), draw the peek, then queue the one server read the save would have
  caused anyway.

So the number of server reads per save is unchanged, and the request budget does
not move. The composer's saves, the rail's actions and the Bills panel's actions
bump the own-save keys in place of the refresh keys they bump today:

| Save | Rail | Bills |
|---|---|---|
| Order, Save changes | own save | — |
| Pay now | — | own save |
| Rail card: tick, Paid, cancel, take back | (already instant, via `act`) | own save |
| Bills: Edit payment, Take back, Cancel after paid | own save | own save |

`savedOrderKey`, which returns the rail to its newest end, is unchanged.

**The Bills panel gains a way to tell the rail.** In records mode it has none
today. `CounterShell` already lifts `billRefresh` from `BillingCounter` to
`CounterRecords`; it gains the reverse: `CounterRecords` → shell →
`BillingCounter` → rail, for the Bills panel's own saves.

**Rejected: draw the peek on every refresh, change notices included.** A peek on
a change notice is harmless to draw, but it must invalidate the read in flight or
a slower, older answer draws over it. On a busy outlet with a weak connection the
change notices can arrive faster than a read completes. Each would drop the read
before it, and the server's answer would never land. Own saves come at a
person's pace and, on a quiet till, stop. Change notices do not.

### D4. A read begun before a save never draws over it

A read in flight when the biller saves took its envelope snapshot before the save
existed. If it lands after the peek was drawn, it would draw the rail or Bills
without the new order or bill, and a moment later the trailing read would draw
it again: on, off, on.

- **Bills**: there is no `newer()` logic for bills, so the panel calls
  `queued.invalidate()` before drawing the peek, as the rail's `act` does. The
  dropped read's waiters resolve, and the queued read runs after it.
- **Rail**: `readOrders` already keeps locally written orders over older rows on
  the dish path, which is the only path this gate runs on. The rail invalidates
  too, for the same reason `act` does: one rule for every own save, which does not
  depend on knowing which writes call `wroteLocally`.

**Cost:** a biller saving faster than the connection answers keeps dropping
reads. The trailing read is always queued and lands once the saves pause. Until
then numbers arrive late, and nothing is missing from the screen.

### D5. A re-read that fails after a save is not the save failing

With the gate on, the Bills panel separates the two:

- The action's confirmation (*The payment was taken back and the order
  reopened.*, *Payment updated.*) is set when the write resolves. The re-read
  after it runs outside the action's `try`, and its failure never replaces that
  message with the action's failure words.
- A server read that fails while the panel shows a list keeps the list (which, on
  an own save, is the peek) and shows no error. This matches the rail, whose
  adapter quietly serves `orderCache` when the server fails.
  *Could not load this shift* stays for the one case where the panel has nothing
  at all to show.

Off keeps today's messages exactly.

### D6. The table picker opens on what the counter knows

With the gate on, `openTables` sets `tableOrders` from `peekOpenOrders` first,
then from `listOpenOrders` as today. Before the rail's first read, the peek is
`null` and the picker behaves as today.

### D7. Only the counter with both #74 gates on

The gate depends on `dish-ticks` **and** `kitchen-ready` (owner, 2026-10-14: "you
don't need to improve the version with those gates off"). The change gates
already make a gate run only while every gate it depends on is on, so the page's
snapshot answers `instant-saves` false whenever either is off, and the new code
never has to ask about them itself. It is built and tested against one counter:
dish ticks and Ready on, which is production's.

Its toggle points are in the dish path: `DishOpenOrdersSurface`, `MyShiftSurface`
in records mode, `CounterRecords`, the shell's dish branch, and `BillingCounter`
where it already branches on `dishWorkflow`. `OpenOrdersSurface` and the embedded
`MyShiftSurface` (the three-column counter) are not touched. Nothing here depends
on Ready's behaviour; `kitchen-ready` is a dependency so that only the combination
in production has to be proved, not because the code needs it. The unit tests
therefore run with `dish-ticks` and `kitchen-ready` on in both of
`instant-saves`'s states, and the off-state tests prove only that this gate's Off
is today with those two on.

**Rejected: also the counter with either #74 gate off.** The three-column rail is
deleted when `dish-ticks` retires (retireBy 2026-12-15), and the two-column
counter with Ready off is not run anywhere. Doing either would double the code
and the tests for a counter nobody uses.

### D8. Rejected alternatives for the mechanism

- **Upsert the order the adapter returns** (what `act` does). It fixes Order and
  Save changes in a few lines. It does not cover a take-back in Bills reopening an
  order on the rail, or a payment arriving in Bills, without passing order and
  bill objects across the shell. It would also leave two ways of drawing local
  truth. The peek is one way, and it is the projection the adapter already trusts
  when the server fails.
- **Make `listOpenOrders` answer twice** (local now, server later, as a
  subscription). It changes a contract that manager screens, the table picker and
  the off path all call, so Off could no longer be "today, untouched".
- **Put a time limit on requests.** Every fallback would still wait out the limit
  on every save, and no limit can tell slow from dead: too short and a healthy
  slow read is thrown away; too long and nothing is gained. Worth having for the
  outbox and the reload (follow-ups), but it is not this fix.
- **A shimmer or disabled card until the server confirms**: D2.

## Offline semantics

Explicitly unchanged. The commands, their payloads, their chains, their delivery
and their retries are byte for byte what they are today; the outbox reads no
gate. What changes is only when the screen draws the projection it already draws
for queued work. A peek on an offline tablet draws the same thing the server-read
fallback would draw a moment later.

## Money arithmetic

None new. Bills' cash and UPI totals in a peek are computed by the same helper
as `listShiftHistory`'s, over the same overlay, in integer paise.

## Row-Level Security

None. No table, policy or function is added or changed.

## Version skew

- **`change_gates` / `change_gate_dependencies`**: one migration inserts the
  `instant-saves` row, off, and its dependencies on `dish-ticks` and
  `kitchen-ready`. Published builds
  do not declare the key and ignore it (unknown is off). Nothing else in the
  database is touched, so every published build keeps working unchanged.
- **What turning the gate off does to what On persisted**: On persists nothing of
  its own. Every write is the same command either way. `roundTrip` is
  `none: the on path persists nothing; it draws the tablet's own queue and cache
  sooner, and every save is the same command with the gate on or off`. No
  round-trip test is needed.

## Risks

- **A peek shows another till's order as last read.** That is what the rail shows
  today until its next read; the peek does not make it older.
- **Bills' list stays on screen after a failed read**, possibly older than the
  server's truth. The rail already behaves this way. The sync indicator still
  counts what is unsent, and the next change notice or foreground re-reads it.
- **Kitchen marks on a just-saved card.** The peek does not read marks; the card
  shows whatever an unsent order shows today, until the server read refreshes
  them.

## Test strategy

- **Adapter, live**: `peekOpenOrders` returns a just-saved and a just-revised
  order with the client's requests held unanswered; returns `null` before any read;
  equals what `readOrders`' failure branch returns. `peekShiftHistory` includes a
  `pay_now` bill, a corrected tender and a take-back; `null` with no basis.
- **Adapter, demo**: both peeks equal the lists.
- **Screens** (`describeChangeGate('instant-saves', …)`, with `listOpenOrders` and
  `listShiftHistory` held unanswered, as `dish-refresh-latency.test.tsx` holds a
  read): Order puts the card on the rail; Save changes redraws it; Pay now and a
  rail Paid put the bill in Bills; Take back in Bills puts the order back on the
  rail; a failed re-read after Take back keeps the confirmation; the table picker
  marks a busy table. **Off**: each of those waits for the held read, as today.
- **A held-back read never draws over a save**: start a read, save, let the old
  read land, and the card never leaves the screen.
- **Browser** (`e2e-auth`, real local stack, tagged `@cg-on:instant-saves`):
  delay the `orders` and `bills` REST reads by several seconds with `page.route`,
  press Order, and the card is visible within a second; pay it and the bill is in
  Bills within a second.
- **Request budget**: `e2e-auth/request-budget.spec.ts` passes unchanged with
  every gate on.
