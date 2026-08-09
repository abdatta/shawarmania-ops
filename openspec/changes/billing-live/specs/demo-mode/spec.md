## ADDED Requirements

### Requirement: Live billing promotion preserves the isolated demo composition

Promoting billing capabilities to `live` SHALL connect real tablet sessions to
live adapters while `/demo` continues to use the complete synthetic billing
lifecycle with no authentication, no IndexedDB delivery and no Supabase writes.

#### Scenario: Demo is opened after live promotion
- **WHEN** a visitor enters the billing walkthrough through `/demo`
- **THEN** the direct-paid and guaranteed-Undo, open-order, aggregator, cancelled, unsent, originating-tablet needs-attention, read-only manager-diagnostic and customer-reuse scenarios remain walkable with no discount control, and no live queue or backend mutation is created
