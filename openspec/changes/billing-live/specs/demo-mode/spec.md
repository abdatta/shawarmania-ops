## ADDED Requirements

### Requirement: Live billing promotion preserves the isolated demo composition

Promoting billing capabilities to `live` SHALL connect real tablet sessions to
live adapters while `/demo` continues to use the complete synthetic billing
lifecycle with no authentication, no IndexedDB delivery and no Supabase writes.

#### Scenario: Demo is opened after live promotion
- **WHEN** a visitor enters the billing walkthrough through `/demo`
- **THEN** the direct-paid, open-order, aggregator, cancelled, unsent, needs-attention and customer-reuse scenarios remain walkable, and no live queue or backend mutation is created
