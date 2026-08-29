# Delta: cash-drawer

## MODIFIED Requirements

### Requirement: The count history is paged and each count is a disclosure

The surface SHALL present past counts newest first as accessible disclosures.
Each closed row SHALL present at the same normal prominent scale as the owner's
Billing-history rows:

- the counted amount, labelled `Counted`;
- the existing matched, short, over or first-count verdict beside it;
- any broken opening;
- the signed amount collected from that observation; and
- the amount left after that observation's own cash movement.

The count time and recorder attribution SHALL remain available as muted
subtext. Today and yesterday SHALL retain their relative labels; an earlier
date in the current calendar year SHALL omit the repeated year, while an
older-year date SHALL retain it. The left amount SHALL use the existing
carry-forward formula—counted total less the observation's own signed cash
movement—and SHALL NOT introduce a second source of drawer arithmetic.

Expanding a row SHALL add expected-at-count when known, recorded location, a
delayed-save timestamp where relevant, conditional notes or reasons, contextual
first-count or opening-break explanations, correction history and the relevant
edit or adjust action. It SHALL NOT repeat Counted, Collected, Left, the count
time or recorder already visible in the closed summary. An anchored
adjustment's detail SHALL show the adjusted-to amount, reason, adjusting account
and adjustment date while the unchanged closed Counted value remains the
original observation. A newest count fixed in place SHALL name the last fixing
account when it differs from the recorder.

The `Recent counts` heading SHALL sit outside the row cards, and each
observation SHALL have its own card boundary. Paging controls and the
end-of-list message SHALL remain outside those cards. The history SHALL be
paged rather than capped: the surface SHALL be able to reach every count an
outlet has ever recorded in bounded reads without loading them all. Paging SHALL
be cursored on the counted instant rather than an offset, so a count recorded
while somebody is reading cannot duplicate or skip a row. The surface SHALL
state when it has reached the oldest count and SHALL offer a control that loads
the next page as well as loading it on scroll.

#### Scenario: A count is scannable without opening it

- **WHEN** a recent count is read in its closed state
- **THEN** Counted, Collected and Left are visible as labelled prominent amounts, the variance or first-count chip is beside Counted, and time and recorder context remain in the subtext

#### Scenario: Left agrees with the count's carry-forward

- **WHEN** an observation has a signed own cash movement
- **THEN** its closed Left amount equals counted total minus that movement, with no new balance calculation or adapter read

#### Scenario: The detail is not rendered until it is asked for

- **WHEN** a count row is closed
- **THEN** its expected amount, location, conditional notes or reasons, correction history and correction action are absent from the rendered output

#### Scenario: An expanded card adds context without repeating its summary

- **WHEN** a recent count is expanded
- **THEN** its contextual detail and relevant correction action are readable without repeating Counted, Collected, Left, the count time or recorder

#### Scenario: A correction's effective figure is readable in the card

- **WHEN** an anchored count has an adjustment
- **THEN** its expanded detail shows the adjusted-to amount, reason, adjusting account and adjustment date, while the unchanged Counted summary remains the original observation and is not repeated as a second previously-counted value

#### Scenario: Count records are separated visually

- **WHEN** Recent counts contains multiple observations
- **THEN** the heading is not enclosed by a row card, each observation is enclosed by its own card, and the list footer is outside those cards

#### Scenario: Reaching past the first page

- **WHEN** an outlet holds more counts than one page
- **THEN** the next page loads on demand, continues from the oldest row already shown, and the surface says when there are no more

#### Scenario: The demo exposes both correction paths

- **WHEN** the drawer is opened in demo mode
- **THEN** the newest count demonstrates a prior in-place fix and an older anchored count demonstrates an append-only adjustment with the same correction attribution a live write records
