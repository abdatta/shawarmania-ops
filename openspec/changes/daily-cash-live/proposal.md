# Proposal: daily-cash-live

> **Model**: Opus · **Wave**: E · **Depends on**: #10, #11 · **Gate**: a date cannot be signed off until every order is paid/cancelled and every participating billing device has ended its grant with a current resolved-queue seal; expected closing uses cash payment business date; entering actual cash shows the difference with the correct sign; **a cash payment accepted after a prior seal invalidates readiness instead of rewriting a signed-off day**; surface promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the day-close screen from #7 real and promote its gate, not to redesign it.

## Why

**The payoff of the whole billing chain** — the screen that answers "is the drawer right?", which is the question the app was commissioned to answer.

It keeps its own change at every level of consolidation because it contains the subtlest rule in the system: **a number a human has signed off must never change by itself.** That rule deserves its own gate rather than being buried in a bundle.

## Scope

- The daily cash record per outlet per business date, with the invariant from `docs/GLOSSARY.md`:
  `expected_closing = opening + cash_sales − cash_expenses − cash_withdrawn`
- `cash_sales` uses immutable paid bills whose **payment method is cash and
  `payment_business_date` is the drawer's date**. It never uses the order's
  revenue `business_date` merely because both dates are usually equal.
- An unpaid order created on an earlier business date contributes no drawer cash
  until paid; when paid, its revenue remains on the original order business date
  while its cash belongs to the actual payment business date.
- Opening float entry; cash sales and cash expenses derived; withdrawals recorded separately.
- Actual closing entered by a human, difference shown prominently the moment it is entered.
- **Hard settlement gate:** signing off locks and rechecks the database readiness
  contract in the same transaction. Every order with that original business date
  must be paid or cancelled, no grant for the date may remain live, and every
  device that held a grant or command for it must have a current queue-empty seal.
  UI counts are explanatory only; a hand-crafted close cannot bypass the gate.
- The blocker list names open orders and device states without exposing customer
  PII. The manager resolves orders as paid/cancelled and resolves pending,
  quarantined, revoked, or unsealed device work before trying again.
- **Closing the day snapshots the derived inputs** rather than leaving them to be recomputed on read.
- **Reconciliation exceptions** — a cash payment that syncs after its payment
  business date was closed is surfaced against that drawer record with what
  arrived and how it changes the expected figure. A late payment whose original
  revenue date is already closed but whose current drawer date remains open does
  not rewrite the old drawer. The manager reopens and re-closes an affected
  drawer, or accepts the exception with a note.

## Non-goals

- No bank deposit tracking or till-float denomination counting.
- No automatic correction of a closed day. Ever.

## Design questions to settle during `/opsx:propose`

- What reopening a closed day does to the previous snapshot — it should be preserved, not replaced, or the audit value is lost.
- How the blocker surface tells the manager which device/order state must be
  resolved; the settled decision is that a known-pending outbox blocks close.
- What audited disposition is allowed if a device is physically destroyed before
  its local queue can be recovered. The normal path has no override: unresolved or
  unsealed work blocks sign-off. Any exceptional bypass must be designed explicitly
  here and must never masquerade as “all settled.”
- The sign convention for difference, asserted explicitly in tests. Short is negative; this is exactly the kind of thing that silently inverts.
- How a day-close screen juxtaposes revenue-date exceptions with drawer-date
  exceptions without adding them to the same cash invariant; the dates and
  effects must remain separately labelled.
- **May the owner close a day or record a withdrawal at an outlet they do not manage?** Today: no, by decision (#22). Cash closing and withdrawals are granted only by a live Franchise Admin assignment at that outlet, and the refusal comes from the database rather than from a hidden button; the owner's remote path is non-cash only. The owner reaches the drawer by assigning themselves as that outlet's manager, which is one action and states the arrangement in the data. **The owner wants this reopened here** (2026-08-01): where an outlet has no dedicated manager, the owner is its de facto admin and appointing themselves reads as paperwork. Settle it in this change, since it is this change's boundary. What has to be answered:
  - **A role rule, or an outlet fact?** Either the owner role reaches every drawer, or an outlet can be marked as having no manager and the owner inherits that one drawer while it stays that way. The second is narrower and keeps the day's sign-off attributable, which is the reason the boundary exists at all: a cash count is a claim by whoever counted the cash.
  - **What does the record say?** A day closed by the owner remotely and one closed by the manager at the counter must not read the same. Attendance approval already solved a version of this: the act is allowed, and whether the person was on site is recorded and shown.
  - **Reason, position, or neither?** Approval asks for a reason when the approver is off site. A cash close is a stronger claim than an approval, so the same test is at least arguable.
  - **What happens when a manager is later appointed?** An inherited drawer has to end cleanly, and days already closed have to stay explicable.
  - What already exists for it: the owner self-assignment carve-out, the owner's non-cash remote write path with its policy coverage, the managed-versus-visible distinction the cash surface already uses to show the day while offering neither the close nor a withdrawal, and `closed_by` on the record.
  - **This question now starts from an empty room, and that is deliberate.** On 2026-08-01, before #28 shipped, both Super Admins held live Franchise Admin assignments at both outlets — appointed only to reach the screens #28 now reaches without them. The owner had all four rows **deleted** rather than ended (their decision, on a database with no trading data in it yet), so **no live Franchise Admin assignment exists at either outlet.** The consequence is exactly this change's subject: today nobody at all can close a business day or record a withdrawal at either shop, and nothing in the app says so, because every cash surface is still demo-gated. So by the time this change promotes them, the business needs one of two things, and choosing is part of the work here: real managers appointed at each outlet, or the boundary above widened so the owner may close a day at an outlet they run in practice. Shipping the drawer without settling this would ship a screen whose primary action nobody can perform.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DATA_MODEL.md` (daily cash section), `docs/OFFLINE_AND_SYNC.md` (the late-bill rule, once it is real).
