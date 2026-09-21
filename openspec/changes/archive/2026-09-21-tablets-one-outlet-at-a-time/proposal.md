# Proposal: tablets-one-outlet-at-a-time

> **Model**: Opus · **Roadmap**: deliberately unlisted — this narrows a shipped
> surface rather than sequencing new capability, so it takes a change folder and
> no row · **Gate**: Tablets opens on one outlet and shows only that outlet's
> tablets; the outlet picker replaces the choice rather than adding to it, and
> the outlet standing there cannot be un-chosen; the outlet's name is not printed
> as a heading above its own tablets, because the chosen chip already says it; a
> tablet moved to another outlet leaves the list, and the move confirmation is
> what said it would; a person who may see one outlet is offered no picker at
> all; a wider selection held by Attendance survives a visit to Tablets; the
> address `devices/:outletId` still opens on the outlet its card named; and the
> four-role demo walkthrough still walks.

## Why

Tablets reads several outlets at once. It has since `attendance-one-day-per-person`
gave the outlet picker a multi-select mode, and the reason recorded in the code is
the owner's, from 2026-08-09: *"is every counter healthy?" is a question about the
business rather than about one shop, and answering it by switching outlets one at
a time is how a tablet that stopped reporting two days ago goes unnoticed.*

That reasoning was right for the business it was written about — two owner-run
shops, one tablet each, one flat list. Two things have moved since.

**`multiple-billing-devices` (#35) made an outlet hold several tablets.** The
screen is now two levels deep — outlet, then its tablets, then the next outlet,
then its tablets — and the thing the reader came for is somewhere inside that. A
list that was six lines is now a page you scroll. The `app-shell` contract sees
this coming and says a surface reading several outlets at once *"SHALL show the
combined result as one list rather than one list per outlet"*; Tablets groups by
outlet instead, because a flat list of tills is unreadable. It has been the one
multi-outlet surface that could not honour that clause, which is the contract
saying this surface does not want to be multi.

**The question multi-select answered is losing the person who asked it.** Near
term the business is converging on a single outlet, so every tablet sits under it
and the picker is not rendered at all. Beyond that, further outlets are expected
to be franchise-owned — and watching every counter across every franchise at once
is not the owner's job then; each franchisee minds their own. The owner reached
this on 2026-09-20 and asked for the reversal.

**Nothing is lost that was not cheap to get back.** The cross-business health
question is already answered better elsewhere: the Outlets surface carries, on
each outlet's own card, exactly the three conditions this screen was being
watched for — no tablet at this counter, a tablet that has not reported in, a
tablet holding bills it has not managed to send (#51). And switching outlets here
is one tap on a chip that is already on screen.

So the 2026-08-09 decision is not being overturned as a mistake. The shape under
it moved, and this records the move.

## What changes

**Tablets reads one outlet.** The outlet picker renders in its single-select
mode — the same chips in the same place, but a tap replaces the choice instead of
adding to it, and the outlet you are looking at is the one you cannot press. This
is the mode every other single-outlet surface in the app already uses, so the
control does not change shape as the owner walks between screens.

**The outlet's name stops being a heading.** It was there to keep two shops'
tills apart when they were stacked. With one outlet on screen it repeats the
chosen chip immediately above it, so it goes.

**A tablet moved to another outlet leaves the list.** It used to hop to the other
group and be watched landing. Now it is at the other outlet, and the outlet on
screen is not that one. The move confirmation already says this before it
happens — *"will leave Shawarmania Kalyani and join Shawarmania Kanchrapara"* — so
the disappearance is the confirmed thing occurring, not a surprise. Following the
tablet across would silently move the reader to an outlet they did not choose.

**Everything else is untouched.** Every tablet at the chosen outlet is still
listed, an outlet with none still says so by name, every action still names the
one till it acts on, and the reader's authority still comes from the database.

## Non-goals

- **Not a change to what anyone may read or write.** The picker is a filter and
  confers nothing; `readDeviceOperations`, `issueSetupCode`, `editDevice` and
  `removeDevice` are unchanged, and the database still refuses another outlet's
  tablets whatever is selected.
- **Not a change to the shared outlet-scope contract.** `app-shell`'s requirement
  already describes both modes and names no surface. Attendance keeps its
  multi-select, and a wider remembered selection still survives a visit here,
  because a single-outlet surface reorders that selection rather than truncating
  it.
- **Not a redesign of the surface.** No card, no sheet, no confirmation and no
  telemetry line changes.
- **No migration, no policy, no money arithmetic, no offline path.**
- **Not a removal of the multi-select mode itself.** The hook keeps both modes;
  only this surface's request changes.
- **Not a new "which outlet is this tablet at now?" affordance** after a move.
  The confirmation carries that.

## Docs to update before archiving

- `docs/SCREENS.md` — the Tablets description (it says *"at each outlet in the
  reader's scope, grouped by outlet"*), and the outlet-switcher paragraph that
  names which screens read several outlets at once.
- `openspec/specs/counter-device-sessions/spec.md` — via the delta in this
  change folder.

## How to run the gate

- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- `npm run test:e2e` against the production build.
- In the browser, signed in as the owner with two outlets: open Tablets from an
  outlet card, confirm only that outlet's tablets are listed and no outlet name
  is printed above them; tap the other outlet and confirm the list replaces
  rather than grows; confirm the chosen chip cannot be un-tapped; move a tablet
  to the other outlet and confirm it leaves the list; open Attendance and confirm
  a two-outlet selection made there is still two outlets.
- The four-role demo walkthrough.
