## ADDED Requirements

### Requirement: An authorized admin enrolls one active billing device per outlet

The system SHALL let a Franchise Admin enroll the current device only for an
outlet they manage and SHALL let a Super Admin enroll it for any active outlet.
Enrollment SHALL bind a machine credential to exactly one outlet and the
database SHALL permit no more than one unrevoked device for that outlet.

#### Scenario: Franchise Admin enrolls their outlet tablet
- **WHEN** an FA enrolls the current browser for their assigned outlet and no active device exists there
- **THEN** one active device is created for that outlet and the browser receives its machine session

#### Scenario: A second active device is refused
- **WHEN** any admin attempts to enroll another device while the outlet already has an unrevoked device
- **THEN** enrollment is refused without changing either device

#### Scenario: Cross-outlet enrollment is refused
- **WHEN** an FA hand-crafts enrollment for an outlet they do not manage
- **THEN** no Auth identity or device row is created

### Requirement: Enrollment leaves no personal admin session on the tablet

After successful enrollment, the application SHALL remove the enrolling
person's session and establish only the machine session. Failure SHALL leave the
person signed in and SHALL NOT leave a usable partial device.

#### Scenario: Enrollment succeeds
- **WHEN** an FA or SA completes enrollment
- **THEN** the app reloads in billing-device context and their personal session cannot call personal or admin adapters

#### Scenario: Enrollment fails midway
- **WHEN** the privileged enrollment operation cannot complete
- **THEN** the admin remains signed in, no active partial device can authenticate, and retry is safe

### Requirement: Normal credentials create a daily billing grant without persisting a personal session

On a registered device, normal username/password verification SHALL create a
billing grant only for an active Biller assigned to that outlet, that outlet's
active FA, or an active SA. The grant SHALL record person, device, outlet,
opened time, business date, and expiry. Human tokens SHALL NOT be persisted.

#### Scenario: Biller opens the outlet counter
- **WHEN** the outlet's active Biller authenticates correctly on its registered device
- **THEN** a grant for that person, device, outlet, and business date opens and only billing context is available

#### Scenario: Franchise Admin covers the counter
- **WHEN** that outlet's FA authenticates on the device
- **THEN** the same billing-only grant opens without exposing manager navigation or authority

#### Scenario: Super Admin covers the counter
- **WHEN** an SA authenticates on the registered device
- **THEN** a billing-only grant opens for the device's fixed outlet without exposing owner navigation or cross-outlet access

#### Scenario: Ordinary Employee is refused
- **WHEN** an Employee who is not a Biller authenticates on the counter
- **THEN** no grant opens and the response reveals no additional account information

### Requirement: Billing grants expire at the outlet cutover

A billing grant SHALL expire at the next cutover of its outlet. The application
SHALL require online credential verification for another grant and SHALL NOT
automatically roll the former operator into the new business day.

#### Scenario: Cutover arrives during an open counter
- **WHEN** the outlet reaches cutover
- **THEN** new work is blocked, the operator is signed out of billing context, and online sign-in is required

#### Scenario: Old work remains attributable
- **WHEN** a command created under the former grant drains after cutoff
- **THEN** it retains that grant, operator, creation time, and original business date

### Requirement: Device revocation is immediate and recovery is upload-only

Revoking a device SHALL block its machine session at the next ordinary request.
An FA for that outlet or an SA MAY authenticate physically on the revoked device
to submit historically valid pending operations through a recovery-only path.
Recovery SHALL NOT restore reads, registration, grants, or new command creation.

#### Scenario: Revoked device makes an ordinary request
- **WHEN** a still-tokened revoked device requests billing data or submits through the ordinary path
- **THEN** the request is refused by the database boundary

#### Scenario: Admin recovers pending work
- **WHEN** an authorized admin authenticates on that tablet and submits an operation proven to predate revocation under a valid grant
- **THEN** the operation may be accepted through recovery and is visibly flagged with the recovering admin

#### Scenario: Recovery attempts a new operation
- **WHEN** recovery submits an operation without valid historical grant and creation evidence
- **THEN** it is refused and the device remains revoked

### Requirement: Device management exposes operational facts without queued PII

FA SHALL see the device for their outlet and SA SHALL see every device, including
registration state, last seen time, last reported pending count, and revocation.
The management surface SHALL NOT expose queued payload contents or customer phones.

#### Scenario: Manager checks their device
- **WHEN** an FA opens Devices
- **THEN** only their outlet's device and non-PII telemetry are returned

#### Scenario: Telemetry is stale
- **WHEN** the device has not reported since its displayed timestamp
- **THEN** the surface labels the values as last reported rather than claiming a current queue count
