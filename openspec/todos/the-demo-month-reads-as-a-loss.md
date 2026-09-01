# The Demo Month Reads As A Loss

**Type**: Fixture gap · **Status**: Open · **Area**: Demo mode / Reporting

## The expectation

The four-role walkthrough is a sales surface as much as a test. An owner looking
at the demo's Profit and loss should see a shop that plausibly trades — the
figure can be tight, or seasonal, but it should not say the business is losing a
fifth of its takings every week.

## The observed behaviour

On the default **Last 7 days** period the demo P&L reads roughly ₹23,800 of
sales against ₹42,800 of expenses, so the headline figure is a loss of about
₹19,000. The breakdown is not wrong — it is a month's worth of recorded
expenses, including one ₹14,500 wage payment and two bulk food purchases, read
against seven days of bills.

The cause is the fixture, not the arithmetic. The demo's revenue is one busy
trading day plus a handful of quieter ones, while its expenses were written to
cover a whole notebook month, and the two were never balanced against each other
because nothing used to put them in the same figure by default.

## Why this is not trivial

**It became visible rather than new.** The consumption basis used to be the
P&L's default, and it subtracted stock *used* instead of stock *bought*, which
flattered a period containing a bulk purchase. `retire-the-manual-ledger` (#12)
withdrew that basis — inventory is shelved, so it could not be computed at all —
and the cash basis it left is the honest one: a bulk purchase is charged to the
period it was paid for in. So the figure did not get worse; the number that was
covering for it went away.

Fixing it properly means deciding what the demo month *is*: either more trading
days behind the same expenses, or expenses scaled to the days that exist. Both
touch fixtures several surfaces read, and the store asserts its own arithmetic on
construction, so a careless change fails loudly rather than quietly — which is
the good news.

The surface itself is `demo`-gated. Nobody is being shown a wrong figure about a
real shop.

## Superseded on 2026-08-31: there is no P&L to balance

This note's whole trigger was **#13 `owner-console-live`**, on the reasoning that
balancing the demo month belonged in the change that made the real one. **#13 was
withdrawn and the P&L deleted** — `#51 navigation-groups-and-surface-cull`
removes the surface, and `profit-estimates` with it. See
[`owner-console-was-withdrawn.md`](./owner-console-was-withdrawn.md).

So the wrong figure this note reports stops existing rather than gets fixed: with
no P&L screen, the demo month cannot read as a loss anywhere.

**What survives is the underlying fixture shape**, and it is worth keeping,
because it is not really about profit: the demo's expenses cover a notebook month
while its bills cover a few days, so any figure spanning both periods is
comparing unlike things. The Ledger's monthly view reads the same fixtures. That
is the version of this problem to check for.

## Trigger to promote

Somebody reads the demo Ledger over a month and the figure looks wrong, or the
walkthrough is shown to somebody whose opinion matters. **Not** #13, which no
longer exists.

## Reopened 2026-09-01: the P&L came back, and so did the figure

`#52 restore-the-month-pnl` restored the profit figure to the Ledger's month,
because the owner asked what a month earned and the Ledger could not answer.
So the wrong figure this note reports **exists again**, and the paragraph above
saying it "stops existing rather than gets fixed" no longer holds.

Measured on the demo the day #52 landed: August reads **−₹20,564.15** estimated
profit, on ₹18,346.85 of revenue against ₹38,911 of expenses. The cause is
exactly the fixture shape this note preserved — the demo's expenses cover a
notebook month while its bills cover a few days, so the figure compares unlike
periods.

**#52 did not fix it, deliberately.** It restores a reader over whatever fixtures
exist; balancing demo data is a separate concern from computing a month
correctly, and the arithmetic is proved against production rather than against
the demo. What #52 did add is the sentence that makes the figure legible rather
than alarming: the month names how many of its dates recorded no sales, against
the profit figure as well as the revenue total, so a reader is told the estimate
is understated by the trade nobody rang up.

**Status: open again**, and now genuinely reachable by anybody walking the demo.

## Trigger to promote, restated

Somebody reads the demo Ledger's month and the figure looks wrong, or the
walkthrough is shown to somebody whose opinion matters. The surface exists again,
so this no longer waits on anything.
