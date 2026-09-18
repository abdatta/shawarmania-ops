# Proposal: The Ticket Is Two Switches

> **Model**: Opus · **Wave**: E · **Depends on**: #45, #35 · **Gate**: a biller
> works the whole outlet's pipeline as **one list**, newest order at the top,
> where recording preparation or payment changes the card's colours and moves
> nothing; every card carries the same two controls in the same two places —
> **Prepared** then **Paid**, each a checkbox in a button, each keeping its word
> whatever the order's state — so nothing renames itself to Reprepare or Un-pay
> and no separate Paid badge is needed to say what a ticked box already says; an
> unchecked box is drawn in the colour its state would take and a checked one
> floods its button with that colour, legible in both themes and distinguished by
> shape as well as colour; a ticket leaves the rail only when both boxes are
> ticked, flying to Bills this shift as it does today; orders hidden above or
> below the fold are announced by a floating chip that scrolls to them, and the
> chip says when prepared work is waiting for money out of sight; **a payment on
> an order whose food is still being made can be taken back, corrected or
> cancelled however long ago it was paid**, the five-minute clock starting only
> when the ticket is finished — the later of paid and prepared — computed
> identically by the database, both adapters and the screen and refused outside
> it by the database, proved by a hand-crafted request, while a bill with no order
> behind it keeps its payment-time clock; **Finish Day refuses while any order is
> paid and not prepared, naming it**, and otherwise closes the day at once,
> ending any open edit window early rather than making the biller wait it out,
> with a payment past its closed day refused; and the four-role demo walkthrough
> still walks.

## Why

Two complaints, one cause.

**The rail moves things around.** The counter's activity column splits the
outlet's unfinished work into two bands — **Preparing** above a labelled divider,
**Unpaid Prepared Orders** below it — so a card's band *is* its preparation
state. The Kalyani biller reports the consequence: orders move, and they cannot
tell what just happened. They are describing one tap that changes four things at
once — the card's position, both button labels, the buttons' order, and their
colours. Every one of those is a signal; together they are noise, and the eye has
to re-find a card it was already looking at. The bands cost space too: each
claims a share of the panel in proportion to its work, so a rail holding two
orders draws two cards and two large empty rectangles.

**The undo dies before the job is done.** A payment can be taken back for five
minutes, measured from the moment the money was recorded. At a counter where
customers pay when they order, that clock runs while the food is still being
made. A customer orders and pays upfront, the shawarma takes eight minutes, the
biller notices at minute six that they tapped Cash for a payment that came by
UPI — and the undo is already gone. The order is not prepared, not handed over,
not finished in any sense the counter recognises, and the only way back is a
manager void and a re-ring. Upfront payment is ordinary and food takes longer
than five minutes, so this is not an edge case.

The cause is the same in both. An order answers **two independent questions** —
is the food made, is it paid — and has done since #45, where `prepared_at` and
`status` were deliberately built as separate facts. The screen expresses those
two switches as three sections and four button variants; the clock treats one
switch as if it ended the whole ticket. Both are translations of a simple fact
into a harder one.

Draw the two switches as two switches, and let the ticket count as finished only
when both are thrown. The rail stops moving, the labels stop changing, and the
undo lives exactly as long as the job does.

The two halves also settle each other. A card sits in the rail only while it is
*not* both prepared and paid, so under the new clock **every ticked Paid box in
the rail is untickable** — the checkbox never lies about what it will do. Drawn
separately, the rail would have needed a special chrome-less state for a payment
whose window had expired under it. Together, that state never occurs.

One contradiction gets cleared on the way. The Finish Day sheet tells the biller
that a recent payment is *not* a blocker and offers to finish now; a trigger in
the database refuses the day close for five minutes after any payment, and
nothing in the app handles the refusal. The owner's decision is the one the
screen already promises: **closing the day ends the undo window early.**

## What Changes

### The rail

- **One list, not two bands.** A single scrolling list of the outlet's unfinished
  orders, newest first — the order it already reads in. The divider, the two band
  scrollers and the proportional height-sharing between them are deleted. A
  card's position never encodes its state.
- **Two checkboxes in two buttons, fixed.** Every card carries **Prepared** on
  the left and **Paid** on the right, in that order, at that size, whatever the
  order's state. The labels are constant: **Reprepare** and **Un-pay** cease to
  exist as words.
- **Colour states the fact rather than the next step.** An unchecked box is
  outlined in the colour its state would take — ember for Prepared, green for
  Paid — on an otherwise ordinary secondary button. Checking floods the whole
  button with that colour and redraws the box and its tick in that button's own
  foreground token, so the mark stays legible on the fill in both themes.
- **The Paid badge goes.** A ticked Paid box says what the badge said, in the
  place the biller is already looking.
- **A floating chip announces what is off screen.** `↑ 2 more` at the top edge
  when orders are hidden above, `↓ 4 more` at the bottom when hidden below, each
  appearing only when there is something to announce and scrolling to that end
  when tapped. The bottom chip carries a small green marker when any hidden order
  is prepared and still unpaid — the one thing the deleted divider said that
  nothing else on the new rail would.
- **Saving an order returns the rail to the top**, so the order just taken is
  always the visible one.
- **The only animation left is the one that means something.** Cards no longer
  fly between bands, because there are no bands. The flight into Bills this
  shift, which marks a ticket actually finishing, stays exactly as it is.

### The clock

- **The deadline becomes the later of paid and prepared, plus five minutes.**
  While an order's preparation is unrecorded, its payment has no deadline and
  stays reversible.
- **Three actions share that deadline and move together**: taking a payment back,
  cancelling after payment, and correcting the Cash/UPI split. One rule, computed
  the same way in the database, in both adapters and on the card, because a
  screen that disagrees with the server is how a refusal arrives with no warning.
- **A bill with no order keeps today's rule.** A direct sale has no preparation
  to wait for, so its clock still runs from payment.
- **A bill whose order is not yet prepared shows its correction affordance with
  no countdown**, because there is nothing to count down to yet. The countdown
  appears when the clock starts.
- **Finish Day blocks on an order that is paid and not prepared**, and says so in
  those words rather than counting it as an open order or as a recent payment.
  Closing a day while a paying customer is still owed food is wrong on its own
  terms, and under the new clock it would also leave an undo open behind a closed
  day.
- **Closing the day ends any open edit window early.** The trigger that refuses
  the day close for five minutes after a payment is withdrawn, and what actually
  stops a later take-back is stated and tested: a closed shift issues no
  commands. The Finish Day sheet keeps its recent-payment note, which becomes
  true rather than contradicted.

## Capabilities

### Modified Capabilities

- `counter-billing`: the activity rail becomes one list; a card's two states are
  carried by two fixed checkbox controls rather than by its section and its
  button labels; stage animation is reduced to the settlement flight; the rail
  announces the work outside its viewport; the take-back, cancel-after-paid and
  tender-correction windows are all measured from completion rather than from
  payment; and Finish Day gains a blocker and loses a contradiction.
- `billing-command-contract`: the two unwind commands and the correction command
  compute their deadline from the order's preparation as well as the bill's
  payment time.

## Non-goals

- **No change to the five minutes themselves.** The duration is not under review;
  only the moment it starts from.
- **No change to what any command does.** Prepare, reprepare, pay and take-back
  keep their payloads, their offline behaviour and their attribution. Money is
  still append-only: a take-back is a void plus a reopened order, a correction is
  an appended revision, and no row is edited in place.
- **No new authority.** Nobody gains the ability to reverse a payment they could
  not reverse before; an operator who could act on their own till's order still
  can, and nobody else still cannot. Manager void and re-ring remain the path for
  everything outside the window.
- **No change to ownership.** Another till's order stays visible and refused,
  with its till named, exactly as #35 left it.
- **No change to preparation's own guards.** A paid order still cannot be
  un-prepared; that rule was set at #45 and nothing here leans on it changing.
- **The standalone Open orders page and the manager's history keep their
  headings.** The rename question was settled by the owner at #45 and is not
  reopened.
- **No kitchen screen.** The single list is the shape a kitchen display would
  mirror one day; building one is not in scope.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the Counter's **Open orders**
  section, which still describes this tablet's orders as preparation cards with
  one primary action; the three-column description that names the rail's divider;
  the tender-correction paragraph, which states the deadline as five minutes from
  payment; and the Finish Day blockers.
- [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md) — the checkbox-in-a-
  button control, its two token pairs, and the rule that a state which cannot be
  changed is drawn without button chrome rather than disabled.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — what now stops a day from
  closing, and what closing one does to an open edit window.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — the payment-edit deadline
  as a derived value over two columns rather than one.
