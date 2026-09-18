# Design: The Ticket Is Two Switches

## The fact this change is built on

An order in the pipeline answers two independent questions:

| | `prepared_at` | `status` |
|---|---|---|
| **Question** | is the food made? | is it paid? |
| **Set by** | prepare / reprepare | pay / take back |
| **Both true** | the ticket is finished | |

Neither implies the other, and #45 built the data that way on purpose. Two
places then failed to keep the promise. The rail projected the two booleans onto
**three sections plus four button variants**, and asked the biller to invert the
projection while a customer waited. The take-back clock started at payment alone,
treating one switch as if it ended the whole ticket.

Both halves of this change are the same correction: **draw two switches as two
switches, and call the ticket finished only when both are thrown.**

---

# Part one — the rail

## The card

```
┌──────────────────────────────────────────────────┐
│  #105   Demo Customer            now       ₹278  │
│  2×  Classic Chicken Shawarma                    │
│   ┌────────────────┐ ┌────────────────┐  ┌───┐   │
│   │ ☐   Prepared   │ │ ☐   Paid       │  │ ⋮ │   │
│   └────────────────┘ └────────────────┘  └───┘   │
└──────────────────────────────────────────────────┘
```

Everything above the controls is unchanged from today: reference in the brand
primary, one meta line, total at the right, complete untruncated item lines. The
`section` prop and everything it decided are gone.

**Position is fixed.** Prepared is always the left control and Paid always the
right one, at equal width, whatever either box holds. This is the whole point of
the change and no state may reorder them.

**The words are fixed.** `Prepared` and `Paid`, always. A checkbox's label names
what the box means, not what pressing it would do — which is precisely why
`Reprepare` and `Un-pay` disappear rather than being renamed. A control that
tells you the verb for its next press has to change its word every time it is
pressed, and that is the churn the biller complained about.

## Colour

| | Unchecked | Checked |
|---|---|---|
| **Prepared** | secondary button, box outlined in `--primary` | button filled `--primary`, box and tick in `--on-primary` |
| **Paid** | secondary button, box outlined in `--success` | button filled `--success`, box and tick in `--on-success` |

The mark on a filled button is drawn in **that button's own foreground token**,
never in a literal grey. `--on-primary` is white in light and near-black in dark;
a fixed grey would be muddy against the dark theme's bright flame orange and weak
against the light theme's ember. Using the pair the fill already ships with means
the mark inherits a ratio the contrast validator already gates.

Two pairings are new and must be **added to the validator** before they are
trusted: `--primary` and `--success`, each against `--surface-raised`, at the
3:1 threshold for identifying a control, in both themes. They are expected to
pass — both tokens are already gated against surfaces — but "expected to pass" is
not the standard this repo holds, and the validator is the only reader that
decides.

Colour is not the only signal: an empty square and a ticked square differ in
**shape**, which is what survives a greasy tablet in daylight and a biller who
does not see the two hues apart. This is the `design-system` requirement
*Colour is never the only signal*, satisfied by construction rather than by a
second badge.

## When a box cannot be unticked

Ticking is not always symmetric, and the drawing must not pretend otherwise.

- **Prepared** is a free switch in both directions while the order is unpaid.
- **Paid** opens the tender dialog on the way in; the tick lands when money is
  actually recorded, not when the button is pressed.
- **Paid** unticks through the reasoned take-back dialog, on the owning till.

Where a control cannot act, it is drawn **without button chrome** — no border, no
press affordance — so it reads as a fact printed on the card. It is never merely
a dimmed button: a dimmed button is a promise the screen is refusing to keep, and
billers read it as breakage.

**Only one situation reaches that state, and it is another till's order.** Both
controls become facts, and the card already names the till beside the time, which
is the sentence that explains it.

The expired-payment case does not arise, and that is part two's doing. A card
sits in the rail only while it is *not* both prepared and paid, so the only card
that can carry a recorded payment is the upfront payer whose food is still being
made — and under the new clock that payment has no deadline yet. **Every ticked
Paid box in the rail is untickable by construction.** The checkbox never lies.

This is why the two halves are one change. Split, part one would have had to
invent a chrome-less expired-payment drawing, and part two would have deleted it
a few weeks later.

## The list

One list, one scroller, `ordered_at` descending — the order the adapter already
returns and the order the rail already draws. Nothing about sorting changes.

Newest-first was reconsidered and kept, on the owner's reasoning: the order just
saved has to be under the biller's thumb, because a correction happens in the
first seconds after saving, and a list that pushed it below the fold would make
the biller wonder whether the order was taken at all. Oldest-first is the better
*queue*, and it loses to that.

What newest-first costs is that a prepared order still waiting for money sinks as
the day fills in above it. The divider used to make that visible. Its replacement
is the chip.

## The chip

Modelled on the "jump to latest" pill in a chat app, because that is a pattern
billers already know from their own phones.

- Two positions, top edge and bottom edge of the rail, each floating over the
  list rather than occupying its height.
- Each appears **only** when orders are clipped in that direction, and says how
  many: `↑ 2 more`, `↓ 4 more`.
- Tapping scrolls to that end of the list. Not by a page, not to the next card:
  chat apps jump, and a partial scroll would leave the biller re-reading the chip
  to find out whether anything happened.
- The **bottom chip** carries a small green marker when any hidden order below is
  prepared and unpaid. This is the one thing the divider said that the new rail
  would otherwise stop saying, and it says it in fewer pixels.
- Both chips are ordinary buttons with accessible names (`Scroll to the newest
  order`, `Scroll to the oldest order`), not decorations.

Saving an order scrolls the rail to the top. The list is newest-first and the
order just saved is the newest; a rail left scrolled down would hide the one card
the biller is about to check.

---

# Part two — the clock

## The rule, stated once

For a bill that settles an order:

```
deadline = prepared_at IS NULL
             ? none — the payment stays reversible
             : greatest(paid_at, prepared_at) + 5 minutes
```

For a bill with no order behind it — a direct sale rung and paid without saving
an order — the rule is unchanged:

```
deadline = paid_at + 5 minutes
```

`greatest` rather than `prepared_at`, because either fact can be the later one.
The upfront payer is prepared after paying; the customer who pays on handover is
paid after preparing. The ticket is finished when the second one lands, whichever
it was.

This expression is the whole of part two. The rest is the list of places that
currently compute `paid_at + 5 minutes`, plus the two consequences of a deadline
that can be absent.

## Where the rule lives today

| Reader | What it decides | File |
|---|---|---|
| `unpay_billing_order` | refuses a take-back | `20260826000000_refusals_name_their_order.sql` |
| `cancel_paid_billing_order` | refuses a cancel-after-paid | `20260826000000_refusals_name_their_order.sql` |
| `correct_bill_payment` | refuses a tender correction | `20260812000006_append_only_payment_corrections.sql` |
| `reject_open_payment_edit_at_finish` | refuses the day close | `20260812000006_append_only_payment_corrections.sql` |
| `paymentEditableUntil` | draws the countdown | both adapters |
| `unwindOpen` | offers the take-back on the card | `pipeline-card.tsx` |
| `inspectFinishDay` | counts editable payments | `supabase-adapters/billing.ts` |

The database readers are the authority and the rest follow. **No screen may
compute a deadline the database would not agree with**, which is why all seven
move together rather than the three that hurt.

The three refusing functions already hold the order row at the point they check
the clock, so the new expression needs no extra read. `correct_bill_payment`
works from the bill and must join through `bills.order_id`, which is nullable —
that null is exactly the direct-sale case.

## Finish Day gains a blocker

An open-ended window behind a closed day would be a hole: the day's figures are
confirmed, and a payment inside it could still be voided afterwards. The owner's
decision closes it from the other side — **Finish Day refuses while any order at
this tablet's business date is paid and not prepared**, and names it.

Today's finish refuses on `status = 'open'` only, which a paid-but-unprepared
order does not match. So this is a new blocker, not a widened one, and it is
right on its own terms: closing a day while a paying customer is still owed food
is wrong whatever the clock is doing.

The blocker is drawn like the open-order blocker, in the biller's words —
*1 order is paid but not marked prepared* — with the resolution naming the rail.

## Closing the day ends an open window early

`reject_open_payment_edit_at_finish` refuses the end-of-day confirmation while
any settled bill at that tablet and date is under five minutes old. The Finish
Day sheet, two screens away, calls exactly that situation *not a blocker* and
offers **Finish day now**. They have contradicted each other since
`append_only_payment_corrections`, and nothing in the app handles the refusal, so
a biller who closes a day quickly meets a generic failure. Found by reading
during this change's design, not by a report from the counter — it is probably
rare in practice, because counting the drawer usually outlasts five minutes.

The owner decided for the screen: **closing the day ends the window early.** The
trigger goes.

What then stops a take-back after the day is closed is not a new guard but an old
one: every billing command runs through `billing_device_context`, which requires
a live shift, and finishing the day ends the shift. That is the claim this change
rests on, so it is **proved by a hand-crafted request in pgTAP**, not asserted
here. If it turns out not to hold, the trigger is replaced by a deadline-aware
version rather than removed — that is the fallback, and it is a smaller change
than discovering the hole later.

## What a bill looks like while its order is unprepared

The live database settles a payment at once, even for an unprepared order, so the
bill is already in **Bills this shift** while its order still stands in the rail.
Today its row carries a countdown: `Edit (4 min)`, then `Edit (52 sec)`.

With no deadline yet, there is nothing to count. The row keeps the correction
affordance and drops the countdown, saying it is editable until the order is
prepared. A countdown that has not started must not be drawn as one, and it must
certainly not be drawn as expired.

`inspectFinishDay`'s editable-payment count follows the same rule: it counts
payments whose deadline has not passed, and a payment with no deadline is one of
them.

---

## Rejected alternatives

**Keep the two bands, stop the movement.** Considered first, because it is the
smallest change: keep the sections, drop the flight. It fails for the reason the
bands fail — the card still lands somewhere else, just without the animation
explaining the jump, which is worse rather than better.

**One list, green tick on both boxes.** The first drawing had every checked box
go green, on the rule *green means done*. The owner rejected it and was right:
the counter has read ember-for-preparation and green-for-money since #45, and
flattening both to one colour would spend that learned vocabulary to buy a rule
nobody asked for. Ember and green stay, meaning what they already mean.

**A coloured stripe down the card's left edge.** Considered as the at-a-glance
scan signal in place of the bands. Rejected: one stripe cannot carry two
independent booleans without inventing a third and fourth colour for the
combinations, and the two boxes are already the biggest things on the card.

**Tinting the whole card once prepared.** Rejected for the same reason in weaker
form: it re-encodes a boolean that its own box already carries, and a tinted card
plus a filled button is one fact drawn twice.

**A real checkbox input.** Rejected. Paid opens a dialog on the way in and a
reasoned dialog on the way out; a form control that fires its change event before
the change has happened would be a lie to assistive technology as well as to the
eye. These are toggle **buttons** — `aria-pressed`, with the accessible name
`Prepared` / `Paid` — whose visual language is a checkbox. Where a control is a
fact rather than a control, it is not a button at all and carries no pressed
state to misreport.

**Keeping one loud primary button per card.** Today's ember Prepared button is
the card's shout, and two equal secondary buttons are quieter. Accepted
deliberately: the rail's job at a glance is to say *what is true*, and a control
shouting *what to do next* is the thing that has to keep changing its mind. The
counter's loud control remains the menu tile and the tender dialog's confirm.

**Start the clock at preparation alone.** Simpler to write — `prepared_at + 5
minutes` — and wrong for the customer who pays on handover, whose payment would
land already expired. `greatest` costs nothing and is correct in both directions.

**Leave the window running from payment and simply lengthen it.** Ten minutes,
twenty. Rejected: it trades one arbitrary number for another, still expires while
food is being made on a slow day, and gives a *finished* ticket a longer window
than it should have. The problem is the starting line, not the distance.

**Keep the trigger and make Finish Day wait out the window.** The honest
alternative to the owner's decision, and the one the database currently
implements. Rejected by the owner: a biller closing the day is going home, and if
they wanted to undo a payment they would not be closing the day. Making them
stare at a button that refuses for up to five minutes at the end of a shift buys
a protection nobody asked for.

**Two changes instead of one.** Proposed and rejected by the owner on 2026-09-17.
The case for splitting was that the rail costs nothing to verify while the clock
costs database tests over money-reversal rules at the most consequential moment of
the day, and that either should be able to roll back without dragging the other.
The owner's case for one change won it: the clock problem is live and daily, the
two halves were found together and explain each other, and shipping the rail
first would mean building a chrome-less expired-payment state only to delete it.
**Sequencing inside the change carries the original concern** — the rail lands
first and whole, the database work second, so a stall in part two never holds
part one hostage inside the branch.

## Money, offline and isolation

- **Money**: no arithmetic changes anywhere. A void is still a void, a correction
  still an appended allocation, every figure still integer paise. What changes is
  *when* the database stops accepting a reversal, and the database remains the
  only reader that decides.
- **Offline**: the controls dispatch the same `set_order_preparation`,
  `pay_order` and `void_order_payment` commands, with the same idempotent
  envelopes and the same non-blocking acceptance. The rail's projection of a
  locally accepted command is unchanged. The offline deadline is computed from
  the same expression as the server's, from facts the tablet already holds.
- **Isolation**: no policy, grant or scope moves. Every function keeps its outlet
  and till checks ahead of the clock check, in that order, so a widened window
  never widens who may use it. The foreign-till refusal is still the database's,
  still checked in the adapter before a command exists, and now drawn as a fact
  instead of a disabled button — the third of three guards changes its
  appearance, not its authority.
