> **Model**: GPT-5.6 Sol · **Kind**: product usability correction, not a sequenced roadmap change · **Gate**: **an owner or Franchise Admin can scan paid and cancelled bills, expand one bill exactly where they selected it, read the complete sale in structured sections including customer and biller attribution, and see cancellation controls only after deliberately opening them.**

## Why

Manager Billing history compresses status, payment and two dates into an undifferentiated line, then appends the selected bill after the entire result set. On a busy day the detail appears several screens away, while a technical void-reason field is permanently visible and makes an exceptional correction look like part of ordinary bill reading.

## What Changes

- Give each bill summary a scannable hierarchy with plain-language Paid/Cancelled status, amount, payment method, outlet-local relative day/time and biller attribution.
- Fit the four history filters into a compact two-column grid on a phone, retaining a single row on wide screens.
- Default Billing history to the outlet's current business day and expose it as a plain-language date button rather than a blank browser date field.
- Expand at most one bill directly beneath the selected summary rather than rendering detail after the list.
- Organise immutable detail into always-visible item/payment cards and closed-by-default Customer details/Bill timeline disclosures, with explicit absence where optional customer facts were not recorded.
- Keep the internal `void` transition intact while presenting the manager action as marking a bill cancelled; reveal its reason and consequences only after the manager deliberately opens that action.
- Carry biller attribution through both mock and Supabase billing adapters without changing tenancy, billing writes, money arithmetic or stored records.
- Make manager Open orders readable before any correction action: show captured items, customer facts, creator, time and total; reveal cancellation reason and confirmation only after **Cancel this order** is chosen.
- Rename the opaque Delivery tab to Sync status, lead with problems that need attention, group successful command delivery into useful counts, and hide individual technical references behind progressive disclosure.
- Reshape the Billing-history shimmer and verify the phone/tablet layouts in both themes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `counter-billing`: Make manager bill history an inline disclosure with structured complete detail, human-facing Paid/Cancelled language, relative recent dates, biller attribution and progressively disclosed cancellation.

## Impact

- Billing history React surface and its focused component/end-to-end coverage.
- Typed `BillingBill` adapter view plus mock and Supabase mappings for existing biller attribution.
- Existing date-formatting helpers and semantic design tokens only; no new dependency or raw brand value.
- `docs/SCREENS.md` must describe the resulting manager Billing-history interaction before archive.

## Non-goals

- No migration, RLS/policy, gate-registry, outbox, bill arithmetic or billing-command change.
- No deletion, refund, automatic replacement bill, phone-side re-ring or mutation of settled sale facts.
- No redesign of the counter's Open orders surface, composer or My shift; Sync status remains read-only and cannot correct a tablet's queue.
- No customer export, analytics, logging or broader access to customer PII.
