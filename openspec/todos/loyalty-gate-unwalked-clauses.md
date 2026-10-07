# Loyalty Gate: Gold And Reversal Never Walked In Production

**Type**: Verification gap · **Status**: Open, accepted at archive · **Area**: Customers

## Expectation

Everything `a-regular-earns-points-and-gold` (#62) claims in its gate has been seen working at a live counter, in production, at least once. So have the gold clauses that `each-outlet-chooses-how-it-serves` (#60) and `the-receipt-says-its-yours` (#58) depend on.

## Current behaviour

The changes were archived on 2026-10-07, with the owner's agreement, after points had been in real use for several days. Customers earned on every paid bill, one used points at the counter, and receipts and SMS reported both. Four clauses had never met a real bill, so they were archived on the strength of automated tests and the demo walk:

- **A biller upgrades an eligible customer to Gold at the counter.** Nobody had reached the outlet's monthly threshold. The owner expected that to stay true for some weeks.
- **A gold member's higher points cap, earning multiplier and free packaging.** These are only reachable once somebody holds gold.
- **The receipt says a gold member was gold at that outlet.** Again, nobody held gold.
- **A cancelled bill takes back the points it earned and returns the points it used.** No bill at an outlet with points on had been cancelled.

## Why this is not simply "untested"

Each clause is covered where its behaviour lives:

- Eligibility, the counter grant and its refusals, the end date, the caps, the multiplier and the void's reversal entries are asserted against the real triggers and functions in `supabase/tests/66_a_regular_earns_points_and_gold.sql`.
- `e2e-auth/billing-served.spec.ts` settles a gold member's offline takeaway with the packaging waiver exactly once against the real backend in CI.
- The gold receipt mark is asserted by the landing Worker's tests, and it is projected from the stored tier by the receipt reader.
- The counter's upgrade, its confirmation and the gold use cap were walked in the demo on 2026-09-28 and 2026-09-29, and the four-role walkthrough runs on every Deploy.

What is missing is a real customer crossing a real threshold, and a real cancellation of a bill that carried points.

## What would close it

1. The first real counter upgrade. Confirm the membership row names the till, the biller and an end date the outlet's duration gives. Then confirm the customer's next bill earns at the gold rate and may use points up to the gold cap, and, for a takeaway, that its packaging line is waived. Finally, open that bill's receipt and read the gold mark.
2. The first real cancellation of a bill that earned or used points. Confirm that the reversal entries name the bill and that the balance returns.

If either goes wrong, fix it in a new change. The archived contract is the record of what was promised.

## Trigger

The first customer shown as *Eligible for gold* at a live counter, or the first cancelled bill at an outlet with points on, whichever comes first.
