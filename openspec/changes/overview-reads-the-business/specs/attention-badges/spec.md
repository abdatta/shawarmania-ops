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
