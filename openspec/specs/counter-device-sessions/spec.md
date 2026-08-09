# Counter Device Sessions

## Purpose

How a tablet becomes one outlet's counter, and how a named person opens a shift
on it from their own phone.

A tablet is a **machine principal**: its Auth user is its `counter_devices` row,
and it has no profile and no assignment. What it may reach comes from the shift
open on it rather than from anything it is, so no shift means no reach. **No
password is ever typed on a tablet**, at setup or afterwards — setup takes a
one-time code generated on an admin's own phone, and opening a shift takes a
username on the tablet and four digits on the operator's own phone.

There is no fallback approver. Only the named person may confirm their own
shift, and the cost of that is recorded in `docs/LIMITATIONS.md` rather than
softened.

## Requirements

### Requirement: A tablet is set up with a one-time code, and no password is typed on it

An authorised admin SHALL generate a single-use setup code for one outlet: a
Franchise Admin only for an outlet they manage, a Super Admin for any active
outlet. The code SHALL be stored only as a hash, be readable by no client role,
expire, and be consumed by its first successful use. Entering it on the tablet
SHALL create the device session. No account password SHALL be accepted on a
tablet at setup or at any time afterwards.

#### Scenario: Manager sets up their outlet tablet
- **WHEN** an FA generates a setup code on their own phone and it is entered on the counter tablet, and no active tablet exists for that outlet
- **THEN** one active tablet is created for that outlet and the browser receives its device session

#### Scenario: A second active tablet is refused
- **WHEN** a setup code is used while the outlet already has an active tablet
- **THEN** setup is refused and neither tablet changes

#### Scenario: Cross-outlet setup is refused
- **WHEN** an FA hand-crafts a setup code request for an outlet they do not manage
- **THEN** no code, Auth identity or tablet row is created

#### Scenario: A code is reused
- **WHEN** a setup code that has already been consumed or has expired is entered
- **THEN** setup is refused and the response reveals nothing about the code's history

#### Scenario: Setup fails midway, before the code is consumed
- **WHEN** the machine identity is created and the redemption is refused for any reason
- **THEN** that identity is deleted, the code is not consumed, and the same code still works

#### Scenario: Setup fails after the code is consumed
- **WHEN** redemption succeeds but the tablet does not establish its session — the response is lost, or the sign-in fails
- **THEN** the code is spent and the tablet row stands, the tablet says so plainly rather than blaming the code, and an admin removes it and issues another

### Requirement: A shift opens only when the named person enters the tablet's code on their own device

On a set-up tablet, opening a shift SHALL take a username and nothing else, and
SHALL create a pending shift request rather than a shift. The server SHALL return
a confirmation code, which the tablet SHALL display. The shift SHALL be created
only when the person that username identifies submits that code from a session
that is not the tablet's. It SHALL succeed only for an active Biller assigned to
that outlet, that outlet's active Franchise Admin, or an active Super Admin. The
shift SHALL record person, tablet, outlet, opened time, business date and expiry.

**Confirming SHALL NOT be possible without the code**, so no single action on the
personal device can open a counter the person cannot see.

#### Scenario: Biller opens the outlet counter
- **WHEN** the outlet's active Biller enters their username on the tablet and then enters the displayed code on their own phone
- **THEN** a shift opens for that person, tablet, outlet and business date, and only billing context is available

#### Scenario: Manager covers the counter
- **WHEN** that outlet's FA does the same
- **THEN** the same billing-only shift opens without exposing manager navigation or authority

#### Scenario: Owner covers the counter
- **WHEN** an SA does the same
- **THEN** a billing-only shift opens for the tablet's own outlet without exposing owner navigation or cross-outlet access

#### Scenario: A wrong code
- **WHEN** the named person submits a code that does not match the request
- **THEN** no shift opens, the attempt is counted, and the surface says only that the code did not match

#### Scenario: Repeated wrong codes
- **WHEN** three wrong codes are submitted for one request
- **THEN** the request is destroyed, no shift opens, and the tablet offers to ask again with a new code

#### Scenario: Ordinary Employee is refused
- **WHEN** an active Employee with no Biller assignment submits the correct code for a tablet
- **THEN** no shift opens and the response discloses no further account or role detail

#### Scenario: Nobody may confirm on another person's behalf
- **WHEN** an FA or SA hand-crafts a confirmation for a request naming a different person, with the correct code
- **THEN** the database refuses it and no shift opens

#### Scenario: The tablet learns nothing from a username
- **WHEN** a username that belongs to nobody is submitted on the tablet
- **THEN** the tablet displays a code and waits, and times out after the same interval as a real request that is never confirmed

### Requirement: The confirmation code is single-use and never stored in the clear

The confirmation code SHALL be generated by the server, stored only as a hash,
consumed by its first correct use, and destroyed with its request. It SHALL be
readable by no client role, and SHALL NOT be returned to any caller other than
the tablet that created the request.

#### Scenario: The code is requested from elsewhere
- **WHEN** any session other than the requesting tablet reads the shift request
- **THEN** the outlet, tablet and time are available and the code is not

#### Scenario: The code is reused
- **WHEN** a code that already opened a shift is submitted again
- **THEN** it is refused and no second shift opens

### Requirement: A shift request is short-lived, single-use, cancellable, and describes itself

A pending shift request SHALL expire within a few minutes, SHALL be consumed by
the first successful confirmation or rejection, and a tablet SHALL hold at most
one pending request at a time. The confirmation surface SHALL state the outlet,
the tablet and the request time, and SHALL offer rejection without the code. A
rejection SHALL be recorded with its time. The tablet SHALL be able to cancel its
own pending request at any point before it resolves.

#### Scenario: A request is left unanswered
- **WHEN** nobody acts on a pending request before it expires
- **THEN** it can no longer be confirmed and the tablet offers to ask again

#### Scenario: A person rejects a request they did not make
- **WHEN** the named person rejects the request, which needs no code
- **THEN** no shift opens, the rejection is recorded with its time, and the tablet reports that the request was declined

#### Scenario: The tablet cancels a mistyped request
- **WHEN** the tablet cancels its pending request
- **THEN** the request resolves as cancelled, no shift opens, and the card is withdrawn from the named person's device rather than left waiting

#### Scenario: A second request while one is pending
- **WHEN** the tablet submits another request while one is still pending
- **THEN** the earlier request is superseded, a new code is issued, and at most one pending request exists for that tablet

### Requirement: A person can end their own shift from their own device

A person holding a live shift SHALL see it on the home surface of their own
shell, with its outlet, tablet and opening time, and SHALL be able to end it from
there. Ending SHALL take effect at the database, and the tablet SHALL stop
accepting new counter work at its next request. Locally accepted work SHALL NOT
be discarded.

#### Scenario: Ending a shift remotely
- **WHEN** the operator ends their live shift from their own phone
- **THEN** the shift is no longer live, the tablet returns to the shift-request screen, and no already-committed local operation is lost

#### Scenario: Somebody else's shift
- **WHEN** any person hand-crafts a request to end a shift they do not hold
- **THEN** the database refuses it

### Requirement: Shifts expire at the outlet cutover

A shift SHALL expire at the next cutover of its outlet. Another shift SHALL
require a fresh request and approval, and the former operator SHALL NOT roll
automatically into the new business day.

#### Scenario: Cutover arrives during an open counter
- **WHEN** the outlet reaches cutover
- **THEN** new work is blocked and the tablet returns to the shift-request screen

#### Scenario: Old work remains attributable
- **WHEN** a command created under the former shift drains after cutoff
- **THEN** it retains that shift, operator, creation time and original business date

### Requirement: Removing a tablet stops it immediately and permanently

Removing a tablet SHALL block its device session at its next request. Removal
SHALL be permanent: there SHALL be no paused state, and returning that hardware
to service SHALL require a fresh setup code. Any live shift on it SHALL end.

#### Scenario: A removed tablet makes an ordinary request
- **WHEN** a still-tokened removed tablet requests billing data or submits work
- **THEN** the request is refused by the database boundary

#### Scenario: Removal with unsent work
- **WHEN** an admin removes a tablet that still reports unsent operations
- **THEN** the surface states what will be left unsent before the removal is confirmed

### Requirement: Tablet management exposes operational facts without queued contents

An FA SHALL see the tablet for outlets they manage and an SA SHALL see every
tablet, each with its setup state, last seen time, last reported unsent count,
and removal. The surface SHALL NOT expose queued payload contents or customer
phone numbers.

#### Scenario: Manager checks their tablet
- **WHEN** an FA opens Tablets
- **THEN** only their outlets' tablets and non-identifying telemetry are returned

#### Scenario: Telemetry is stale
- **WHEN** the tablet has not reported since its displayed timestamp
- **THEN** the surface labels the values as last reported rather than claiming a current count
