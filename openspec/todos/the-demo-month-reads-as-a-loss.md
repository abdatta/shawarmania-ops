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
real shop, and the live P&L is `owner-console-live` (#13)'s to build against real
data.

## Trigger to promote

**#13 `owner-console-live`**, which is where the P&L stops being demo data and
starts being the owner's own. Balancing the demo month is worth doing in the same
change that makes the real one, because both need the same question answered:
what period does this figure cover, and does it contain a wage run.

Sooner if the walkthrough is shown to somebody whose opinion matters before then.
