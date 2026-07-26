# Bill Digital Share

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Billing

## Expectation

A customer who gave their phone number can receive their bill digitally — a WhatsApp or SMS message with a link to a read-only receipt page.

## Current behaviour

v1 records bills only. A customer's phone number may be captured but nothing is sent to it.

## Why it is deferred

It is the cheapest of the three billing extensions to add and the least urgent: no hardware, no compliance question. It waits behind them because nobody is currently asking for it.

## What already exists for it

- `customer_phone` is captured at billing, so there is no backfill problem — bills rung before this feature exists can still be shared afterwards.
- Line item snapshots mean the receipt renders what was actually charged.

## Open questions

- WhatsApp or SMS? WhatsApp is how this business already communicates, and avoids the TRAI/DLT registration that transactional SMS requires in India. It needs a Business API account, which has its own cost and approval path.
- A receipt link is a public URL containing a customer's order. It must be unguessable (random token, not the bill ID) and should expire. **A sequential or enumerable receipt URL would expose every customer's bill** — this is the one genuine security consideration in the feature.
- Is sharing opt-in per bill, or automatic whenever a phone number is present? Automatic sending to a number captured casually at a busy counter is a good way to message the wrong person.
- Does the customer's consent need recording?

## Trigger to promote

The owner wants digital receipts, or customers start asking for a record of their order.

**Dependencies when seeded**: `billing-live` (#10).
