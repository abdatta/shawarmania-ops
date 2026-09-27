## MODIFIED Requirements

### Requirement: Tablet management navigates a collection, never a singleton

Authorised FA and SA readers SHALL manage tablets from the outlet's own page on
Outlets, which SHALL list every tablet at that outlet and SHALL require an
explicit tablet for inspect, edit and removal. No entry point SHALL assume an
outlet has exactly one tablet, and an outlet with none SHALL say so rather than
rendering an empty card that reads as hardware standing at a counter.

There SHALL be no separate Tablets page, and no address other than the outlet's
own that reaches tablet management.

A tablet awaiting proof of its session SHALL NOT appear at all.

#### Scenario: An outlet with two counters

- **WHEN** an admin opens an outlet holding two active tablets
- **THEN** both are listed on its page with their own labels and status, and every action is on the card of the one it will act on

#### Scenario: An outlet with no counter

- **WHEN** an admin opens an outlet where no tablet is set up
- **THEN** its page says no tablet is set up there and offers the setup code path, rather than showing a blank tablet

#### Scenario: An unproven setup is invisible

- **WHEN** a setup code has been redeemed but the browser has not proven its session
- **THEN** nothing appears on the page, and nothing needs removing before another code is issued
