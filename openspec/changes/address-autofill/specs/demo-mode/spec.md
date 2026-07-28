## ADDED Requirements

### Requirement: The address search is demonstrable without leaving the app origin

Demo mode SHALL serve address suggestions and district lookups from fixtures
rather than from any external service, so the whole outlet-creation walk —
including picking an address — makes no request to any host but the app's own
origin.

The fixtures SHALL include a place whose PIN code is absent, so the demo shows a
partial fill rather than only the case where everything arrives.

#### Scenario: Picking an address in the demo fills the form

- **WHEN** a demo Super Admin searches while creating an outlet and picks a
  suggestion
- **THEN** the address fields fill from the fixture

#### Scenario: The demo address search makes no off-origin request

- **WHEN** the demo walk searches for an address and picks a suggestion
- **THEN** no network request leaves the app's own origin

#### Scenario: The demo shows a place that fills only part of the address

- **WHEN** a demo admin picks the fixture that carries no PIN code
- **THEN** the fields that place supplies are filled and the rest are left empty
  for typing
