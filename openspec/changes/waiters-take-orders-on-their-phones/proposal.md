# Proposal: Waiters Take Orders On Their Phones

> **Model**: Opus · **Wave**: F · **Roadmap**: #80 (owner's request, 2026-10-21) ·
> **Depends on**: #74 (the rail, labels, notes and dish ticks), #75 (change
> gates), #35 (several tablets at one outlet), #5 (attendance and its geofence),
> and `staff-roles-include-other-roles`, which must be released and cleaned up
> before the first Waiter is made ·
> **Gate**: the owner approved the waiter's Orders tab, its location light, the
> counter's waiting card and the accept composer from the demo before any of it
> was wired live; a Waiter, checked in today and confirmed inside the outlet in
> the last 15 minutes, sends a new order or a change to any live order from
> their own phone; nothing a waiter sends reaches an order, a number or a
> kitchen until a counter accepts it, from a composer already filled in; a
> waiter never pays, ticks, cancels an accepted order, discounts or uses points,
> and the database refuses each from a hand-crafted request; with
> `any-counter-acts` on, any counter tablet at the outlet edits, pays, cancels
> and ticks any open order, and an edit or payment made against an order that
> moved on is refused rather than overwriting it; and with both gates off the
> counter, the kitchen and every phone behave exactly as they do today.

## Why

Today a waiter takes an order at the table on paper or in their head, walks to
the counter and says it aloud, and the biller types it. Every step between the
customer and the screen is a place for a dish, a quantity or a note to go
missing: the counter mishears, misses a line, or does not understand a note. The
owner wants that gap gone: the waiter taps the order on their own phone, the
counter sees it already typed, and one tap makes it an order (owner,
2026-10-21).

The same conversation exposed a second, older friction. An order belongs to the
tablet that took it, and only that tablet may edit, pay, cancel or tick it.
When a tablet dies mid-service its orders are stranded until it is repaired, or
until a manager cancels each one and the counter re-rings it. The owner called
the rule *too rigid* and asked for it to go in the same change, since waiters
editing any order is already the same idea.

## What changes

### A Waiter, on their own phone

- **Waiter is a role** that includes an Employee, and a Biller includes a
  Waiter (`staff-roles-include-other-roles`), offered on Team beside them. A
  Waiter does everything an Employee does, checking in and recording expenses,
  and additionally has an **Orders** tab on their phone. A **Biller** includes a
  Waiter, so a Biller has the tab too: billers are on the floor as often as at
  the till.
- **No setup code, no handshake.** The waiter signs in with their own username,
  as for attendance. The tablet's four-digit shift code exists because a tablet
  is shared; a personal phone is not.
- **Checked in today, at this outlet**, or the tab says so and sends nothing.

### The location light

The top of the Orders tab says whether the phone is confirmed inside the
outlet, checked **before** the waiter walks to a table, never at the moment of
sending (owner, 2026-10-21):

- 🟢 **Inside.** A check in the last 15 minutes placed the phone inside the
  outlet's geofence. Sending works.
- 🟡 **Heads-up.** The latest check failed or could not get a fix, but a good one
  is still under 15 minutes old. Sending works, with *Your location isn't
  confirming. Sort it before your next table.*
- 🔴 **Blocked.** No good check for 15 minutes. *Turn on location and step inside
  before taking an order.* Orders can still be read and drafted; nothing can be
  sent.

It checks on opening the tab, on returning to the app, and every three minutes
while the app is on screen. **Retry** on 🟡 and 🔴 reads location again. Sending
never waits for GPS: the database admits a send only when the person's latest
inside check is under 15 minutes old.

On 🔴 a draft offers **Show to counter**: the order, large, with its dishes,
quantities, notes and table, so the counter can ring it from the waiter's
screen.

### Sending a new order

**New order** opens the counter's own menu and composer, laid out for a phone:
the searched menu, tap to add, quantities on the line, dish notes, the table and
dine-in or takeaway, and the label, which may hold the customer's name. No
customer phone, no discount, no points: the customer gives their number at the
counter when they pay, as today (owner, 2026-10-21). **Send to counter** sends it. The waiter's card then reads *Waiting
for counter*, with **Take back** until a counter answers.

The counter cannot be reached when no counter shift is open at the outlet or the
business day is finished. The tab says *Counter is closed* ahead of time, and
nothing sends.

### The counter accepts, and only then is it an order

A waiting request appears at the top of the counter's rail as a **Waiting**
card, with the waiter's name, table and dishes, and rings once. Tapping it opens
the **composer already filled in**, exactly as if the biller had tapped every
dish themselves (owner, 2026-10-21). The biller may change anything, then:

- **Accept** does what **Order** does today: the order is created, takes its
  order number, joins the rail and reaches the kitchen tablets.
- **Reject** takes it off the rail. The waiter's card reads *Rejected by
  counter* until they dismiss it. No reason is asked: the waiter is in the
  room.

Until a counter accepts, there is no order, no number and nothing in any
kitchen.

### Changing a live order goes through the counter too

A waiter may open **any** live order at the outlet, whoever took it, and change
its dishes, quantities, notes, table, dine-in or takeaway and label.
They send it as a **change**, which waits for the counter exactly as a new order
does. A silent change is unsafe: an outlet may have a kitchen with no tablet
(Kalyani Cafe's burger kitchen is told in person), so somebody at the counter
must see every change in order to pass it on (owner, 2026-10-21).

The counter's Waiting card for a change reads what changed: *+1 Chicken Burger ·
−1 Coke · Table 4 → 6*. Tapping it opens that order in the edit composer with
the change applied and marked. **Accept** saves it as an ordinary edit, and the
kitchen tablets are alerted as for any edit. If the order moved on after the
waiter sent the change, the composer says so before Accept.

- **One waiting change per order.** A second waiter opening that order reads
  *A change from Rahul is waiting for the counter* and cannot send another until
  it is answered.
- **Food the kitchen has made cannot be taken off**, as at the counter today.
- **A paid order is closed**, as today. A table that paid upfront and wants more
  gets a new order for that table.
- **A waiter may take back only their own request, and only while it waits.**
  Cancelling an accepted order is the counter's.

### What a waiter reads

The Orders tab lists every live order at the outlet, by table: its number, its
table or *Takeaway*, its label, its dishes with how many are made and which the
kitchen has marked **Ready**, **Paid** or **Unpaid**, and the total. A waiter's
own requests sit above the list, *Waiting*, *Rejected* or, for a minute,
*Accepted as #106*. No customer's name, phone or gold mark reaches a waiter's
phone.

A waiter never sees, sets or changes a payment, a tick, a discount, points or a
bill.

### Any counter acts on any open order

With `any-counter-acts` on, every counter tablet at an outlet may edit, pay,
cancel and tick every open order there, not only the ones it took. A tablet that
dies mid-service no longer strands its orders: another tablet picks them up.

Two tablets now able to write one order must never silently undo each other.
Every edit, payment, cancellation and tick names the version of the order it
was made against. If the order has moved on since, the database refuses it, and
the tablet says *This order changed on another counter. Reopen it.* A tablet
still works its **own** orders offline, as today. Acting on **another tablet's**
order needs a connection, because offline it cannot know it holds the latest
version.

Correcting a payment's tender and taking a payment back stay with the tablet
that took the payment, as today.

## Change gate

Two gates, in this one change (owner, 2026-10-21), so that either can be pulled
without the other.

- **`waiter-orders`** (*WO*)
  - **On:** Waiters send new orders and changes from their phones, and the
    counter accepts or rejects them from a filled-in composer.
  - **Off:** Orders are rung only at the counter.
- **`any-counter-acts`** (*AC*)
  - **On:** Any counter tablet at an outlet can edit, pay, cancel and tick any
    open order there, and a change made against an order that moved on is
    refused.
  - **Off:** Only the tablet that took an order can edit, pay, cancel or tick
    it.

**`waiter-orders` depends on `role-includes`**: a Waiter is written into which
role includes which, and the dependency keeps the change within the limit of five gates that
depend on nothing. `any-counter-acts` depends on nothing. With `waiter-orders`
on and `any-counter-acts` off, a waiter's change to an order is accepted only on the tablet that took it,
and the other tablets show its Waiting card without Accept.

**Off is today, and what On saved outlives it.** The Orders tab and the Waiter
choice on Team are a new surface, held by the surface registry and shown only
while `waiter-orders` is on. A Waiter includes an Employee, so with the gate
off a Waiter still acts as an Employee everywhere the includes rows are asked:
they check in and record expenses, and have no Orders tab. Waiting requests are new rows no off-path code
reads. Turning `waiter-orders` off leaves them unanswered and unread, and the
day change expires them (design D11). An order a counter accepted is an ordinary
order. `any-counter-acts` persists nothing new: a command queued under it either
lands or is refused like any command whose order moved on. Both round trips are
proved by browser tests (design D13).

## Non-goals

- **A waiter taking payment**, marking Paid or Prepared, cancelling an accepted
  order, discounting, using points, or upgrading a customer to Gold.
- **Customer details from a waiter.** No phone number or customer name is
  entered or read on a waiter's phone (owner, 2026-10-21). The label may carry
  a name.
- **Sending from a phone with no connection.** The Orders tab is online only.
  The counter's outbox stays the only offline write path.
- **A counter code as a location fallback.** Considered and left out (design,
  rejected alternatives), with the condition for bringing it back.
- **Bluetooth, NFC, nearby-device or Wi-Fi proof of presence.** None works on
  every phone from a web app (design, rejected alternatives).
- **The phone ringing when food is Ready.** Ready is shown on the Orders tab, not
  rung. A phone in a pocket rings unreliably from a web app.
- **A Manager or the owner taking orders from their own phone** without a Waiter
  or Biller assignment at that outlet.
- **Splitting a table's bill**, or moving dishes between orders.
- **Transferring a paid bill's corrections** (tender correction, payment taken
  back) to another tablet.
- **Waiter performance figures** (orders per waiter, time to accept). The
  request rows make them derivable later.

## Capabilities

### New

- `waiter-ordering`: who takes orders, the location check and its 15 minutes,
  what a waiter reads, sending, taking back, the counter's Waiting card,
  accepting and rejecting, and the day's end.

### Modified

- `order-lifecycle`: ordinary order actions require the owning tablet only while
  `any-counter-acts` is off; with it on, any counter tablet at the outlet, against
  the version it saw.
- `multi-device-billing-coordination`: ownership no longer survives a neighbour
  for open orders when `any-counter-acts` is on; versioned commands replace it.
- `counter-billing`: live open-order actions follow the same rule; the rail
  carries waiting requests.
- `bill-discounts`: a discount belongs to whichever counter may act on the order.
- `identity-and-access`: Waiter includes Employee, and Biller includes Waiter.

## Impact

- **Database**: `'waiter'` added to `app_role` and `staff_roles`, with *Waiter
  includes Employee* and *Biller includes Waiter*; new tables for order requests and presence checks, each outlet-scoped with its policy and isolation test; new functions to
  check presence, send, take back, read the waiter's board and reject; `_v3`
  create, revise, pay, cancel and prepare commands that carry a base version and,
  for create and revise, the request they answer; two `change_gates` rows, off.
  No existing table, view, policy or function changes.
- **Counter**: one more realtime filter on its existing channel and one read when
  it fires. The idle request budget does not move. Accepting is one ordinary
  create or revise.
- **Waiter phones**: one presence write every three minutes while the tab is on
  screen, and one board read when the outlet's pulse moves. Nothing while the
  phone is locked.
- **Kitchen**: none. It sees an accepted order as any other.

## Docs To Update Before Archive

- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md): the
  Waiter, what it includes and its reach; the counter's reach under `any-counter-acts`.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): the Orders tab, the location
  light, Show to counter; the counter's Waiting card and accept composer.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the Waiter, the two tables, the
  request's shape, the `_v3` commands and the base version.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md): the version
  check, the refusal it produces, and why another tablet's order needs a
  connection.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md): *Ownership stays the
  database's, and stays per tablet* becomes the versioned rule.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md): the
  presence check as employee monitoring, what it keeps (distance and accuracy,
  never coordinates), and that no customer detail reaches a waiter's phone.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): browser location is
  spoofable here too; a stale payment is refused; online-only waiting.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): **Waiter**, **Request**,
  **Accept**, **Location light**, **Base version**.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md): the Waiter walkthrough and
  the demo's waiting requests.
