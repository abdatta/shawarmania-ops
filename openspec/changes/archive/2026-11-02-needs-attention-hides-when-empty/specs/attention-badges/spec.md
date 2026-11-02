## MODIFIED Requirements

### Requirement: Overview summarises badged destinations

Overview SHALL derive one Needs attention row per visible badged destination from the same shared count and permissions as navigation. A row SHALL show the complete count and description, link to that page, and disappear at zero. Once every row has read and none has anything waiting, Overview SHALL leave the Needs attention section out entirely rather than show it empty. Adding a new badged page SHALL NOT require editing Overview. Group badges SHALL NOT duplicate their children. Attendance SHALL be one approvals row across authorised outlets.

#### Scenario: Nested work becomes visible

- **WHEN** Attendance has five waiting approvals and Delivery has three issues
- **THEN** Overview shows one five-approval row and one three-delivery-issue row with counts identical to navigation

#### Scenario: Nothing waiting

- **WHEN** every badged destination's count has read zero
- **THEN** Overview shows no Needs attention section, neither its heading nor a line saying nothing is waiting
