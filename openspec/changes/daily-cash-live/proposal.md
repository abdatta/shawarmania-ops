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
- **May the owner close a day or record a withdrawal at an outlet they do not manage?** Today: no, by decision (#22). Cash closing and withdrawals are granted only by a live Franchise Admin assignment at that outlet, and the refusal comes from the database rather than from a hidden button; the owner's remote path is non-cash only. The owner reaches the drawer by assigning themselves as that outlet's manager, which is one action and states the arrangement in the data. **The owner wants this reopened here** (2026-08-01): where an outlet has no dedicated manager, the owner is its de facto admin and appointing themselves reads as paperwork. Settle it in this change, since it is this change's boundary. What has to be answered:
  - **A role rule, or an outlet fact?** Either the owner role reaches every drawer, or an outlet can be marked as having no manager and the owner inherits that one drawer while it stays that way. The second is narrower and keeps the day's sign-off attributable, which is the reason the boundary exists at all: a cash count is a claim by whoever counted the cash.
  - **What does the record say?** A day closed by the owner remotely and one closed by the manager at the counter must not read the same. Attendance approval already solved a version of this: the act is allowed, and whether the person was on site is recorded and shown.
  - **Reason, position, or neither?** Approval asks for a reason when the approver is off site. A cash close is a stronger claim than an approval, so the same test is at least arguable.
  - **What happens when a manager is later appointed?** An inherited drawer has to end cleanly, and days already closed have to stay explicable.
  - What already exists for it: the owner self-assignment carve-out, the owner's non-cash remote write path with its policy coverage, the managed-versus-visible distinction the cash surface already uses to show the day while offering neither the close nor a withdrawal, and `closed_by` on the record.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DATA_MODEL.md` (daily cash section), `docs/OFFLINE_AND_SYNC.md` (the late-bill rule, once it is real).
