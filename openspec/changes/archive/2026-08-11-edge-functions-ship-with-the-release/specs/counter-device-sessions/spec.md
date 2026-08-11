## ADDED Requirements

### Requirement: A server-side fault on the tablet path is reported as a fault, not as a bad code or a bad connection

Every tablet setup and tablet administration action SHALL classify a failure by
the evidence it actually has, and SHALL NOT report a cause it has not
established.

- A failure carrying **positive evidence that no response arrived** SHALL be
  reported as a connection problem, and SHALL ask the person to check the
  connection.
- A response **naming a reason the action recognises** SHALL be reported as that
  reason.
- A response **naming a reason the action does not recognise, or naming none at
  all**, including one reporting that the endpoint does not exist, SHALL be
  reported as an action that could not be sent: it SHALL state that nothing was
  recorded and ask for the fault to be reported, and SHALL NOT invite a retry,
  SHALL NOT attribute the failure to the device's connection, and SHALL NOT
  attribute it to the setup code.

A fault raised before a setup code is examined SHALL NOT be reported as a
failure of that code.

Enumeration safety is unchanged by this classification. A missing endpoint and a
server-side fault are properties of the service and occur identically for every
code, valid or not, so telling them apart from a refusal reveals nothing about
which codes exist. Every refusal raised after a code is examined SHALL remain
one indistinguishable response.

#### Scenario: The tablet endpoint is not deployed

- **WHEN** a setup code is entered on a tablet and the setup endpoint does not
  exist
- **THEN** the tablet states the action could not be sent and asks for it to be
  reported, and does not say the code expired, was used, or is wrong

#### Scenario: Issuing a setup code reaches a missing endpoint

- **WHEN** an admin generates a setup code on their own device and the
  administration endpoint does not exist
- **THEN** the screen states the action could not be sent and asks for it to be
  reported, and does not tell them to check the device's internet connection

#### Scenario: The service faults before the code is examined

- **WHEN** setup fails because the machine identity could not be created
- **THEN** the tablet reports a fault to report rather than a failed code, and
  the code remains usable

#### Scenario: A genuinely unreachable service still says so

- **WHEN** a tablet action produces no HTTP response at all
- **THEN** the person is told the service could not be reached and to check the
  connection, exactly as before

#### Scenario: A refused code is still indistinguishable

- **WHEN** a setup code is unknown, expired, already consumed, superseded, or
  has exhausted its attempts
- **THEN** one identical refusal is shown, naming none of those reasons
