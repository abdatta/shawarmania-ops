# Supply Bills Paid Outside The Payout

**Type**: Feature · **Status**: Owner asked to explore, 2026-08-18 · **Area**: Outlet expenses

## Expectation

Every supply bill reaches the ledger without being typed, whichever way it was paid.
Today only the ones an aggregator deducts from its own payout arrive on their own,
and the rest still have to be entered by hand — so the owner is half-automated and
has to remember which half.

## Current behaviour

`zomato-settlement-sync` (#42) reads the aggregator's expense record and books each
bill against the day it was spent, deduplicated on the aggregator's own reference.
That record is **only what the aggregator deducted from a payout**. A bill paid
directly, by transfer or on credit, never appears there.

Measured at one outlet over a five-week window: eight supply bills had been entered
by hand and exactly **one** had a counterpart in the aggregator's deductions. The
other seven were paid directly and the aggregator has no knowledge of them at all.

This was found the hard way. The owner asked for the hand-entered bills to be
replaced by "the source of truth from the payout sheet", on the reasonable assumption
that the sheet knew about all of them. Taking that literally would have withdrawn
roughly ₹33,000 of real costs at that one outlet and overstated the profit by the same
amount. The rule that actually holds is narrower and worth stating plainly:

> The payout statement is the source of truth for **what the aggregator paid**. It is
> not the source of truth for **what the business spent**.

So the reconciliation gate can be trusted absolutely — it caught a missing bill to
within five paise — while the expense record cannot be trusted as complete.

## Why it is non-trivial

The supplier is the only party that knows about a directly-paid bill, and the app has
no relationship with them. Three routes suggest themselves and each has a real
obstacle:

- **The supplier's own portal.** A second scrape, a second credential, and a second
  session to keep alive, on a portal whose operator may object more than the
  aggregator does.
- **The invoice email.** Bills arrive somewhere as attachments. Reading a mailbox is a
  far larger permission than reading one merchant account, and parsing a PDF invoice
  is a different class of problem from parsing a spreadsheet.
- **The bank statement.** It shows the payment but not what was bought, so it can
  confirm an amount and a date and cannot categorise. Useful as a cross-check against
  a bill already recorded, not as a source of one.

Whichever route is taken, the duplicate signal already built for #42 becomes load
bearing: the same purchase would then have up to three possible origins — typed,
deducted from a payout, and read from the supplier — and only one of them may reach a
total.

## Trigger to promote

The owner asks for it in earnest and picks a route. Until then the honest instruction
stands: **keep entering the directly-paid bills by hand**, because nothing else sees
them.
