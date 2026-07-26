# Proposal: daily-cash-live

> **Model**: Fable · **Wave**: E · **Depends on**: #10, #11 · **Gate**: expected closing matches the invariant from snapshotted inputs; entering actual cash shows the difference with the correct sign; **a bill syncing after close raises a reconciliation exception instead of rewriting a signed-off day**; surface promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the day-close screen from #7 real and promote its gate, not to redesign it.

## Why

**The payoff of the whole billing chain** — the screen that answers "is the drawer right?", which is the question the app was commissioned to answer.

It keeps its own change at every level of consolidation because it contains the subtlest rule in the system: **a number a human has signed off must never change by itself.** That rule deserves its own gate rather than being buried in a bundle.

## Scope

- The daily cash record per outlet per business date, with the invariant from `docs/GLOSSARY.md`:
  `expected_closing = opening + cash_sales − cash_expenses − cash_withdrawn`
- Opening float entry; cash sales and cash expenses derived; withdrawals recorded separately.
- Actual closing entered by a human, difference shown prominently the moment it is entered.
- **Closing the day snapshots the derived inputs** rather than leaving them to be recomputed on read.
- **Reconciliation exceptions** — a bill that syncs after its business date was closed is surfaced against that day's record with what arrived and how it changes the expected figure. The manager reopens and re-closes, or accepts with a note.

## Non-goals

- No bank deposit tracking or till-float denomination counting.
- No automatic correction of a closed day. Ever.

## Design questions to settle during `/opsx:propose`

- What reopening a closed day does to the previous snapshot — it should be preserved, not replaced, or the audit value is lost.
- Whether a day can be closed while an outlet has a known-pending outbox on a device, and what the manager is told.
- The sign convention for difference, asserted explicitly in tests. Short is negative; this is exactly the kind of thing that silently inverts.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DATA_MODEL.md` (daily cash section), `docs/OFFLINE_AND_SYNC.md` (the late-bill rule, once it is real).
