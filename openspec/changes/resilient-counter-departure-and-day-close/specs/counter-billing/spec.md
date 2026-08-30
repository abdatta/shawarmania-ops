## ADDED Requirements

### Requirement: Post-departure bills preserve money and expose qualified attribution

An accepted bill recorded after remote shift end SHALL carry the original shift
and operator as last-known context, the immutable remote end time, and an explicit
after-departure flag. It SHALL receive an ordinary bill number and participate in
revenue, tender totals and drawer arithmetic. It SHALL NOT become part of a later
operator's My Shift.

Manager and owner billing history SHALL disclose the exception without exposing
it to an unrelated incoming operator. An authorised reviewer SHALL append one
attributed outcome: confirm the original operator, name another eligible person,
or state that the operator cannot be established with a reason. Review SHALL NOT
rewrite the bill, its original operator, shift, command receipt, or flag.

#### Scenario: Owner reads a flagged bill

- **WHEN** the owner opens billing history containing a sale recorded after remote departure
- **THEN** the bill states the original operator context, sale time, shift end time and review state while remaining included in every financial total

#### Scenario: Franchise Admin reviews their outlet

- **WHEN** an assigned manager records an attribution outcome for a flagged bill at their outlet
- **THEN** one append-only review stores the outcome, reviewer and instant, while another outlet's manager is refused by the database

#### Scenario: Next operator reads My Shift

- **WHEN** Priya opens a new shift on the same tablet
- **THEN** Rahul's flagged bill is absent from Priya's My Shift and creates no alert for her
