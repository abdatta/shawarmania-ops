## ADDED Requirements

### Requirement: A bill's receipt link is shared from the bill itself

> Applies after #53's `counter-billing` delta. This change adds one control to the
> action row and restates none of #53's discount requirements.

An expanded bill in Billing history SHALL offer a Share control, for the Super
Admin and the Franchise Admin, positioned in the same action row as the
cancellation control and **before** it.

The control SHALL be offered only for a bill that is not void, and SHALL NOT be
offered on the counter tablet.

The control SHALL read a link that already exists rather than creating one, and
SHALL grant no visibility a role did not already hold: a role SHALL be able to
share only a bill it can already read, and never another outlet's.

#### Scenario: An owner shares a receipt

- **WHEN** the Super Admin expands a settled bill in Billing history
- **THEN** a Share control is offered before the cancellation control, and yields
  that bill's receipt link

#### Scenario: A franchise admin and another outlet

- **WHEN** a Franchise Admin uses Billing history
- **THEN** they may share bills at their own outlet only, because those are the
  only bills the surface shows them

#### Scenario: A cancelled bill

- **WHEN** a void bill is expanded
- **THEN** no Share control is offered, and any link already issued for it
  continues to resolve and reports the cancellation

### Requirement: Sharing degrades to the most capable thing the device offers

The Share control SHALL offer the device's own share facility where one exists,
SHALL copy the link to the clipboard where it does not, and SHALL present the link
as selectable text where neither is available.

Where the link could not be placed on the clipboard, the control SHALL NOT report
that it was copied.

#### Scenario: On a phone

- **WHEN** the control is used on a device offering a native share facility
- **THEN** that facility opens carrying the receipt link

#### Scenario: Where the clipboard is unavailable

- **WHEN** the clipboard cannot be written, as on a counter tablet served over
  plain HTTP
- **THEN** the link is shown as selectable text and no success is claimed
