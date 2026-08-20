# Design: Freeze Aggregator And Supply Entry

## D1 — The figures move to `aggregator_channel_days`, because the day row cannot hold them

`manual_ledger_days.opening_cash_paise` and `counted_cash_paise` are `NOT NULL`.
A row cannot exist without a drawer count, and the day whose aggregator revenue
most needs reading is precisely the day nobody counted. The alternatives were
both worse: making those columns nullable collapses "counted zero" into "never
counted" and removes the drawer's only check; creating a day row with invented
figures fabricates evidence that reconciles.

So: `aggregator_channel_days (outlet_id, channel, business_date)` unique, holding
`revenue_paise`, `commission_paise` (nullable, null = undetermined),
`settlement_state`, `origin`, and the superseded pair with its moment. The
`zomato_*` and `swiggy_*` columns leave `manual_ledger_days` for sourced channels
and stay for unsourced ones, which today means Swiggy keeps its columns and Zomato
loses them.

**Backfill is the risky part.** Production holds 32 day rows with live Zomato
figures. The migration copies them across keyed on `(outlet_id, business_date)`,
asserts the row count matches before dropping anything, and drops the columns in
the same transaction. A count mismatch aborts.

## D2 — The freeze is the absence of a writer, not a disabled field

No client role gets insert, update or delete on `aggregator_channel_days`. Only
the ingest path writes, as itself. This means the hand-crafted request and the
missing UI field are refused by one rule rather than two, and there is no state
where the screen and the database disagree about whether typing is allowed.

A trigger on `manual_ledger_days` refuses a write carrying a sourced channel's
figures, rather than ignoring them, so a stale client that still sends them fails
loudly instead of appearing to succeed.

## D3 — A deduction's kind decides whether it becomes an expense

`ingest_aggregator_cycle` currently makes every deduction an expense. It splits:

| Deduction | Reconciles the cycle | Creates an expense |
|---|---|---|
| Supply recovery (ZPL) | yes | **no** |
| Advertising, promotions, other | yes | yes |

The reconciliation sum is unchanged and still counts everything, including
recoveries of purchases dated before the boundary, because the money left that
payout. The boundary governs writes, not measurement. This is the double-count
fix and it is the one change that must land before the next payout cycle.

## D4 — One parser, in an Edge Function, sniffed by content

`parse-operator-statement` accepts bytes and returns a normalised payload. The
reader posts bytes; the upload posts bytes. Neither has its own parser, so the
recovery path is exercised twice a day.

Recognition is by content, never filename, because two accepted shapes are both
`.xlsx` and downloads get renamed:

| Shape | Recognised by |
|---|---|
| Zomato order history | zip entry matching `order_history_*.csv` |
| Zomato settlement | sheet named `Order Level` |
| Hyperpure statement | sheets `Overall SOA` and `Payment Ledger` |

Customer identifier and telephone columns are dropped inside the parser, so no
caller can choose to keep them.

## D5 — The dedup key is the supplier's order number

`supply_purchases` carries `source_system` plus `source_order_ref`, unique per
outlet. One order, one row, whatever re-reads it. Amount-and-date matching is not
used for identity, only for the existing possible-duplicate *signal* against
hand-typed history, which stays advisory.

## D6 — Invoice date, with one opening-date fallback

Invoice date is the day the goods arrived and the axis the statement itself
filters on, so a daily pull cannot straddle its own boundary. Order date is
unusable as a substitute: measured across 108 orders the gap is one day for 104
and two days for four.

Where an invoice date precedes the ledger's earliest business date, the purchase
is dated to that earliest date. This applies to exactly one known row and exists
so a cost recovered from an in-period payout is not lost to a period the books do
not cover.

## D7 — Storage carries the outlet rule, not just the screen

First use of Supabase Storage here. Bucket `operator-statements`, private, path
`<outlet_id>/<channel>/<uploaded_at>-<hash>`. Bucket policies derive entitlement
from the same helper the table policies use, so a guessed path is refused by the
database rather than by the absence of a link.

## D8 — The restatement is a rehearsed migration, never a local write

It runs through `deploy.yml` like every other migration, and it is rehearsed
first against the real payload using the existing `rehearse_aggregator_cycle`
mechanism, so the row counts and totals are known before it runs. Expected
outcome, asserted by the migration itself and aborting if unmet: 10 rows removed,
16 written, August Hyperpure totalling ₹85,206.37.

## D9 — Swiggy stays typed, visibly

The upload path takes a channel parameter throughout so a Swiggy file works the
day one exists. The form states why Zomato shows a reading and Swiggy shows
fields, because an unexplained asymmetry reads as a fault and invites someone to
"fix" it.

## Risk carried deliberately

Whether a delivered-but-unpaid Hyperpure order appears in the statement could not
be tested: every due was zero when the portal was examined. The structural
evidence says yes, since the statement carries Due Amount, Payment Status and
Estimated Recovery Date columns and computes a Total Dues line. Rather than trust
that, the reader reconciles the statement against the supplier's order list and
reports any delivered order the statement omitted. The first unpaid order after
release then proves it within a day, loudly, instead of quietly under-reporting
for a month. This is the discipline whose absence let the Zomato finance-API path
ship unable to answer for a single day.
