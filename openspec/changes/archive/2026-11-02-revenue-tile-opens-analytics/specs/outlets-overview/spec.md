## MODIFIED Requirements

### Requirement: Metrics link to the displayed source scope

Today's revenue SHALL link to that outlet's Billing history for today; Drawer SHALL link to its Drawer page; the month's revenue SHALL link to its Analytics Sales page on the Month shortcut with Revenue as the measure; P&L SHALL link to its Ledger in the displayed month view. Demo SHALL use the same layout, calculations and source scope with no real-data writes. Database reads SHALL reject a manager requesting another outlet.

#### Scenario: Current-month card

- **WHEN** a viewer taps October revenue on October 15
- **THEN** Sales opens that outlet on Month, 1 to 15 October, measuring Revenue, including on reload

#### Scenario: Current-month P&L

- **WHEN** a viewer taps October P&L on October 15
- **THEN** the Ledger opens that outlet in October month view, including on reload

#### Scenario: Today's revenue

- **WHEN** a viewer taps today's revenue
- **THEN** Billing history opens that outlet on today
