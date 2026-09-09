## ADDED Requirements

### Requirement: Overview summarises badged destinations

Overview SHALL derive one Needs attention row per visible badged destination from the same shared count and permissions as navigation. A row SHALL show the complete count and description, link to that page, and disappear at zero. Adding a new badged page SHALL NOT require editing Overview. Group badges SHALL NOT duplicate their children. Attendance SHALL be one approvals row across authorised outlets.

#### Scenario: Nested work becomes visible

- **WHEN** Attendance has five waiting approvals and Delivery has three issues
- **THEN** Overview shows one five-approval row and one three-delivery-issue row with counts identical to navigation

### Requirement: A blocked integration counts once

Delivery attention SHALL count each of Zomato, Swiggy and Hyperpure once when it requires intervention, irrespective of repeated runs or affected outlets, and SHALL retain distinct outstanding reconciliation and duplicate-expense work. A normal running sync SHALL NOT count as an issue.

#### Scenario: All integrations stuck

- **WHEN** all three integrations require intervention and no other delivery work waits
- **THEN** Delivery navigation shows 3 and Overview shows one row for 3 delivery issues

#### Scenario: Advisory session expiry passes after a successful read

- **WHEN** a stored provider session expiry has passed but the integration still has a session and its latest read succeeded
- **THEN** Delivery navigation and Overview show no issue for that timestamp alone

### Requirement: Delivery count surfaces share one channel breakdown

Delivery navigation, Overview, outlet chips and the channel switch SHALL derive from the same Zomato-family and Swiggy-family attention sources. Hyperpure SHALL belong to the Zomato family. Top-level totals SHALL count an account-level integration problem once; an outlet-scoped control MAY repeat that shared problem when its repair is available from each outlet view, and repeated scoped badges SHALL NOT be summed as separate work.

#### Scenario: Hyperpure alone needs intervention

- **WHEN** Hyperpure requires intervention and no Zomato, Swiggy, reconciliation or duplicate-expense work waits
- **THEN** Delivery navigation and Overview show one issue, the Zomato segment and outlet scopes leading to its repair show one, and the Swiggy segment shows zero
