# Proposal: compact-counter-total-cards

> **Gate**: the biller's Cash and UPI cards keep their existing text size and
> values while using visibly tighter padding and spacing; the manager Status
> cards share the same treatment.

## Why

The restored payment total cards are readable, but take more tablet rail space
than their short labels and values need. Tightening their whitespace makes the
next bill easier to reach without reducing legibility.

## Scope

- Reduce total-card padding, label-to-value space, and card gap.
- Tighten the embedded shift section's vertical rhythm.
- Keep the shared cards identical in the biller and manager views.
- Omit the duplicate explanatory text under the two counter-rail headings.
- Restore a small gap between the Open orders heading and its first card.

## Non-goals

- No text-size, billing-data, payment, offline, or tenancy change.
