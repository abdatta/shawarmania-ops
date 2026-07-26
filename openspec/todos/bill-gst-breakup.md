# Bill GST Breakup

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Billing

## Expectation

A bill can show taxable value and GST separately, at the correct rate, and reports can distinguish revenue from tax collected.

## Current behaviour

v1 writes every bill with `pricing_mode = 'no_tax'` and `tax_paise = 0`. Menu prices appear to be tax-inclusive, and the customer sees a single figure.

## Why it is deferred

Nothing in the current operation requires a tax breakup, and getting GST wrong is worse than not showing it. Rate determination for prepared food, composition-scheme eligibility, and whether the existing menu prices are inclusive or exclusive are all business and compliance questions, not engineering ones — they need an answer from the business before any code is written.

## What already exists for it

- **`pricing_mode` is written on every bill from day one.** This is the important one: when GST is switched on, historical bills stay unambiguously `no_tax` instead of being silently reinterpreted under the new rules. Without it, "was this ₹139 inclusive of tax?" would become unanswerable for every bill ever rung.
- `tax_paise` exists and is zero, so the column arrives before it is needed rather than after.
- Line items snapshot unit price, so a per-line tax computation is possible retrospectively if it is ever needed.

## Open questions

- Are current menu prices intended as tax-inclusive? The public menu suggests yes, but this must be confirmed, not assumed.
- Which GST rate applies, and does it differ between dine-in, takeaway and aggregator orders?
- Is a compliant tax invoice needed (GSTIN, HSN, sequential invoice numbering with statutory properties), or only a breakup for the business's own records? These are very different amounts of work.
- Does GST apply per outlet? Franchise outlets may be separate registered entities, which would make this outlet-scoped configuration rather than a global setting.

## Trigger to promote

The business registers for GST, a customer requires a tax invoice, or a franchise agreement makes it a requirement for an outlet.

**Dependencies when seeded**: `billing-live` (#10). Likely interacts with `owner-console-live` (#13), which owns reports and export.
