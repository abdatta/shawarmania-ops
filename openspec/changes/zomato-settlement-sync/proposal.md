# Proposal: Zomato Settlement Sync

> **Model**: Opus · **Wave**: D · **Depends on**: #36, #37 · **Gate**: both outlets' Zomato revenue arrives without being typed and reconciles to Zomato's stated payout within a rupee across two consecutive settled cycles, proved in the suite rather than by a production run; a week made not to reconcile is refused whole, leaves prior figures byte-for-byte unchanged, and reads as disputed rather than provisional; a settled day whose figures moved is marked revised and retains what they moved from; an order placed at 00:30 lands on the previous trading day under the outlet's own 04:00 cutover; a cycle-level tax deduction reaches no business date; a deduction expense lands on its spend date and moves no drawer figure; an FA, Biller and Employee are each refused every settlement and deduction record by the database, proved by a hand-crafted request; a historical month's totals are unchanged; and the four-role demo walkthrough still walks.

## Why

Zomato revenue is the one figure in the ledger nobody can check. The owner types what the Zomato dashboard states for the day, beside a commission rate typed once, and the month's profit is computed from those two numbers. Nothing compares them against the payout that actually reaches the bank, which `openspec/todos/aggregator-settlement.md` has called the single largest known inaccuracy in the P&L since it was written.

That todo was parked on one question: whether settlement is reconciled per order or per payout batch, because a batch spanning several days would not line up with the business-date model everything else uses. Investigation against the live account on 2026-08-16 answered it. Settlement is **per order**, each order carries its own post-commission figure, and orders are dated by placement. It lines up.

The same investigation found the reason a typed figure cannot be trusted even when typed carefully: the effective commission rate moves between 24% and 35% day to day, so a single stored rate misstates every day it is not measured on. It also found a category of income the dashboard never shows at all, described below.

Volume now justifies the work. Roughly ₹1 lakh a month flows through the two outlets' Zomato listings, and it is the only revenue channel with no independent check.

**This reverses a prior decision.** On 2026-07-28 the owner settled that manual settlement entry came first, with integration only if volume ever justified it. On 2026-08-17 the owner confirmed that it now does, having seen that the data reconciles to the paisa. The reversal is recorded here rather than left for a reader to infer.

## What Changes

- Each outlet's Zomato revenue arrives in the ledger on its own, twice a day, instead of being typed. The owner keeps the ability to override any day.
- A day's Zomato figures are **stated as three numbers rather than one and a rate**: gross, commission and net, each an exact integer paise value read from Zomato rather than derived from a stored percentage.
- A day carries a **settlement state**. Revenue for a week Zomato has not yet paid reads as provisional; once the week settles, the figure is replaced by the settled one and reads as final. A day whose figure moved on settling is marked **revised** and keeps what it moved from, so no number changes without a trace. A paid week that does not add up reads as **disputed**, which is a different thing from a week merely awaiting payment.
- **BREAKING for the entry form:** the Zomato revenue and commission-rate inputs stop accepting typed values for outlets the sync covers. The typed figure that a synced value replaces is retained and readable, so the owner can see how far the manual estimates were off.
- Hyperpure and advertising deductions arrive as expenses by themselves, dated to when the purchase happened rather than to the payout that collected it. The owner stops recording Hyperpure by hand.
- Tax deducted at source arrives as its own deduction record. It belongs to no trading day and is never attributed to one.
- A new **Zomato sync surface** shows what the sync has changed. A row on it is an event rather than a run, so a job that changed nothing adds no clutter; where a figure was replaced, the row says what it changed from. Rows the owner must act on open with their actions, in the shape the attendance screen already uses. The lapsed-session prompt and the possible-duplicate expense signal live here too.
- A week whose figures do not reconcile against Zomato's stated payout is **refused rather than written**, marked disputed, and put on that surface with two actions: re-check it, or accept it with the unexplained difference recorded as its own visible line. Nothing offers to absorb the gap quietly.

## Capabilities

### New Capabilities
- `aggregator-settlement-sync`: reading a delivery aggregator's settlement record on a schedule, attributing each order to a trading day under the outlet's own cutover, distinguishing provisional figures from settled ones and marking those that changed, reconciling a settled week against the payout that was actually made, holding a week that will not reconcile as disputed until a person resolves it, and reporting what changed on a surface built around events rather than runs.

### Modified Capabilities
- `manual-ledger`: a day's aggregator revenue is a synced triple of gross, commission and net rather than a typed figure against a stored rate; a day carries a settlement state; a synced value supersedes a typed one while preserving it; aggregator deductions become recorded expenses rather than the owner's own entries; the entry form presents synced channels as readings rather than inputs.

## Impact

**Database.** `manual_ledger_days` gains exact-paise columns for Zomato gross, commission and net, a settlement state, the retained typed figure, and the retained provisional figures a settled day replaced. The existing `zomato_commission_bp` rate stays for days recorded before the sync and for Swiggy, which this change does not touch. `manual_ledger_expenses` gains an external-source identity so a Zomato-sourced deduction is recognisable, deduplicated across runs, and not double-counted against a hand-entered one. A new record holds what belongs to no day: cycle-level deductions such as tax, and the unexplained difference on any week the owner accepts. Every new table and column ships its Row-Level Security policy and its isolation test case.

**Read paths.** The month's aggregator revenue and the cash-basis profit are computed from the stored net rather than from gross times a stored rate. Days recorded before this change keep computing the old way, so no historical month moves.

**Ingestion.** The reader itself already exists and is proven, in the private repository `abdatta/shawarmania-zomato-sync`, kept out of this public one because it holds a live merchant credential and the shop's revenue. This change owns the contract it writes through, not the scraping.

**Not affected.** Cash, UPI and the drawer. Aggregator money is non-cash by nature, and day-close arithmetic counts only cash, so this capability is drawer-safe by construction.

**Docs to update before archiving.** `docs/BUSINESS_CONTEXT.md` (which states the app does not reconcile aggregator payouts), `docs/PROJECT_OVERVIEW.md` (which states there is no Zomato integration), `docs/DATA_MODEL.md` (ledger columns and the new records), `docs/OPERATIONS.md` (which instructs the owner to type what Zomato states), `docs/LIMITATIONS.md` (which documents the aggregator inaccuracy this removes), and `docs/SCREENS.md` (the day form and the sync health surface).

## Non-goals

- **Swiggy.** The same shape would work, against a different site with its own defences. Nothing here presumes it.
- **Ringing aggregator orders at the counter.** Item-level sales for Zomato orders stay unavailable. Recovering them is a billing change, not a settlement one, and `aggregator-settlement.md` keeps it separate deliberately.
- **Removing the one-time password from authentication.** The Zomato session renews itself as long as the job keeps running, so the owner should expect to authenticate roughly once. The login flow does issue a refresh token, which would remove even that, and it is left as later work rather than folded in here.
- **Touching cash, UPI, drawer arithmetic, or day-close readiness.**
- **Making commission an expense.** It is a reduction of revenue, as `openspec/specs/manual-ledger/spec.md` already requires, and this change does not disturb that.
- **Backfilling history beyond what Zomato serves.** The record reaches back one year; nothing older is recoverable.
