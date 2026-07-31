# Outlet Tenancy (delta)

## MODIFIED Requirements

### Requirement: An outlet is created and edited from the app, by the owner only

The Super Admin SHALL be able to create an outlet and edit an existing one from
a surface in the app, supplying its code, name, location label, address, phone,
business-day cutover, arrival deadline and active state. No other role SHALL be
offered either action, and the database SHALL refuse both for any other role
regardless of what a client sends — the `outlets_insert` and `outlets_update`
policies are the boundary, not the presence of a button.

An outlet code SHALL be unique across the business, and an attempt to reuse one
SHALL be refused with a message naming the collision rather than a raw database
error.

The business-day cutover SHALL be presented as the seam between two trading
days rather than as an opening time, and the form SHALL resolve a full trading
session against the value currently entered — stating which business day each
moment would be filed under, and warning when one session would be split across
more than one business day. The value is still accepted: this is a warning
about a choice, not a validation rule, because no outlet's real hours are known
to the form.

The arrival deadline SHALL be presented as the time by which staff are expected
to have arrived, distinct from the cutover, and SHALL default to 13:00 for a
new outlet. Editing it SHALL state that it applies to arrivals recorded from
then on and does not change how any already recorded day reads.

#### Scenario: The owner creates the first outlet

- **WHEN** a Super Admin with no outlets in the database submits a new outlet
- **THEN** the outlet exists, appears in the list, and is immediately available
  to assign accounts to

#### Scenario: A Franchise Admin cannot create or edit an outlet

- **WHEN** a Franchise Admin's session attempts to insert an outlet, or to
  update any outlet row including their own
- **THEN** the database refuses the write, and no outlet surface is offered to
  that role

#### Scenario: A duplicate outlet code is refused legibly

- **WHEN** a Super Admin submits an outlet whose code is already in use
- **THEN** the write is refused and the form explains that the code is taken

#### Scenario: An opening time typed into the cutover is shown splitting a night

- **WHEN** a Super Admin enters a cutover that falls inside trading hours, such
  as the outlet's opening time
- **THEN** the form states the window that business day would then cover, shows
  at least one moment of a single trading session landing on a different
  business day from the rest, and warns that one night's trading would be split
  across two business days

#### Scenario: A new outlet arrives with a default deadline

- **WHEN** a Super Admin creates an outlet without changing the arrival
  deadline
- **THEN** the outlet is stored with an arrival deadline of 13:00

#### Scenario: A Franchise Admin cannot move the arrival deadline

- **WHEN** a Franchise Admin's session attempts to write an arrival deadline
  for their own outlet
- **THEN** the database refuses the write
