# Proposal: Restore The Month's P&L

> **Model**: Opus · **Wave**: E · **Depends on**: #51 · **Gate**: the Ledger's
> month view reports what the month earned — Cash and UPI from bills, each
> aggregator gross → commission → net at its own day's stated rate, expenses
> grouped by category with every line beneath, and a cash-basis operating profit
> naming its basis on screen; a month in which any commission is undetermined
> reads as a ceiling on every affected figure and says how many days are still
> waiting; a month carrying dates that recorded no sales at all — from the counter
> or from any channel — reports its aggregate all the same, says how many such
> dates there were and names them exactly on a tap, and qualifies its profit figure
> as well as its revenue; a month with no sale on any date says there are no
> recorded sales for it, still lists its expenses and offers no profit figure; the drawer's thirty-one rows become one line saying how
> many days were counted and how many are carried, which opens the day view; cash
> out that is not an operating cost stays listed and stays outside the profit
> figure; a Franchise Admin reads all of it for the outlets their assignments name
> and no other, proved by a hand-crafted request; no migration is added, and every figure comes from
> reads `getMonth` already performs plus one indexed read for the outlet’s own
> channel mapping; and the four-role demo walkthrough still walks.

## Why

**The Ledger cannot say what a month earned.** Its month view reports the drawer
and nothing else: thirty-one rows of opening → closing, and a list of cash spends.
No revenue, no costs, no profit. The owner noticed, and the words they used are
worth keeping: *the month view is about seeing revenue, costs and P&L — cash
drawing is of no relevance.*

Nobody decided this. It is the residue of three changes that each did the right
thing on their own.

### The loss happened between two changes, and neither one caused it

**#11 `cash-is-counted-not-closed`** built the derived Ledger. Its month view was
scoped, deliberately and correctly, to one question — *has anybody counted the
drawer lately?* — because `carried` is the only word on that view that says how
far the numbers can be trusted. #11 was explicitly additive: it dropped nothing,
and the notebook stayed live at its own route. So for two days the app had two
Ledger month views, and the *other* one carried the Sales breakdown, the Expenses
breakdown and the Estimated profit. Nobody noticed the new one was thin, because
the old one was still there.

**#12 `retire-the-manual-ledger`** deleted the notebook. That was its whole
purpose and it had been the plan since #36 landed. But the retirement assumed the
derived statement already covered the notebook's month, and it did not. The P&L
left with the surface it happened to be sitting on.

The seam is visible in #11's own design notes. Open question 2 proposes the
spends block *"without touching the P&L"* — a P&L that, at the time of writing,
existed on a screen that was about to be deleted by the next change in the wave.

### And the escape hatch closed the same day

**#13 `owner-console-live` was withdrawn on 2026-08-31**, along with the
demonstration P&L, the two-outlet comparison and the period reports. That
decision was sound: those screens estimated on mock data, and an estimate sitting
on top of recorded rows is a second number to reconcile rather than an answer.

But it means no surface in the app carries a profit figure at all. The reasoning
was preserved rather than discarded, in
[`openspec/todos/owner-console-was-withdrawn.md`](../../todos/owner-console-was-withdrawn.md),
against a stated trigger:

> The owner asks what a period actually earned and the Ledger cannot answer it.

**That trigger has fired.** This change answers it, and answers only it.

### The work is smaller than the loss suggests

`getMonth` already computes a complete `LedgerStatementDay` for every date in the
month — cash and UPI from bill allocations, every aggregator channel with its
gross, its commission and its net, the `isCeiling` flag, and every expense row —
and then keeps eight drawer fields per day and discards the rest
([`ledger-statement.ts:477`](../../../src/data-access/supabase-adapters/ledger-statement.ts),
mock at [`ledger-statement.ts:385`](../../../src/data-access/mock/ledger-statement.ts)).

So this is not a rebuild. It is **widening `LedgerStatementMonth` to carry what
the reads already produce**, and rendering it. No migration, no new per-day query,
and #11's measured answer to its own open question 3 — that a derived month holds
comfortably at this scale — is untouched, because the per-day reads are unchanged.
One read is added for the whole month: the outlet's own channel mapping, over an
indexed column.

## What changes

**The month view regains three cards**, close to the deleted
`src/features/manual-ledger/ledger-month.tsx` in structure, order and wording:
Sales breakdown, Expenses breakdown grouped by category, and Estimated profit
with its basis named on screen. The honest parts of that screen come back with it
— the per-day commission netting, so a rate renegotiated mid-month is right on
both sides of the change; the ceiling language while any commission is
undetermined; and the standing warning that this is an *operating* figure that
accounts for no equipment.

**A date that recorded no sales is named as one.** Revenue now comes from recorded
rows, so a date nothing was sold on contributes nought — and a faithful copy of
the notebook's screen would fold that silently into the month, or print a large
confident loss for a month that had no trade at all.

The month reports its aggregate regardless, and says how many of its dates
recorded no sales, with the exact dates one tap away in a `Why` modal. **Every
revenue source counts, not bills alone**, which production is what settled: the
counter at Kalyani was not billing until 12 August and that month still holds no
silent date, because the aggregators recorded revenue throughout. A month with no sale
on any date says there are no recorded sales for it and offers no profit
figure, its expenses still listed. **This is new**; the notebook's month view had
no equivalent, because the owner typed its revenue in by hand.

It deliberately claims nothing about *why* a date is empty. Before billing began,
a closure and a broken tablet are indistinguishable to the app, and the earlier
draft of this change guessed between them. Naming the dates lets the reader
recognise which it was.

**A channel that reported nothing is named, never omitted.** The month shows a
section per delivery channel *that outlet* trades on, read from its own mapping.
Where a mapped channel produced no figure it says so, because a channel with no
orders and a channel whose sync never ran are the same absence in the data, and a
breakdown missing a channel reports a total that looks complete and may not be —
the same defect `sync-degradation-is-visible` fixed one level up. Where the outlet
does not trade on the channel at all it is absent entirely: Kanchrapara does not
sell on Swiggy, and the sync writes it a month of nought rows anyway. A channel
that reported revenue is always shown and always counted, mapped or not.

**The drawer's thirty-one rows become one line** — *"28 of 31 days counted, 3
carried"* — which opens the day view. The `carried` warning survives at the size it
deserves; the wall of numbers does not.

**Both roles read it.** The Franchise Admin already reaches `ledger`
([`registry.ts:493`](../../../src/gates/registry.ts)) and sees only the outlets
their assignments name. No role branch is added.

**`profit-estimates` returns, narrowed to one basis and one reader.** #51 removes
it whole because the estimate had no live reader; this re-adds it because a
derived reader now exists. The requirement is scoped to cash basis — stock is not
valued, so there is no consumption-basis figure to offer — and names the Ledger
month as the surface that must state it.

## What does not change

- **No comparison, no period reports.** #51 deleted both on the owner's review and
  that decision stands. This restores the profit figure and nothing else from the
  withdrawn console.
- **No consumption basis.** Nothing values stock, so cash basis is the only honest
  one available. Naming it on screen is the requirement; offering a second basis is
  not.
- **No editable figure.** The derived statement has none, and that property is
  load-bearing: it is why the row can never disagree with itself.
- **No export.** There is currently no export path anywhere in the app, which is
  strictly stronger than the deliberate absence the withdrawn console described.
- **No migration, and no schema change.** `effective_expenses` already exposes
  `category`; the day read merely collapses it into `label` today.
- **No change to what a day reports.** Only the month reading is widened.
