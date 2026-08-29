# Delta: cash-drawer

## MODIFIED Requirements

### Requirement: Recent counts are scannable summaries

Each recent drawer observation SHALL render as an accessible disclosure whose
closed summary presents, at the same normal prominent scale as the owner's
Billing-history rows:

- the counted amount, labelled `Counted`;
- the existing variance or first-count chip beside it;
- the signed amount collected from that observation; and
- the amount left after that observation's own cash movement.

The count time and recorder attribution SHALL remain available as muted
subtext, and a count date in the current calendar year SHALL omit the repeated
year while an older-year date SHALL retain it. The left amount SHALL equal the existing carry-forward formula — the
counted total less the observation's own signed cash movement — and the row
SHALL NOT introduce a second source of drawer arithmetic. Expanding the row
SHALL preserve the existing detailed movement, location, note and correction
facts and actions. The `Recent counts` heading SHALL sit outside the row cards,
and each observation SHALL have its own card boundary; paging controls and the
end-of-list message SHALL remain outside those row cards.

#### Scenario: A count is scannable without opening it

- **WHEN** a recent count is read in its closed state
- **THEN** Counted, Collected and Left are visible as labelled prominent amounts,
  the variance or first-count chip is beside Counted, and time/recorder context
  remains in the subtext

#### Scenario: Left agrees with the count's carry-forward

- **WHEN** an observation has a signed own cash movement
- **THEN** its closed Left amount equals counted total minus that movement, with
  no new balance calculation or adapter read

#### Scenario: The summary remains a disclosure

- **WHEN** the row is opened or closed
- **THEN** its existing accessible disclosure behavior, detail, paging and
  correction actions continue to work unchanged

#### Scenario: Count records are separated visually

- **WHEN** the Recent counts list contains multiple observations
- **THEN** the heading is not enclosed by a row card, each observation is
  enclosed by its own card, and the list footer is outside those cards

#### Scenario: An expanded card adds context without repeating its summary

- **WHEN** a recent count is expanded
- **THEN** its detail shows expected-at-count when known, recorded location,
  conditional notes or reasons, correction history and the
  relevant action, without repeating Counted, Collected, Left, the count time or
  recorder already shown in the closed summary

#### Scenario: A correction's effective figure is readable in the card

- **WHEN** an anchored count has an adjustment
- **THEN** its expanded detail shows the adjusted-to amount, reason, adjusting
  account and adjustment date, while the unchanged Counted summary remains the
  original observation and is not repeated as a second "previously counted"
  value

#### Scenario: The demo exposes both correction paths

- **WHEN** the drawer is opened in demo mode
- **THEN** the newest count demonstrates a prior in-place fix and an older
  anchored count demonstrates an append-only adjustment
