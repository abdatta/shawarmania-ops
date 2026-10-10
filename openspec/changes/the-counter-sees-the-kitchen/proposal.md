# Proposal: The Counter Sees The Kitchen

> **Model**: Opus · **Wave**: F · **Depends on**: **#70** · **Gate**: at an outlet
> with a live kitchen shift, every order on the billing tablet's rail that has a
> dish a kitchen shows carries a bell in the space beside its dishes, under the
> customer button — orange and swinging while any such kitchen has not pressed ACK
> on the order's latest version, and gone, its place kept, once every one has; an
> edit at the
> counter that changes a kitchen's dishes sets it swinging again; the swinging bell
> shows one dot per kitchen on shift, one kitchen included, always
> in the same place for the same kitchen, orange while that kitchen is waiting and
> grey once it has pressed ACK, and the dots disappear without moving anything
> when the bell stops; with no kitchen shift live at the outlet no card carries a
> bell, and the counter's header says *Kitchen offline* where the outlet has a
> kitchen tablet; a kitchen's ACK reaches the counter within seconds; the counter learns no
> more about the kitchen than which of its tablets has pressed ACK; the rail's
> cards take the kitchen ticket's torn top edge, its number face and its dish-count
> tiles at today's height — a one-dish card carrying the bell a few pixels taller,
> so the bell has room — and in today's colours; the demo's counter
> tab shows its kitchen tab's ACKs; and a kitchen changing its filter rings nothing
> and makes no order Edited or Cancelled, on its own screen or on the counter's
> bell — what it stops showing leaves quietly and returns quietly, and what it newly
> shows but never acknowledged waits silently for ACK.

## Why

The kitchen tablet (#70) calls the cooks with a ring until somebody presses ACK.
The counter cannot see whether that happened. A biller handing over a ticket, or
asked "has the kitchen got my order?", has to walk to the kitchen or shout.

The owner wants more than an answer to that question: **a habit**. A bell that
keeps swinging on the counter until the kitchen presses ACK gives the biller a
reason to remind the cooks to press it, and a kitchen that is reminded presses it
sooner next time (owner, 2026-10-09). The bell is chosen for that — it is what the
kitchen is hearing, and it stops moving the moment the kitchen answers.

The rail is also the counter's last surface that does not look like the kitchen's
tickets, which the owner liked enough to ask for the same look here, provided no
card grows and no new colour appears.

## What Changes

### The bell

- **Every order on the rail that a kitchen shows carries a bell** in the space
  beside its dishes, under the customer button and above the ⋮ button — space the
  card already has, so no card grows.
- **Orange and swinging** while any kitchen that shows a dish of the order has not
  pressed ACK on its current version. **Gone** once every such kitchen has — its
  space kept, so nothing on the card moves; a grey bell on every quiet card said
  nothing worth the noise (owner, on trying it, 2026-10-09). An edit at the counter that changes what a kitchen shows sets it swinging
  again; an edit touching only another kitchen's dishes leaves that kitchen's
  answer standing, as on the kitchen's own screen.
- **One dot per kitchen on shift** under the bell while it swings — one kitchen
  included (owner, 2026-10-09): orange for a kitchen still to press ACK,
  grey for one that has. **A kitchen's dot is always in the same place**: kitchens
  are placed in the order of their tablets' names, and an outlet's kitchen that has
  no dish in this order leaves its place empty. When the bell stops, the dots
  disappear and nothing else on the card moves.
- **No bell at all** on any card while no kitchen tablet at the outlet holds a live
  kitchen shift, and none on an order no live kitchen shows.
- **Kitchen offline**, in words, in the counter's header, while the outlet has a
  kitchen tablet set up and none of them is on shift — the one thing the grey bell
  used to tell apart: "the kitchen saw it" from "nobody is watching". An outlet
  with no kitchen tablet never sees it.

### The header

- **The header's status becomes one segmented pill**: *Kitchen offline* when it
  applies, then the sync state, then *since 10:30 pm*. It replaces a sentence —
  "Open since 22:30:00. Ended from the operator's own phone, or at this outlet's
  cutover." — that took most of the header's width on a tablet; how a shift ends
  is now said on the Hand over screen, where it is asked. The two buttons are a
  little smaller (owner chose this among four designs, 2026-10-09).
- No words: the bell, its swing, the dots and their colour say it. A screen reader
  hears which kitchens have and have not pressed ACK, by name.
- Within seconds of a kitchen pressing ACK, the counter's bell stops.

### The ticket look

- Rail cards take the kitchen ticket's **torn top edge**, its **number face** and
  its **dish counts in small tiles**.
- **Today's height** for every card — except that a one-dish card carrying the
  bell grows by about 6px, so the bell and its dot sit centred between the
  customer and ⋮ buttons with a little air (owner, on trying it, 2026-10-09) —
  and only the colours the app already
  uses.

### Demo

- In demo mode a kitchen tab's ACK stops the bell in a counter tab, as orders
  already travel between the two.

### A kitchen's filter is a view (added 2026-10-10)

Cooks reported that changing a kitchen's filter rang an order they had acknowledged
as *Cancelled*, and that once they pressed ACK the order never came back when they
changed the filter back, though nobody had touched it. Reproduced, along with two
quieter cases: hiding part of an order, or showing more of one, rang it as *Edited*.
The bell above restates the kitchen's rule, so every one of these also swung the
counter's bell. The owner asked for the fix to land here (design D7).

- **Changing the filter never makes an order Edited or Cancelled.** What a kitchen
  acknowledged is compared through the filter it has now, so dishes it stops showing
  leave the comparison quietly, and an order with nothing left on show leaves the
  board with nothing to ACK — and comes back, quiet, when the filter shows it again.
- **Cancelled stays an alarm for what happens to the order**: cancelled at the
  counter, or every dish this kitchen shows removed there.
- **Showing more asks for an ACK, silently.** Orders and dishes the kitchen never
  acknowledged read New or Edited and wait for ACK, so the counter's bell keeps
  swinging for food nobody here has seen — a kitchen taking over another's dishes is
  the case — but nothing shakes or rings: the cook who saved the filter is looking.
  An order the counter saves at the same moment still rings.
- **The counter's bell follows**: a kitchen changing its filter never sets it
  swinging for dishes that kitchen has answered for.

## Non-goals

- **Nothing for cancellations.** A cancelled order leaves the rail at once; whether
  the kitchen has seen the cancellation stays on the kitchen's screen (owner).
- **No action from the counter on the kitchen**: the counter cannot press ACK, ring
  the kitchen again or silence it.
- **No bell off the counter.** A manager's views of open orders are unchanged.
- **No sound on the counter.** The bell is silent; the kitchen rings.
- **No new colour**, no new card row, no taller card.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the rail's card: the bell, its
  dots and the ticket look; the counter header's status pill and *Kitchen offline*.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — a
  counter shift reads which kitchen tablets have acknowledged its outlet's orders.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — `counter_kitchen_marks()`;
  `kitchen_board()` reading acknowledged lines through today's filter, and its
  `filterChangedAt`.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md), the kitchen screen — changing the
  filter rings nothing; what it brings into view waits silently for ACK.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — the counter listens to
  the kitchen pulse, and what bumps it.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — the demo mirror carries the
  kitchen's acknowledgements.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *Kitchen bell*.
