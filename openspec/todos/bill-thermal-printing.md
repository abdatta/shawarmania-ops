# Bill Thermal Printing

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Billing

## Expectation

After settling a bill, the biller can print a receipt on a counter thermal printer (58mm is the common format for this shop size), and can reprint an earlier bill from the shift view.

## Current behaviour

v1 records bills only. Nothing is printed; the customer gets no paper.

## Why it is deferred

Printing adds a hardware integration and a device-pairing surface to the billing screen — the one screen where added complexity costs the most, because it is used under time pressure with a queue waiting. The business currently operates without printed receipts.

## What already exists for it

The schema was built so this needs no historical migration:

- Per-outlet sequential `bill_number` — a receipt needs a human-readable number, and a sequence cannot be retrofitted over existing rows.
- Line items snapshot `item_name` and `unit_price_paise`, so any reprint shows what was actually charged rather than today's menu.
- `pricing_mode` and `tax_paise` are present, so a receipt template does not have to guess whether a bill included tax.

## Open questions

- Bluetooth or USB? Bluetooth pairing from a browser means Web Bluetooth, which is Chromium-only and needs a user gesture per session — worth verifying on the actual tablet before committing.
- Does a reprint need to be marked as a duplicate? Usually yes, to prevent a reprinted receipt being presented as a second sale.
- Is the printer per-outlet configuration, or per-device?

## Trigger to promote

A customer or a regulator asks for a printed bill, or the shop starts operating a format where receipts are expected.

**Dependencies when seeded**: `billing-live` (#10).
