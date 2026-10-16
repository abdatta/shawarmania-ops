# Proposal: The Counter Shows What It Saved

> **Model**: Opus · **Kind**: correction to shipped counter behaviour, not a
> roadmap change (no ROADMAP.md row) · **Depends on**: #74's `dish-ticks` and
> `kitchen-ready` gates, the counter this change touches · **Gate**: with
> `instant-saves` on and the server's answers held back, an order saved with
> **Order** is on the rail, fully filled in apart from its number, before the
> server has answered; **Save changes** redraws its card at once; a payment from
> **Pay now** or a rail card is in Bills this shift at once; a payment corrected,
> taken back or cancelled after paid shows in Bills at once, and a taken-back
> order is back on the rail at once; the table picker marks busy tables at once;
> a refresh that fails after a save never says the save failed; the counter makes
> no more requests than it does today, and stays inside #75's request budget;
> with the gate off every one of those screens behaves exactly as it does today;
> and the four-role demo walkthrough still walks.

## Why

On a slow connection the counter looks as if it lost an order (owner,
2026-10-14). Pressing **Order** clears the composer straight away, but the order
appears on the rail only after a moment, sometimes a long one. Adding dishes to
an order and pressing **Save changes** does the same: the card keeps its old
dishes for a while. For a counter that promises to keep taking money with no
internet at all, a weak connection should not be the case that makes it feel
broken.

The order is not lost and was never at risk. Saving writes it to the tablet's
own queue first, and that takes a few milliseconds. The tablet even builds the
finished card, with the dishes, customer, label and total, everything but the
number the server will assign. **The screen then throws that card away and asks
the server for the whole rail again**, and draws the order only when the answer
arrives. That is two network trips, one after the other, with no time limit, and
sometimes queued behind a read already on its way. The spec already promises the
order appears *immediately* ("A saved order enters the preparation pipeline");
on a slow connection it does not.

The rail's own buttons do not have this problem. Ticking a dish, paying or
cancelling from a card draws the change at once and checks with the server
behind it. This change gives the counter's other saves the same treatment.

Tracing every save on the counter found the same wait in more places:

| What the biller does | What they see today on a slow connection |
|---|---|
| **Order** | The card appears only after the server re-read |
| **Save changes** | The card keeps its old dishes until the re-read |
| **Pay now**, or **Paid** on a rail card | The bill reaches Bills this shift only after a re-read of the shift's bills, also two trips |
| **Edit payment**, **Take back**, **Cancel after paid** in Bills | The bill row keeps its old state until the re-read. A taken-back order reaches the rail only when the server's change notice arrives, because the Bills panel never tells the rail |
| A re-read that **fails** just after one of those | Bills says *That item could not be resolved* or *That payment could not be updated* though the action was saved, which invites the biller to do it twice; or *Could not load this shift* over a list it could have drawn |
| Opening the **table picker** | Busy tables come from a fresh server read; until it lands the picker shows the last list it had, or none |

## What Changes

With `instant-saves` on:

- **Order puts the order on the rail at once**, at its newest end, fully filled
  in: dishes, notes, label, customer and its gold star, service and table, total.
  Its number shows the awaiting shape it already shows offline, until the server
  assigns one. It is not greyed out or locked: its dishes can be ticked, it can be
  paid, edited or cancelled straight away, as an order taken offline can be today.
- **Save changes redraws the card at once** with its new dishes and total.
- **A payment is in Bills this shift at once**, whether from Pay now or from a
  rail card, with the cash and UPI totals moving with it.
- **Edit payment, Take back and Cancel after paid show in Bills at once**, and a
  taken-back order is back on the rail at once.
- **The table picker opens with the tables the counter already knows are busy**,
  then corrects itself from the server.
- **A failed re-read after a save is not the save failing.** The save's own
  confirmation stands, and the panel keeps what the tablet knows instead of
  replacing it with an error. *Could not load this shift* appears only when the
  tablet has nothing to show.
- **The server is still asked**, once per save, as today. When it answers, its
  answer replaces what was drawn: the real order number, another till's orders,
  a manager's change. Nothing moves when the two agree.

With the gate off, all of those screens behave exactly as they do today.

## Change gate

- **`instant-saves`** (*IS*), **depends on `dish-ticks` and `kitchen-ready`**
  - **On:** The counter shows an order, an edit or a payment the moment the
    tablet has saved it, and checks with the server afterwards.
  - **Off:** The counter shows an order, an edit or a payment once it has asked
    the server again, which takes a moment on a slow connection.

It depends on both of #74's gates (owner, 2026-10-14), so it is built and tested
for one counter only: the one with dish ticks and Ready on, which is the counter
in production. With either #74 gate off, `instant-saves` is off too and the
counter is exactly what that gate's Off describes. The three-column counter is
left alone: it is deleted when `dish-ticks` retires, and making it instant too
would double the work and the tests for a screen with weeks to live (design D7).

**What Off does with what On saved: nothing to say.** The on path saves nothing
new. Every order, edit and payment is the same queued command either way; On
only draws it sooner, from what the tablet already holds. Turning the gate off
mid-service reloads the page at its next free moment, and the off path redraws
the rail from the server as it always has.

## Non-goals

- **No change to what is saved, queued or sent.** No new command, no new field,
  no change to the outbox, the server functions or the order of delivery.
- **No new requests.** Each save still causes the one re-read it causes today;
  what changes is that the screen stops waiting for it. The request budget does
  not move.
- **No placeholder, shimmer or disabled card for a saved order.** The owner's
  first suggestion was a card held disabled until the database confirms it.
  Design D2 records why the card is drawn real instead: offline, that
  confirmation may not come for an hour, and the card is already fully usable
  without it.
- **No change to the counter with either #74 gate off**, including the
  three-column counter that runs with `dish-ticks` off.
- **No change to the kitchen tablet.** Its ACK and Done are online actions by
  design; making ACK look instant is a separate question (see Follow-ups).
- **No time limit on requests, and no change to how the counter starts.** A
  reload on a slow connection still waits on the server before opening the
  counter; that is a larger question about when a remembered shift may be used
  (see Follow-ups).
- **No change to the customer lookup.** A returning customer's name and points
  still come from the server.

## Follow-ups found while tracing, not in this change

Each is its own change if the owner wants it:

- **A reload on a slow connection waits with no limit.** `resolveSession` makes
  three server checks one after another before the counter opens, and uses the
  remembered shift only when they fail outright. Every auto-update reload and
  every turned gate reload pays this.
- **The queue sends every two seconds and is not woken by a save**, so an order
  reaches the kitchen up to two seconds later than it could. A send that hangs
  holds the queue, because requests have no time limit.
- **The kitchen's ACK has no "saving" look**: its ring stops at once but the
  button stays until the server answers and the board is read again. Done already
  flips at once.
- **The customer dialog uses remembered customers only when the lookup fails**,
  not while it is slow.

## Capabilities

### Modified

- `counter-billing` — a saved order, an edit and a payment are drawn from the
  tablet's own record before the server's answer; a failed re-read after a save is
  not reported as the save failing; the table picker opens on what the counter
  knows.

## Impact

- **Database**: one migration inserting the `instant-saves` gate row, off, with
  its dependencies on `dish-ticks` and `kitchen-ready`. No table, column, function, policy or trigger.
- **Counter**: the billing adapter gains two reads that never touch the network
  (`peekOpenOrders`, `peekShiftHistory`), in the live and demo adapters both; the
  composer, the two-column rail, the Bills panel and the counter shell gain the
  gated path. The off path is left as it is.
- **Kitchen**: none.
- **Request budget**: unchanged, and proved unchanged with the gate on.

## Docs To Update Before Archive

- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — under *Rules
  that make this safe*: the counter draws its own saves from its own record first,
  and a read begun before a save never draws over it.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the counter's rail and Bills
  panel showing a save at once; the table picker.
- [`docs/TESTING.md`](../../../docs/TESTING.md) — the held-back-server tests, unit
  and browser.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — the follow-ups above
  that remain: a slow reload, the two-second send, the kitchen's ACK.
