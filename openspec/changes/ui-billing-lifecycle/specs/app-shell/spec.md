## ADDED Requirements

### Requirement: Billing lifecycle surfaces are gated by context and readiness

The registry SHALL define the Counter composer, Open orders, My shift and manager
bill history as separate gated surfaces. Tablet routes SHALL expose only
Counter-context entries; personal FA and SA shells SHALL expose their authorised
history entries. Until billing goes live, every new entry SHALL be absent for
real users and walkable in demo mode.

#### Scenario: Demo Counter navigation
- **WHEN** demo mode renders the Counter shell after this change
- **THEN** the composer, Open orders and My shift are reachable and no personal admin navigation appears

#### Scenario: Real user before promotion
- **WHEN** a real signed-in user loads the application before billing goes live
- **THEN** the new billing entries remain absent rather than disabled
