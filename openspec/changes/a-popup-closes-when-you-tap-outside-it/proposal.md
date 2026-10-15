# Proposal: A Popup Closes When You Tap Outside It

> **Model**: Sonnet · **Kind**: interaction correction, not a roadmap change ·
> **Gate**: with the change gate on, a press and release on the dimmed space
> outside any pop-up closes it, in the same way its Close button does; a press
> inside the pop-up that ends outside it, a tap on the pop-up's own padding, and
> a second tap of a double-tap on the button that opened it do not; a pop-up
> opened over another closes alone; a pop-up that is mid-save stays open; every
> menu and list that already closed on an outside pointer still does; with the
> gate off, every pop-up behaves exactly as it does today; both states are
> proved in a real browser and in unit tests, phone and tablet, light and dark.

## Why

Most pop-ups in the app do not close when you tap the dimmed space around them.
You have to find the pop-up's own Close, Cancel or Back button, or press
Escape on a keyboard the counter does not have. The owner's words (2026-10-14):
"I kinda dislike that a lot of our popups today do not dismiss when I click on
empty space outside the popup."

Nobody decided this. A search of `docs/`, the specs, and every archived design
turns up no reason against it. What it finds is the opposite assumption: the
comment on `Explain` and an archived design both say *Escape, focus containment
and backdrop dismissal come from `<dialog>`*. Two of the three are true. The
browser's `<dialog>` closes on Escape and contains focus, and does **not**
close when its backdrop is tapped (it takes a newer `closedby` attribute to ask
for that, which not every browser supports). So every pop-up in
the app inherited a behaviour the code believed it had.

The app already requires this of its menus: `design-system` says *a menu,
popover, or other transient panel SHALL close when a pointer lands outside it*,
and the account menu, the row-actions menu, the pipeline card's menu and the
address and category lists all do. Pop-ups are the one family without it.

## What Changes

- **Tapping the dimmed space outside a pop-up closes it**, through the same
  `onClose` its Close button calls — so a pop-up that refuses to close while it
  saves (the Finish day sheet, the kitchen filter, a tablet edit, the bill
  attribution review) refuses this too, and one that records a decision on
  close (Keep this check-in) records it. It is one change in one place, the
  shared `Modal`, and reaches all of: every sheet (`FormSheet`, 32), every
  confirmation (`ConfirmDialog`, 15), and the 21 pop-ups built on `Modal`
  directly — payment, customer, points, discount, table, cancel order, take the
  payment back, receipt, QR, the explanations that open from a dotted chip,
  a dish's note, and the rest. `design.md` lists them.
- **Four things do not count as outside**, because each would close a pop-up
  the person did not mean to close: a tap on the pop-up's own padding; a press
  that starts inside the pop-up and ends outside it (selecting text in a field
  and letting go past the edge); a second press that begins within a moment of the
  pop-up opening, which is a double-tap on the button that opened it; and
  anything in a pop-up opened over another, which closes only the one on top.
- **A pop-up that is working does not close.** Every pop-up that takes a `busy`
  (the confirmations, the payment, points and discount dialogs, cancel order,
  take the payment back, cancel a paid order, the near-miss category match, and
  turning a change gate) ignores the outside tap while it is busy, whether or not
  its own Back button is also disabled then. So does every sheet with a save in
  flight — Count & Collect, Fix this count, Add person, Finish day and the rest —
  through `FormSheet`'s own `busy`.
- **The iOS "Install" hint closes on an outside tap too.** It is the one
  transient panel outside a menu or a pop-up that stayed open until its own
  button was pressed again.

## Change gate

**`outside-tap-closes`**, code **`OT`**, depends on nothing.

- **On:** Tapping the dimmed space outside a pop-up closes it, the same as its Close button.
- **Off:** A pop-up closes only from its own buttons or Escape, as it does today.

Off is today: the shared `Modal` attaches nothing when the gate is off, and the
install hint's listener is not added. The gate exists because this reaches the
counter. A tap that lands a finger-width outside the payment dialog now closes
it, and if billers report that happening, the owner turns this off from their
phone in seconds rather than waiting for a build.

## Non-goals

- **No "discard your changes?" question.** A sheet with typed text closes on an
  outside tap exactly as it does on Escape or its Close button, discarding what
  was typed. `design.md` records why a guard was not built, and what it would
  take.
- **No change to Escape.** Escape still closes a pop-up that is mid-save, which
  the sheets' own guards do not stop. Pre-existing, and a different change.
- **No new pop-up, no new close button, no change to any pop-up's contents.**
- **No change to menus and lists** (account menu, row actions, pipeline card
  menu, address and category lists), which already close on an outside pointer.
- **The banners that must not be dismissed stay that way**: the demo banner and
  the kitchen's *Out of sync* and *Sound is off* alerts.
- **No database change beyond the gate's own row.** No policy, table, or
  function.

## Docs

- `docs/DESIGN_SYSTEM.md`, component conventions: how a pop-up closes, and what
  does not count as outside.
- `docs/SCREENS.md`: one line under the counter's dialogs, since the biller
  will meet it first.
