# Offline And Sync

> The command envelope, durable browser queue, live adapters and server receipts
> are built by `billing-live` (#10).

**The counter never stops.** A biller with a customer waiting cannot be blocked by a spinner, and a dropped connection must not cost the business a sale or a record of one. Everything on this page follows from that.

## What works offline

Deliberately asymmetric, because the risk is asymmetric.

| Works offline | Online only |
|---|---|
| Direct payment; create, revise, cancel and pay an order; correct tender for five minutes | Opening a shift |
| Continue with an already-open shift's last loaded menu | Finish day |
| View this tablet's local orders, bills and delivery state | Inventory, expenses |
| | Profit and loss, reports |
| | All admin and owner screens |
| | Attendance, from any device |

**Opening a shift moved to the online-only column with `counter-devices-and-offline`, and that is a real cost.** The handshake is a conversation between the tablet, the server and somebody else's phone: nothing local can stand in for the person who has to type four digits. So a tablet that comes up with no connection cannot open a counter, however much billing it could do once one was open. The mitigation is the shape of the day rather than a feature — a shift lasts until the outlet's cutover, so the connection is needed once an evening rather than continuously, and a shift already open survives the connection dropping afterwards.

Attendance is online-only from every device now, including the counter, because attendance is an RPC that evaluates the geofence server-side at the moment of the claim.

Manager and owner screens are used by people who can wait thirty seconds for a connection. Making them offline-capable would multiply conflict-resolution complexity for no operational gain — and every additional offline write path is another way for two devices to disagree about the truth.

Attendance stays online-only for a second reason: an offline check-in cannot be geofence-verified at the moment it happens, and a queued check-in that is validated later is a check-in that can be gamed.

## The outbox

`billing-live` (#10) puts every counter mutation into a durable local queue
rather than sending it straight to the network. The composer clears only after
that IndexedDB transaction commits; a storage failure leaves every field intact.

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
            ├─ accepted / exact replay ─► retain result, show server number
            ├─ retryable / no response ─► bounded backoff, entry stays queued
            └─ permanent refusal ───────► needs attention on this tablet
                                          correctable → correct or discard
                                          terminal    → discard only
```

The queue survives page reload, app close, compatible application upgrades and
device restart. It has to: the realistic failure is not a five-second blip, it
is a tablet that has been offline all evening.

Payments are eligible for delivery immediately; there is no delivery hold and
no queued-write Undo. A correction is its own immutable envelope, chained behind
the payment and every earlier correction for that bill. The local effective
tender and shift totals change only after that correction's IndexedDB transaction
commits. On restart the adapter rebuilds the paid bill and correction chain from
those durable envelopes before delivery resumes.

**A correction is only offered where a resend could land differently.** It
rebuilds the refused command under a new identity with the *same* payload, so it
can only help where the refusal was about the world having moved: a stale
revision, a colliding identity. Everything else is terminal. An order that is
paid will not become open, a closed edit window will not reopen, and a malformed
payload is still malformed the second time, so the resend earns the identical
refusal and leaves one more permanent row in the manager's diagnostics. The
tablet offers discard alone for those, and the store refuses a terminal
correction even if something tries to make one anyway.

## Rules that make this safe

**Local reads consult the outbox before the server.** Acceptance writes the
server's row and then deletes the envelope, so those two sources hand the fact
between them. A reader that takes the server snapshot first and the outbox
second can land in the gap where a just-accepted command is in neither: the
snapshot predates it and the envelope is already gone. Taking the outbox first
means at least one side always holds it, whatever the timing. The cost is a
smaller gap in the other direction — a command created *between* the two reads
is missed until the next read — which is accepted deliberately, because showing
less than the truth for one frame is not the same kind of wrong as showing a
paid order as unpaid.

**A guard reads the same projection the screen does.** Whatever the counter
believes about an order is built once, from the server's row plus the local
command log, and both the pipeline and the actions consult it. A guard reading
the bare server row would reach a different verdict from the card beside it, and
two readers disagreeing about one order is how a settled payment came to be
offered for payment again. Those guards key on projected state and never on
command history, because taking a payment back reopens an order precisely so it
can be paid a second time.

**Client-generated UUIDs.** Every counter record gets its ID on the device, before it is ever sent. The client can therefore reference its own rows immediately, and a retry carries the same identity as the original.

**Exact command receipts.** The server claims the command UUID with its type,
version, immutable creation time and canonical payload hash. Exact retry returns
the original result; changed content under that UUID is `identity_conflict`.

**Bill numbers are assigned by the server, never the client.** Two offline tablets cannot safely agree on the next number in a sequence. Until a bill syncs, the UI shows a clearly provisional local reference; the real per-outlet number arrives with the server's response. Showing a fake number that later changes would be worse than showing an honest placeholder.

**Totals are computed on the device and validated by the database as one
aggregate.** Parent, lines, number, state transition and receipt commit in one
transaction or none do. Inconsistency is rejected, never repaired.

**Both dates are explicit and validated.** Revenue keeps order timestamp and
business date; the drawer uses payment timestamp and payment business date.
Neither is re-derived at sync or read time.

**Historical shifts authorize delayed work.** A delayed command remains valid
only when its immutable creation time falls inside the named tablet shift and
before tablet removal. Backdating outside those facts is permanent refusal.

**A live screen keeps one shift menu snapshot, but a reload does not open from
cache.** After at least one successful live read, a transient failure leaves the
already-open counter usable with a persistent warning. Captured lines retain
their item-name and price snapshots through every refresh. Starting or resuming
after reload requires the backend and a fresh approved shift.

**Freshness has two independent triggers.** The screen re-reads menu and
activity on foreground, and Realtime events for menu, orders and bills are only
nudges to make the same authorised reads. A silent subscription therefore cannot
leave a counter stale for the rest of its shift.

## Conflicts

There are fewer than you would expect, by design.

**Paid bills do not conflict.** Payment locks an open order, then either wins in
full or returns `order_not_open`; manager cancellation racing it cannot leave a
partial bill or consume a number.

**Payment corrections use optimistic revisions.** The database locks the bill,
accepts only the expected effective revision during the original five-minute
window and appends a full replacement allocation. A stale correction is refused;
exact replay appends nothing. Older revisions remain audit evidence but never
contribute to effective totals.

**Shifts can overlap** if a device was offline when another opened one. Both are recorded; the manager sees an overlap flag. The app does not silently pick a winner, because the correct resolution depends on what actually happened in the shop.

**The genuine hard case is a late bill against a closed day.** A tablet offline all evening syncs after the manager has already counted the drawer and closed the business date.

The rule: **a closed cash record is a snapshot and is never silently
recomputed.** The late bill is stored with its true dates, so the mismatch is
detectable without changing the signed figures. The exception flag and
reconciliation UI are deliberately deferred; this change supplies no reopen,
re-close, or automatic recovery path.

## Failure modes worth designing for

| Situation | Behaviour |
|---|---|
| Offline all evening, 200 bills queued | All settle locally; drain on reconnect; progress is visible, not a frozen screen |
| Tablet dies with unsynced bills | **Data is lost.** IndexedDB is the only copy until sync. Mitigation: the pending count is always visible, and a persistent backlog is surfaced as a warning to the manager |
| Server rejects a bill as malformed | Quarantined, not silently dropped; surfaced to the manager with the reason |
| Clock skew on the tablet | Both client and server timestamps are stored. Material disagreement is a signal worth surfacing, not something to paper over |
| Two tablets at one outlet | Deferred to `multiple-billing-devices` (#35). The command and number allocators are concurrency-safe, but launch setup permits one active tablet per outlet |
| Tablet removed while holding a queue | Draining stops and envelopes remain on that tablet. The removal confirmation names what it last reported unsent, so the admin is told before rather than after |
| A command is accepted while the pipeline is refreshing | The read consults the outbox before the server, so the acceptance is never lost between them and the order does not return to the counter as unpaid |
| A refusal a resend cannot fix | Discard is the only resolution offered. Correcting it would earn the same refusal and add another permanent diagnostics row |

There is deliberately no order transfer and no privileged recovery upload.
Open orders are short-lived kitchen tickets: a manager cancels a stranded one
with a reason and it is re-rung. A removed tablet cannot deliver work created
after removal; valid earlier envelopes retain their historical bounds.

## What the biller sees

Almost nothing, which is the point.

- A small persistent indicator: synced, or *N pending*.
- No spinner, no blocking dialog, no error toast on a failed sync — the queue handles it.
- One honest exception: if the backlog grows past a threshold or an entry has failed repeatedly, the indicator escalates to a visible warning, because at that point someone genuinely does need to know.
- An action the counter has already taken is refused in place, naming the order,
  rather than being sent for the server to refuse. A refusal that does reach the
  server names its order too, so neither the biller nor the manager has to work
  out which one it was about.

**Finish day** is the explicit online boundary. The tablet waits out the last
five-minute payment-edit window, drains the date, refuses while any local
envelope or server open order remains, then ends the shift and records one
end-of-day confirmation atomically.
It never treats a browser's `online` flag as proof that the server was reached.

## Cash that arrives after the drawer was counted (#11)

A drawer count is a claim about a moment, so work delivered after it cannot be
folded into it — and the rule that governs this is one sentence:

> **The app never changes a person's observation on its own.**

A cash allocation whose payment instant falls inside an interval some observation
has already covered, and which arrived after that observation was recorded, raises
a **reconciliation exception** against it. The exception names the bill, its
amount, when it was rung, when it landed, and **what the difference would have
been** had it been present. It changes no stored figure.

Two resolutions, and neither writes to the observation: an attributed
acknowledgement with an optional note, or recording a fresh count. A backdated
cash *expense* landing in an observed interval takes the same path, by the same
code.

**A late arrival may explain a recorded variance rather than create one** — an
over that turns out to have been an unsynced tablet's cash all along. The recorded
figure stays exactly as it is and the explanation sits beside it with its date,
because the figure is what somebody saw and the explanation is what was learned
afterwards.

**The exception itself is derived, never stored.** Both halves of what makes it one
— the payment instant inside the interval, and the arrival after the observation —
are already facts on rows the schema holds, so a stored exception row could only
disagree with them. Only the human act of having looked at one is written down.

**Unsynced devices advise and never block a count.** The count surface names how
many tablets are holding undelivered work and since when, and marks the expected
figure as possibly understated. It does not refuse the count: the person is
standing at the counter holding the cash, and a count that does not get recorded
is worse than one recorded against an understated expectation.
