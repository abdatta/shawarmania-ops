## MODIFIED Requirements

### Requirement: Billing requires a device-bound shift opened with normal credentials

The billing surface SHALL NOT accept counter work unless a shift/billing grant
is open and SHALL say what to do when none is. Opening one SHALL require normal
account credentials on the registered device and SHALL succeed only for an
active Biller of that outlet, that outlet's active Franchise Admin, or an active
Super Admin. Credential failure SHALL use the ordinary enumeration-safe sign-in
responses. No counter PIN SHALL exist.

The shift SHALL be attributed to the authenticated person and registered device,
carry an explicit business date, and expire at the outlet's next cutover.

#### Scenario: No shift open
- **WHEN** the billing surface opens with no live grant
- **THEN** it asks an eligible operator to sign in rather than showing an actionable billing form

#### Scenario: Wrong credentials
- **WHEN** an unknown identifier or wrong password is submitted
- **THEN** no shift opens and the ordinary uniform credential refusal is shown

#### Scenario: Ineligible Employee authenticates
- **WHEN** an active Employee without a Biller assignment enters correct credentials
- **THEN** no shift opens and no additional account or role detail is disclosed

#### Scenario: Handover on the same device
- **WHEN** one operator closes their shift and another eligible operator authenticates
- **THEN** new work is attributed to the incoming operator while old work retains its original attribution

#### Scenario: Cutover expires the shift
- **WHEN** the outlet reaches its cutover
- **THEN** the shift accepts no new work until an eligible operator authenticates online again
