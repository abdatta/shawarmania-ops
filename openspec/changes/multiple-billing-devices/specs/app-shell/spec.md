## ADDED Requirements

### Requirement: Tablet management navigates a collection, never a singleton

Authorised FA and SA navigation SHALL list every tablet in the reader's scope,
grouped by outlet, and SHALL require an explicit tablet for inspect, removal and
health. No entry point SHALL assume an outlet has exactly one tablet, and an
outlet with none SHALL say so rather than rendering an empty card that reads as
hardware standing at a counter.

A tablet awaiting proof of its session SHALL NOT appear at all.

#### Scenario: An outlet with two counters

- **WHEN** an admin opens Tablets for an outlet holding two active tablets
- **THEN** both are listed with their own labels and status, and every action names the one it will act on

#### Scenario: An outlet with no counter

- **WHEN** an admin opens Tablets for an outlet where none is set up
- **THEN** the surface says no tablet is set up there and offers the setup code path, rather than showing a blank tablet

#### Scenario: An unproven setup is invisible

- **WHEN** a setup code has been redeemed but the browser has not proven its session
- **THEN** nothing appears on the surface, and nothing needs removing before another code is issued
