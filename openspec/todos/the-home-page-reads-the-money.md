# The Home Page Reads The Money

**Area:** Overview / Reporting · **Raised:** 1 Sept 2026 · **Type:** Feature,
and a live defect while it waits

## The defect, first

**The home page shows no figures in production.** Not some — none. It lists the
outlets and says *"Today's figures are not available yet."*

The screen was built in #8 against a mock, behind an adapter that `#13
owner-console-live` was going to fill in with real queries. `#13` was withdrawn
(`owner-console-was-withdrawn.md`), and nothing replaced that half of it. So the
real implementation still answers `null` to every question, honestly, and the
card states the absence rather than inventing a zero.

**The figures themselves exist.** Billing is live (#10), the drawer is live
(#11), the Ledger is live (#12), and the aggregator syncs are live (#42, #47).
Everything this page wants to say is already recorded — nothing reads it here.

The same absence takes down two more things:

- **The read-only outlet day view** (`owner-outlet-view`, the `Open` button on
  an outlet card) is still `demo`-gated, so in production it answers *"That page
  does not exist."* The button is there and it goes nowhere.
- **A manager's home** is the same page as the owner's since #51, so a manager
  meets the same empty card.

## What the page should become

Owner's words, 1 Sept 2026: it should mostly carry **a summary of ongoing
finances, and any alerts scoped to them**.

That is a different screen from the one standing there, so this is a redesign
rather than a wiring job — the adapter work is the smaller half.

**"Alerts" here does not mean the alert thread.** #51 deleted that capability
and did not reimplement it: what an outlet is raising is derived from rows that
already exist, and is read on the outlet's card in Setup → Outlets. Whatever
this page surfaces should be derived the same way and stay derived — a figure
nobody typed, that stops being raised when the thing it describes stops being
true. Reintroducing something a person writes and another person clears would be
rebuilding what was just removed, and
`openspec/todos/outlet-alerts-was-withdrawn.md` has the reasoning.

## Constraints it inherits

- **One page, two roles.** The owner and a manager read the same component
  since #51, and the database scopes it: every outlet for one, the assigned
  ones for the other. Whatever replaces it keeps that shape, and keeps filtering
  nothing itself.
- **Every figure is summed from rows another screen shows**, so the page and
  the counter cannot contradict each other. No figure is supplied by a caller.
- **Money is integer paise.**
- **A counted drawer is not recomputed.** Its expected figure and difference
  stay the observation's.
- **Absence is stated, never rendered as nought.** A zero reads as *you took
  nothing today*, which is a different claim from *nobody has told me*.

## Trigger to promote

It is wanted now — the owner said so on 1 Sept 2026 while reviewing #51, and
deferred it only to keep that change about navigation. It wants its own change
folder, because it is a redesign with a data-access half and a screen half.
