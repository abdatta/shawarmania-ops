## ADDED Requirements

### Requirement: Live billing promotion preserves the isolated demo composition
Promoting billing capabilities to `live` SHALL connect real enrolled-device sessions to live adapters while `/demo` continues to use the complete synthetic billing lifecycle without authentication, IndexedDB delivery, or Supabase writes.

#### Scenario: Demo is opened after live promotion
- **WHEN** a visitor enters the billing walkthrough through `/demo`
- **THEN** the direct-paid, unpaid, cancelled, late, quarantined, recovery, and customer-reuse scenarios remain walkable and no live queue or backend mutation is created
