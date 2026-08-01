## ADDED Requirements

### Requirement: Billing lifecycle surfaces are gated by context and readiness

The registry SHALL define Counter composer, Open orders, My shift, manager bill
history, and billing recovery as separate gated surfaces. Counter-device routes
SHALL expose only Counter-context entries; personal FA/SA shells SHALL expose
their authorized history/recovery entries. Until billing-live, all new entries
SHALL be absent for real users and walkable in demo mode.

#### Scenario: Demo Counter navigation
- **WHEN** demo mode renders Counter shell after this change
- **THEN** composer, Open orders, and My shift are reachable and no personal admin navigation appears

#### Scenario: Real user before promotion
- **WHEN** a real signed-in user loads the application before billing-live
- **THEN** the new billing lifecycle entries remain absent rather than disabled
