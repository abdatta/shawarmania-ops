# Proposal: keypads-take-a-physical-keyboard

> **Model**: Opus · **Kind**: small counter correction, not a roadmap change ·
> **Gate**: on a counter with a physical keyboard, every billing number pad —
> payment, points, discount, table, customer phone — takes typed digits,
> Backspace and Enter exactly as it takes taps; a held Enter confirms once; a
> touch screen never raises its own keyboard; the pinning tests fail on the tree
> before the change.

## Why

Some counters bill from a laptop, or a tablet with a keyboard attached. Every
number in the billing dialogs is entered on an on-screen pad, so a biller with
a keyboard under their hands still has to reach for the screen or the mouse for
every digit [owner, 2026-10-06]. The pads deliberately carry no text field, so
a touch screen never raises its own keyboard over them, and that must stay true.

## What Changes

- The shared `Modal` routes physical keys to a pad's own buttons, marked with
  `data-keypad-key`: a digit (top row or number pad) presses that digit's key,
  `.` the decimal key where the pad has one, Backspace the delete key, and Enter
  the dialog's primary action. A key the pad has disabled stays disabled, so
  every existing limit (digit counts, the balance, the 100% cap) holds unchanged.
- A held Enter confirms once and no more, so it cannot carry through into the
  dialog that opens next. One Enter never fires both the primary action and a
  key the mouse last left focused.
- Typing in a real field (the customer's name), a key with a modifier, and
  Enter on a control reached with Tab all keep their ordinary behaviour.
  Escape already closes the native dialog.
- The five billing pads mark their keys: payment, points, discount, table and
  customer phone.

## Non-goals

- No visible hint that typing works [owner, 2026-10-06].
- No shortcut for anything that is not a key on the pad, such as Cash or UPI on
  the payment dialog, or a discount's unit.
- No change to what any pad accepts.
