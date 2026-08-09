## MODIFIED Requirements

### Requirement: Billing requires a shift, confirmed by a code on the operator's own device

The billing surface SHALL NOT accept counter work unless a shift is live, and
SHALL say what to do when none is. Opening one SHALL require a username on the
tablet, and that person entering the tablet's displayed code from a session that
is not the tablet's, and SHALL succeed only for an active Biller of that outlet,
that outlet's active Franchise Admin, or an active Super Admin. **No counter PIN
SHALL exist, and no password SHALL be typed on the tablet.**

The shift SHALL be attributed to the confirming person and the tablet, carry an
explicit business date, and expire at the outlet's next cutover.

#### Scenario: No shift live
- **WHEN** the billing surface opens with no live shift
- **THEN** it asks for a username rather than showing an actionable billing form

#### Scenario: Waiting for confirmation
- **WHEN** a request has been submitted and not yet resolved
- **THEN** the tablet displays the code large enough to read across the counter, states which person was asked, and offers to cancel

#### Scenario: The counter opens by itself
- **WHEN** the named person enters the correct code on their own device
- **THEN** the tablet enters billing without anybody touching it again

#### Scenario: Unknown username
- **WHEN** a username belonging to nobody is submitted
- **THEN** the tablet displays a code and waits, and times out after the same interval as an unconfirmed real request

#### Scenario: Handover on the same tablet
- **WHEN** one operator's shift ends and another eligible operator's request is approved
- **THEN** new work is attributed to the incoming operator while old work keeps its original attribution

#### Scenario: Cutover expires the shift
- **WHEN** the outlet reaches its cutover
- **THEN** the shift accepts no new work until a fresh request is approved
