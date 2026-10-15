# Design: A Popup Closes When You Tap Outside It

## The survey

Every pop-up in `src/` is the shared `Modal` (`src/components/ui/modal.tsx`, a
native `<dialog>` opened with `showModal()`), or a wrapper over it. There is no
second modal implementation, no hand-built overlay, and no `role="dialog"` div.
So "find them all" has one answer for the dimmed-backdrop kind, and a short list
of everything else.

**On `Modal` — none of them closed on an outside tap:**

| Family | Call sites | Examples |
|---|---|---|
| `FormSheet` — a bottom sheet on a phone, a side sheet on a tablet | 32 | Add person, Add expense, Count & Collect, Fix this count, Edit outlet, Finish day, What this kitchen shows, Compare periods |
| `ConfirmDialog` | 15 | Start the demo again, delete a category, the tablet confirmations, the outlet confirmations |
| `Modal` directly | 21 | Record payment, Customer, Receipt and points, Use points, Discount, Which table, Cancel order, Take this payment back, Cancel this paid order, order customer details, Review bill attribution, View receipt, the QR enlarged, `Explain` (every dotted chip), the near-miss category match, turn a change gate, a dish's note (two, from #74) |

**Not on `Modal`, and already closing on an outside pointer** (the `design-system`
requirement *A menu closes by clicking away*): the account menu, the row-actions
menu, the pipeline card's menu, the address-search list, the category input's
list. Nothing to do.

**Not on `Modal`, and not closing on an outside tap:** the iOS install hint,
a bubble that opens from the Install button and closes only from that button.
Included.

**Deliberately not dismissible, left alone:** the demo banner and the kitchen's
*Out of sync* and *Sound is off* alerts (`docs/SCREENS.md`). They are not
pop-ups the person opened.

**Not pop-ups:** the phone's bottom navigation card (navigation that stays
open while you are inside its group), `<details>` disclosure rows, the
`role="status"` messages.

## Why nobody had it

No design, spec or doc decided against it. `why.tsx` and
`2026-08-29-cash-is-counted-not-closed/design.md` both say backdrop dismissal
*comes from `<dialog>`*. It does not: a modal `<dialog>` takes Escape from the
platform and focus containment from the top layer, and a click on its `::backdrop`
is just a click whose target is the dialog. Chromium behaves so (pinned now by
`e2e/dialog-escape.spec.ts`); a `closedby="any"` attribute asks for the other
behaviour and is not in every browser. The first test in `e2e/dialog-escape.spec.ts`
proved Escape and nobody wrote the matching proof for the backdrop, so the belief
survived.

## Decisions

### D1. One place: the shared `Modal`

The handler lives in `Modal`, so the 68 call sites get it with no edit, a pop-up
added next month gets it with no thought, and the gate has one toggle point. The
alternative, an opt-in prop passed at each site, would leave the behaviour
exactly as inconsistent as today wherever somebody forgot — which is how it got
here.

`Modal` reads the gate itself (`useChangeGate('outside-tap-closes')`). With the
gate off it attaches no handler, so the element it renders has the same props as
before.

### D2. What counts as outside

A native dialog's `click` target is the dialog element for a tap on the
backdrop **and** for a tap on the dialog's own padding (`p-4` on most of these).
Comparing `event.target` to the dialog is therefore wrong: it would close the
pop-up when someone taps the space beside a button. The test is a position test:
the click's `clientX`/`clientY` against the dialog's `getBoundingClientRect()`.

On top of that, three guards, each of them a real way to close a pop-up that
nobody meant to close:

1. **The press must also have started outside.** `pointerdown` records whether it
   landed on the backdrop; the click closes only if that is true. Without it, a
   drag that selects text in a field and is released past the sheet's edge
   closes the sheet — the browser reports the click on the nearest common
   ancestor, which is the dialog.
2. **`event.target === event.currentTarget`.** A pop-up opened over another is
   the dialog's React child, or portalled but still its React child, and React
   bubbles the event up that tree. The outer dialog sees a click whose target
   is the inner one and ignores it, so the inner closes alone (the same trap
   `Modal`'s `onClose` already stops, see its comment).
3. **A grace period of 400 ms after it opens.** The counter's tablets are tapped
   fast. A double-tap on *Pay* opens the payment dialog on the first tap and
   puts the second one, a hundred milliseconds later, on a backdrop that was not
   there when the finger came down. Without the grace the dialog flashes and is
   gone, which is worse than the problem being solved. It is measured from
   `showModal()`, with `performance.now()`, and read at `pointerdown`: what
   matters is when the press began, so a press begun in the grace and held past
   it still closes nothing. Each opening also forgets a press the last one saw
   cancelled (a touch that became a scroll sends `pointerdown` and no `click`).

### D3. Close through `onClose`, not `dialog.close()`

An outside tap calls the `onClose` prop, as the Close button does. Closing the
element directly (or `requestClose()`) would run through the native `close`
event, and two things in this repo depend on `onClose` being the only way out:

- Sheets that refuse to close while they save pass `busy ? () => undefined :
  onClose` or an inline `if (!busy)` (`finish-day-sheet.tsx`,
  `kitchen-filter-sheet.tsx`, the tablet edit in `outlet-tablets.tsx`, the
  attribution review in `manager-bill-detail.tsx`). Called directly, the guard
  holds: the pop-up stays open. Closed natively, the element would shut while the
  component still believed it was open, which is what Escape's native close does
  whatever `onClose` then does, and is not repeated here.
- `check-in-card.tsx` closes with `onKeep`, a recorded decision. The outside
  tap makes the same decision Escape does.

### D4. Working pop-ups ignore the tap

`Modal` takes `dismissOnOutsideTap` (default true), and every pop-up that takes
a `busy` passes `!busy`: `ConfirmDialog`, the payment, points and discount
dialogs, cancel order, take the payment back, cancel a paid order, the near-miss
category match, and turning a change gate. Some of them leave their own Back
button live while busy (the payment dialog does), so the rule is not "what the
buttons do": a stray tap is likelier than a press on Back, and the tap is the
one a request in flight should not meet. This is the only opt-out in the change.

`FormSheet` takes the same `busy` and passes it on, and every sheet with a save
in flight gives it the state that disables its submit button: Count & Collect,
Fix this count and the adjustment in the cash drawer, the four account sheets,
Finish day, both tablet sheets, the expense and category sheets, the kitchen
filter, the menu's item, rename, discount and highlight sheets, and the two
outlet sheets. The cash count is the one that matters: a tap that closed it
mid-save cleared what was counted, and a refused save then had nothing left to
correct. The sheets in `outlet-attendance.tsx` close the moment they submit, so
nothing is in flight while they are open. The customer card keeps its `busy`
inside its body, below the `Modal`, and is not covered: a tap mid-rename closes
the card while the rename still lands. Its gold change is behind its own
confirmation, which is covered.

### D5. Typed work is discarded, like Escape does

A sheet with typed text closes on an outside tap and the text is gone. That is
what Escape and the Close button already do to it (`closeSheets` in the cash
drawer clears every field), so the change adds no new loss; it adds a bigger
target for the loss. The realistic accident is a person on a phone tapping blank
space to put the keyboard away and hitting the strip of screen a sheet leaves
uncovered (at least 15% of it, since a sheet holds at most 85% of the height,
and more under a short sheet). A sheet whose save is in flight ignores the tap
(D4), so the loss is only ever of work not yet sent.

Rejected, with reasons:

- **A "discard what you typed?" question.** The usual answer to this, and the
  right one for a long form. It is also a second dialog over a first for every
  one of 32 sheets, each with its own idea of "typed"; none that was read keeps a draft.
  Not built into a change whose point is fewer taps to dismiss.
- **A generic "has anything been typed" guard in `Modal`** (set on the first
  `input` event, then ignore outside taps). It needs no per-site work, but it
  misfires on sheets that are pickers (*Dates*, *Compare periods*, *What this
  kitchen shows*), where changing a control is not work worth protecting and a
  pop-up that stops closing after you touch it is the original complaint again.
- **Opting the heavy forms out** (Count & Collect, Add outlet). A list of
  exceptions to the rule the owner asked for, chosen by guess.

If billers or managers lose work to this, the gate is the answer first and a
draft-preserving close is the answer after; either is a separate change.

### D6. The install hint

It is a bubble, not a modal, so it takes the same document-level `pointerdown`
the menus use (`account-menu.tsx`), added only while the hint is open and only
with the gate on.

## Rejected alternatives for the mechanism

- **`closedby="any"`.** No JavaScript, but the counters' browsers do not all
  honour it, and a behaviour that works on the owner's laptop and not on the
  tablet is the worst kind to gate.
- **An invisible full-screen button behind the panel.** Reaches `::backdrop`
  without coordinate maths, but changes the DOM of 66 pop-ups, puts a stray tab
  stop in each, and breaks the tests that look for "the last Close on screen".
- **Closing on `pointerdown`.** Faster, but a tap that begins a scroll or ends
  on a button would close before it could be cancelled, and `click` is what
  every other close in the app is.

## Contract, money, offline, tenancy

- **Database.** Only the gate's own row in `change_gates`. No table, policy,
  function, trigger or view; no tenancy change, no isolation test owed.
- **Version skew.** The migration inserts one row and nothing else, so a build
  published before it never reads the row and runs as it did. A build published
  with it reads the gate; unknown is off. Republishing an earlier build against
  the new schema is safe for the same reason.
- **What turning the gate off does to what the new path persisted.** Nothing:
  the new path persists nothing. `roundTrip: 'none: …'`.
- **Money, offline.** Untouched. The outbox is not involved and the payment
  dialog's contents and its `onConfirm` are unchanged.
- **Request budget.** No request is added.

## Verifying it

A unit test per rule in D2 and D4, both gate states. A browser test with a real
click on a real backdrop, in both suites' states, on a phone and a tablet
viewport. The first test in `e2e/dialog-escape.spec.ts` gets a sibling that
asserts a bare `<dialog>` does **not** close on a backdrop click, so the platform
assumption this change corrects cannot come back unnoticed.
