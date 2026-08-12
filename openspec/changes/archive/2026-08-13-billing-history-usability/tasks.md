## 1. Adapter attribution

- [x] 1.1 Add biller display attribution to `BillingBill` and populate it from both the schema-typed mock and the existing Supabase biller/profile relationship.
- [x] 1.2 Extend focused adapter tests to prove mock and Supabase manager history return the correct biller without changing outlet scope or customer PII boundaries.

## 2. Manager Billing history

- [x] 2.1 Replace flat bill summaries and after-list detail with a single-open accessible inline disclosure using Paid/Cancelled labels and outlet-local relative recent times.
- [x] 2.2 Structure expanded detail into captured items, payments/total, customer, biller and timing/reference sections, including explicit missing customer facts.
- [x] 2.3 Hide cancellation input and guidance behind `Cancel this bill`, require a reason only at final confirmation, and preserve the immutable manual-re-ring workflow.
- [x] 2.4 Reshape the Billing-history loading shimmer to reserve the collapsed summary-card layout.
- [x] 2.5 Replace the Delivery receipt feed with a manager-facing Sync status summary that prioritises problems, groups successful actions and progressively discloses technical references.
- [x] 2.6 Compress expanded phone detail into one divided surface with responsive fact grids, retaining full item and action legibility without nested section cards.
- [x] 2.7 Restore distinct Order items and Payment cards, move biller attribution to the summary subheader, and make two-column Customer details and Bill timeline nested disclosures closed by default.
- [x] 2.8 Remove expanded-state accent borders and add a reduced-motion-aware coordinated detail transition that anchors a newly selected lower summary while the earlier detail closes.
- [x] 2.9 Replace the manager Open orders cancel-first card with structured order details and progressive cancellation.
- [x] 2.10 Compact the four manager Billing filters into a two-column phone grid without horizontal overflow.
- [x] 2.11 Default Billing history to the outlet business day and replace the blank native date field with a formatted calendar button.

## 3. Contract, documentation and focused coverage

- [x] 3.1 Add focused component/end-to-end assertions for in-place single expansion, structured attribution, relative time, hidden-then-revealed cancellation, resulting Cancelled state, and grouped progressive Sync status.
- [x] 3.2 Update `docs/SCREENS.md` with the manager Billing-history hierarchy, disclosure and cancellation vocabulary.
- [x] 3.3 Pin the compact detail structure with focused coverage and document its phone-density rule.
- [x] 3.4 Update focused coverage and screen documentation for the final card/disclosure hierarchy.
- [x] 3.5 Pin neutral expanded chrome and stable lower-row selection during a bill swap with focused end-to-end coverage and documentation.
- [x] 3.6 Add focused coverage and screen documentation proving Open orders shows facts before a cancellation reason appears.
- [x] 3.7 Pin the compact phone filter grid with a focused no-overflow test.
- [x] 3.8 Cover the explicit Today and selected formatted-date states of the Billing-history date control.

## 4. Verification

- [x] 4.1 Pass lint, format check, typecheck, unit/component tests, contrast, production build and Playwright end-to-end suites.
- [x] 4.2 Inspect Bills on phone and tablet viewports in light and dark themes, including console/network errors and the permanent demo boundary.
- [x] 4.3 Exercise offline billing, reconnect and confirm exactly-once settlement remains intact because this change touches Billing presentation and adapter reads.
- [x] 4.4 PHASE GATE: an owner or Franchise Admin can scan Paid/Cancelled summaries, expand one complete bill where selected, read customer and biller attribution, and see cancellation fields only after opening the action; all applicable gates are green.
- [x] 4.5 Reinspect the corrected expanded bill on a phone in both themes and pass focused tests, typecheck, formatting and the manager Billing end-to-end scenario.
- [x] 4.6 Inspect the final hierarchy in both themes and pass focused component/end-to-end tests plus applicable static/build gates.
- [x] 4.7 Inspect animated bill switching on phone in both themes and pass focused tests, typecheck, formatting, contrast and production build.
- [x] 4.8 Inspect the revised Open orders view and pass focused manager Billing tests plus applicable static/build gates.
- [x] 4.9 Inspect the compact filter grid at a phone viewport.
- [x] 4.10 Inspect the business-date button at phone width and pass focused manager Billing checks.
