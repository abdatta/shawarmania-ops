# Aggregator Settlement

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Reporting

## Expectation

Aggregator revenue in reports and the P&L reflects what the business actually receives — net of commission — rather than the order value the customer paid. The owner can see both figures and tell them apart.

## Current behaviour

**Rewritten 2026-08-11.** This note was written when aggregator orders were expected to be rung at the counter as bills. `billing-live` (#10) withdrew Swiggy and Zomato as tender methods by owner decision and narrowed the `payment_method` enum to `cash | upi`, so that is no longer what happens and the paragraphs below have been corrected rather than left to mislead.

Aggregator orders are **not recorded as bills at all**. Each day's Swiggy and Zomato revenue is typed into the manual ledger as a stated figure, beside the commission rate that applied to that day, and the ledger already computes the net per day and nets it into the month. Integrating aggregator trade into billing is available as a later change and is nobody's scheduled work.

Two consequences follow, and they point in opposite directions from what this note originally assumed.

The **P&L is already net**, not gross, for aggregator revenue: the per-day rate does the reduction the original note was asking for. The systematic overstatement described here no longer exists on that path. What replaces it is the accuracy of a typed figure and a typed rate against a real settlement statement, which is a reconciliation gap rather than an arithmetic one.

**Item-level sales for aggregator orders are lost.** Bills carry the line snapshots; the ledger carries one number per platform per day. So the app can say what Swiggy brought in on a Tuesday and cannot say what was sold. Anything reading bills as total revenue understates the outlet by the whole aggregator slice, which is the failure mode to watch now.

## Why it is deferred

This is the single largest known inaccuracy in the P&L, and it is deferred anyway — because fixing it means either a manual settlement-entry surface or an aggregator integration, and neither earns its cost while aggregator orders are a small slice of revenue. A P&L that is uniformly optimistic on a small slice still answers "is this shop making money this month?". The same P&L becomes misleading once that slice is large.

The failure mode to watch is not the inaccuracy itself, which is documented, but a figure from that screen being quoted somewhere it will be taken as net.

## What already exists for it

- **Aggregator revenue is identifiable from day one, per platform per day** — the ledger stores stated Zomato and Swiggy revenue in separate integer-paise columns. Historical aggregator revenue can be found without guessing, at day granularity rather than order granularity.
- **The commission rate is already stored per day**, so a rate that changed mid-month is right on both sides of the change and a historical period recomputes on the rate that actually applied. That answers one of the open questions below outright.
- **Bills are append-only with line-item snapshots**, so if aggregator orders are ever rung at the counter, a settlement record can attach alongside a bill rather than rewriting the sale.
- The P&L already states which basis it is showing, so adding a gross/net distinction extends an existing habit rather than introducing one.

## Decided since (owner, 2026-07-28)

- **Manual settlement entry first** — confirmed; integration only if volume ever justifies it.
- **The owner enters it, from anywhere.** Settlement and commission figures live in the owner's aggregator dashboard; no Franchise Admin can see or verify them, so making an FA transcribe them would be worse attribution, not better. The general principle set that day: *record money where the knowledge lives.* This makes the todo a customer of the owner's non-cash write path, folded into `multi-outlet-people` (#22) on 2026-07-29 — which must land first.
- **Settlement entries never touch drawer math.** They are non-cash by nature, and the day-close arithmetic only counts cash — so this capability is drawer-safe by construction, no new enforcement needed.

## Open questions

Two of the original five are now answered by where this landed.

**Answered: manual entry's home.** It is a deduction on the revenue side, expressed as a per-day rate against a stated figure, not an expense with a category. The ledger settled this and it has been in nightly use since.

**Answered: rate storage.** The rate is per day per platform, stored on the day row rather than looked up, so a historical period recomputes on the rate that applied then and a mid-month change is correct on both sides. Editing a past day's rate moves that day's net and the month's profit and touches no cash figure.

Still open:

- Is settlement reconciled per order or per payout batch? Payouts are understood to batch across several days, which does not line up with the business-date model everything else uses. This needs confirming against a real settlement statement before any design, and it is now the whole of the remaining problem rather than a detail of it.
- What happens to a payout that arrives short, late, or not at all? The typed figure and the typed rate produce an expected net; nothing yet compares it against what the bank received. That is a reconciliation exception, and the system already has a shape for those.
- Does anything need the item-level sales picture for aggregator orders? Recovering it means ringing aggregator orders at the counter, which is a billing change and not a settlement one. Worth separating: someone asking "what does Swiggy sell for us" wants that, and someone asking "did the payout match" does not.

## Settlement reconciliation — done (#42, #43)

**Settled by `zomato-settlement-sync` (#42) and `freeze-aggregator-and-supply-entry` (#43), 2026-08.** Zomato revenue and commission are read from Zomato itself — the daily order history and the weekly settlement workbook — reconciled against the stated payout to the paisa, and can no longer be typed. Commission is an exact amount, undetermined until the week closes. Hyperpure supply expenses are read the same way, one per order, with payout recoveries reconciled rather than double-booked. A manual statement upload is the fallback when the reader is blocked. So the settlement-reconciliation trigger below is discharged; what remains open is the item-level picture and directly-paid supply bills.

## Trigger to promote (what is left)

**Aggregator billing**: when the missing item-level picture changes a decision about the menu or preparation, which is the cost paid on 2026-08-11 for keeping V1 small. Aggregator orders carry one number per platform per day, not line snapshots.

**Directly-paid supply bills**: tracked separately in `supply-bills-paid-outside-the-payout.md` — a purchase paid by transfer rather than through a payout is known only to the supplier, and is entered by hand until a supplier-portal reader exists.

**Dependencies when seeded**: none outstanding. This named `owner-console-live`
(#13), which owned the P&L and reports; that change was withdrawn on 2026-08-31
and the P&L deleted with it (see `owner-console-was-withdrawn.md`). Nothing this
note needs was unique to the console — a reconciled payout lands in the Ledger,
which already reads from recorded rows.
