## ADDED Requirements

### Requirement: A demo receipt link is demonstrable and never resolves

The Share control SHALL be present and operable in demo mode, so that the whole
receipt story can be walked in a demonstration.

A link produced in demo mode SHALL NOT resolve to a receipt. Demo fixtures SHALL
carry tokens that no public reader will ever serve, and demo mode SHALL NOT be
capable of reading, revoking or issuing a real bill's link.

#### Scenario: Sharing during a demonstration

- **WHEN** a bill is expanded and shared in demo mode
- **THEN** the control behaves as it does in the real app and yields a link

#### Scenario: The demo link is opened

- **WHEN** a link obtained in demo mode is opened publicly
- **THEN** it is refused, identically to any other token that resolves to no bill
