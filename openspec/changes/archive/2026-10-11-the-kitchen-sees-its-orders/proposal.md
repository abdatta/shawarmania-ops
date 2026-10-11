# Proposal: The Kitchen Sees Its Orders

> **Model**: Opus · **Wave**: F · **Depends on**: **#69**, #35, #61 · **Gate**: an
> owner or Franchise Admin chooses **Billing** or **Kitchen** when creating a
> tablet's setup code, and the tablet opens as that kind on redeeming it with no
> change to its own setup screen; they switch a set-up tablet between the two
> from the outlet's Tablets list, keeping its identity, ending any live
> shift on it, and being refused a switch to Kitchen while that tablet still holds
> unsent work or orders it took that are still on the rail; a kitchen tablet opens
> a **kitchen shift** through the counter's own shift-start screen and phone code,
> held by the same people who may hold a counter shift, and the same person may
> hold a counter shift and a kitchen shift at once; with no live kitchen shift the
> tablet reads no order, proved by a hand-crafted request; a kitchen shift reads
> each order's number, service, lines and age and never a customer's name or phone,
> a price, a bill, a payment or an expense, proved by a hand-crafted request, and
> can issue no billing command; the kitchen screen shows the counter rail's
> unprepared orders oldest first (or newest first, if the kitchen chooses),
> filtered by a category include or exclude list
> chosen on the tablet and saved on it, with a line saying how many items on an
> order belong elsewhere; a new order, an edit and a cancellation each shake and
> colour their card in their own colour and ring their own tune three times, one
> sound at a time, until **ACK** is pressed on that card; a cancelled card stays
> until it is ACKed or its business day ends; an order ticked Prepared at the
> counter leaves without an ACK; losing sync, or sound being blocked, is shown by a
> floating alert that cannot be missed; a person's phone lists each live shift with
> its own **Leave**; and the four-role demo walkthrough still walks, with a counter
> tab ringing a kitchen tab.

## Why

The cooks cannot see the counter. Today an order reaches the kitchen by somebody
shouting it, and the counter's rail — the list of unfinished orders on the billing
tablet — is the only place the full list exists. The business already runs two
kitchens at Kalyani Cafe, one for continental food and one for everything else,
and wants a tablet in each showing only its own food. Hardware is the bottleneck,
not the kitchen, so the feature ships for two or more kitchens from the start and
is proved without real tablets.

The cooks are busy and do not watch a screen, so the screen has to call for
attention when something arrives, changes or is cancelled — and has to keep calling
until somebody acknowledges it.

## What Changes

### A tablet has a type

- **Every set-up tablet is either a Counter or a Kitchen.** The type is changed by
  an owner or a Franchise Admin from the **Edit** action on the outlet page's
  Tablets list, the same place a tablet is renamed today. The tablet keeps its
  identity, name, outlet and history; only what it does changes.
- **Changing the type ends any live shift on that tablet**, in either direction,
  and the tablet returns to its shift-start screen of the new type. Somebody starts
  a new shift there the usual way. There is no transfer of a shift between types.
- **A tablet cannot become a Kitchen while it owes the counter anything**: unsent
  work in its offline queue, or an order it took that is still on the rail (unpaid,
  or paid and not prepared — only the tablet that took an order may ever finish
  it). The refusal names what is outstanding. Becoming a Counter is never refused.
- **The type is chosen when the tablet is set up.** The admin creating the
  setup code on their phone answers *Use this tablet for: Billing / Kitchen*
  beside the tablet's name. The code carries the choice, so the tablet's own
  setup screen is unchanged: it enters the code and opens as whatever it was
  set up to be.

### A kitchen shift

- **A kitchen tablet starts its shift exactly as a counter does**: the shift-start
  screen asks for a username, shows four digits, and the person enters them on
  their own phone. The words name the kitchen rather than the counter; nothing
  else is new.
- **The same people may hold one**: a Biller at that outlet, its Franchise Admin,
  or the owner. One person may hold a counter shift and a kitchen shift at the same
  time — they are doing two jobs in one shop.
- **A kitchen shift ends the way a counter shift does** — at the cutover, by Leave
  from the phone, by Hand over on the tablet, or when the tablet is removed or
  changes type. It never blocks Finish Day, and Finish Day does not end it.
- **The phone lists every live shift** with its type, tablet and start time, each
  with its own **Leave**, and the confirmation names which one is ending. A person
  holding one shift sees what they see today.

### The kitchen screen

- **It shows what the counter rail shows, minus what is done**: every order that is
  open or paid and not yet prepared, **oldest first** by default, in a grid for a
  landscape tablet. An order leaves when the counter ticks **Prepared**, or when the day
  change finishes it (#69). Pay-now sales are not orders and do not appear, exactly
  as on the rail.
- **Each card shows** the order number large, its service — *Takeaway*, *Dine-in*
  or *Table 4* — each of this kitchen's items with a large quantity, how long ago it
  was ordered, and, when the order has items for another kitchen, *+2 items for
  another kitchen*. No price, no total, no customer name or phone, no payment state,
  no packaging line.
- **A filter chosen on the tablet**: *Only these categories* or *Everything except
  these categories*, over the outlet's menu categories. *Everything except* is what
  makes a new category appear on that kitchen without anybody remembering to add it.
  The filter is saved on the tablet's own record, so it survives a reload, a
  reinstall and a cleared browser, and the Tablets list shows it. The Filter
  button is labelled with the filter in force, so an empty screen is never mistaken
  for a quiet one. The same sheet can turn the board to newest first, saved the same
  way. A card awaiting ACK that is scrolled out of sight is pointed at by a floating
  pill that scrolls to it.

### Alerts and ACK

- **Three alerts, each with its own colour, tune and ACK button**:

  | | Card | Sound |
  |---|---|---|
  | **New order** | shakes, then wears the brand colour | the new-order tune, three times |
  | **Edited** | shakes, then turns amber; added items marked, removed items struck through, changed quantities shown old → new | the edit tune, three times |
  | **Cancelled** | turns red and is stamped *Cancelled* | the cancel tune, three times |

- **ACK** on a card silences its alert, clears its colours and hides the button. On an
  edited card it also drops the struck-through lines and the marks. On a cancelled
  card it removes the card. If nobody presses ACK, the sound stops after three rings
  and the card keeps its colours and button until somebody does.
- **One sound at a time.** Alerts that arrive together share their rings — three
  orders landing at once is three rings, not nine — and the most urgent kind plays
  first: cancel, then new, then edit. An ACK stops the ringing as soon as nothing
  else is waiting.
- **An edit or cancellation only alerts the kitchen it concerns.** An edit that
  touches only another kitchen's items changes nothing here. An edit that removes
  all of this kitchen's items reads as a cancellation here; one that adds this
  kitchen's first item reads as a new order here.
- **Opening the screen does not ring** for orders already there; they show their
  alert and ACK silently. Only what arrives while the screen is open rings.
- **A cancelled card that nobody ACKed disappears when its business day ends.**
- **ACKs are kept on the server**, per kitchen tablet, so a reload never loses a
  cancelled card, two kitchens acknowledge independently, and the owner can later
  see how long a kitchen took to notice an order.

### Staying live

- **The screen updates itself** within seconds of a counter write, and keeps the
  display awake.
- **A floating alert covers the case where it cannot**: the network is down, the
  live connection has gone quiet, or the last successful read is too old. The alert
  says the screen may be out of date; it is impossible to miss and does not go away
  until the screen is current again.
- **Sound blocked by the browser is an alert too.** After a reload the browser may
  refuse to play sound until the screen is touched; the screen says so in the same
  unmissable way and one tap restores it.

## Capabilities

### New Capabilities

- `kitchen-display`: the kitchen screen — what it reads, its filter, its alerts and
  ACK, and its sync and sound alerts.

### Modified Capabilities

- `counter-device-sessions`: a tablet has a type; changing it; the kitchen shift;
  a person's several live shifts on their phone.
- `order-lifecycle`: a kitchen shift may read an outlet's unfinished orders through
  a narrow read that carries no customer, price or payment fact.

## Non-goals

- **No action on an order from the kitchen** beyond ACK: no Prepared, no Ready, no
  bump. Preparation stays the counter's tick (owner, 2026-10-08).
- **No special requests or item notes.** Deferred by the owner.
- **No new role.** A kitchen shift is held by the people who may hold a counter
  shift today.
- **No kitchen settings on the owner's page.** The filter is chosen on the tablet.
- **No business-day filter on the kitchen screen.** The owner judged the cases it
  would hide — an unpaid order left open overnight, a counter syncing yesterday's
  orders late, an order stranded on a till not in use today — rare enough to accept.
- **No printing**, and no kitchen view of pay-now sales.
- **No change to the counter rail**, the billing commands, or who may finish an
  order.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the Kitchen screen; the kitchen
  shift-start screen's wording; the phone's shift list; the Tablets list's type,
  Edit field and kitchen row.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — the
  kitchen shift's reach, in the capability matrix.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — `counter_devices.kind` and
  the kitchen filter columns, `counter_shifts.kind`, `kitchen_acknowledgements`,
  the kitchen pulse.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — the kitchen's
  freshness contract beside the counter's.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — why a
  kitchen shift reads orders without customer facts.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — switching a tablet's type,
  and what refuses it.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — the kitchen walkthrough with a
  counter tab and a kitchen tab.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *Kitchen tablet*, *Kitchen
  shift*, *ACK*.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — replace the *Table
  management or KOT* non-feature line, and record the three accepted cases above.
- [`docs/BUSINESS_CONTEXT.md`](../../../docs/BUSINESS_CONTEXT.md) — the counter
  workflow's step 1 no longer relies on calling orders to the kitchen.
