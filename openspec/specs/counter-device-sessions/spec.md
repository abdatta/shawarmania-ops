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
expire, and be consumed by its first successful use. An unconfigured tablet SHALL
offer a clearly labelled in-app route from the signed-out front door to the setup
form. Entering the code on that tablet SHALL create the device session. No
account password SHALL be accepted on a tablet at setup or at any time
afterwards.

An outlet MAY hold several active tablets, so a valid code SHALL NOT be refused
merely because a counter already exists there.

**An outlet MAY hold several live codes at once**, one per tablet being set up,
and issuing a code SHALL NOT invalidate any other. Setting up two tablets is
therefore not a sequence anybody has to observe, and no admin's unredeemed code
is voided by another admin's.

Because a label must be unique among an outlet's active tablets, an issue naming
a label an active tablet there already holds SHALL be refused **at the point of
asking**, so the admin learns it on their own phone rather than at the counter.
Where two live codes nonetheless carry one label, the first redemption SHALL
succeed and the second SHALL be refused for the label, not fail as an unhandled
write. Neither refusal SHALL disclose anything about another outlet.

**A redeemed code creates a tablet that is not yet a counter.** Redemption and
the browser establishing its session cannot share one transaction, so the row
created by redemption SHALL NOT count as an active tablet, SHALL NOT appear on
the Tablets surface, and SHALL reach nothing, until that session is proven. An
unproven row SHALL expire on its own without any administrative action.

**An unproven row expires with the code that created it.** Its window SHALL be
the expiry already carried by the setup code it redeemed, so no second duration
is introduced and no scheduled job is required: expiry SHALL be evaluated where
the row is read, exactly as code validity already is. A row whose window has
passed SHALL be indistinguishable from one that never existed, to every reader
and every count.

#### Scenario: An unconfigured installed tablet reaches setup
- **WHEN** the signed-out app opens on an unconfigured counter tablet
- **THEN** its sign-in screen offers a clearly labelled link to the setup form,
  without asking the tablet for a personal account password

#### Scenario: Manager sets up their outlet tablet
- **WHEN** an FA generates a setup code on their own phone and it is entered on the counter tablet
- **THEN** an active tablet is created for that outlet once the browser proves its session, and the browser holds that device session

#### Scenario: A second tablet is set up at the same outlet
- **WHEN** a setup code is redeemed on another tablet while the outlet already has an active one
- **THEN** setup succeeds, both tablets are active and independently removable, and neither existing shift, queue nor open order is disturbed

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
- **THEN** the code is spent and the unproven row is not a counter: it appears nowhere, reaches nothing, expires on its own, and a fresh code sets the hardware up without an admin removing anything first

#### Scenario: The tablet proves its session late, inside the window
- **WHEN** a browser that redeemed a code establishes its session before that code's expiry has passed
- **THEN** the row becomes an active tablet at that outlet, with no further code and no admin action

#### Scenario: An unproven row outlives its code's window
- **WHEN** the redeemed code's expiry passes with the session still unproven
- **THEN** the row counts as no tablet anywhere, is absent from management and from every count, and a later sign-in attempt with that identity establishes nothing

#### Scenario: Two admins set up at once
- **WHEN** two setup codes for one outlet are redeemed at the same moment and both browsers prove their sessions
- **THEN** two distinct active tablets exist, each with its own identity and a label unique at that outlet

#### Scenario: A second code is issued while the first is unredeemed
- **WHEN** an FA at the outlet and an SA away from it each generate a setup code for that outlet
- **THEN** both codes remain live and each sets up its own tablet, neither voiding the other

#### Scenario: An issue names a label already at that outlet
- **WHEN** an admin generates a setup code under a label an active tablet at that outlet already holds
- **THEN** it is refused on the admin's own device, naming the collision and nothing about any other outlet

#### Scenario: Two live codes carry one label
- **WHEN** two live codes for one outlet were issued under the same label and both are redeemed
- **THEN** the first becomes an active tablet and the second is refused for the label, with no unhandled write and no half-created identity

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

### Requirement: A person can leave their counter from their own device

A person holding a live shift SHALL see it on their own phone and MAY choose
**Leave counter**. The confirmation SHALL distinguish this immediate remote stop
from ordinary Hand over at the tablet. Leaving takes effect at the database
immediately. The tablet stops exposing new work when it next learns the state,
while its device-level delivery continues.

#### Scenario: Ordinary handover

- **WHEN** one person is replacing another at the counter
- **THEN** the tablet recommends Hand over so the old shift stays live until the incoming person's approval opens the next shift atomically

#### Scenario: Offline tablet learns remote leave late

- **WHEN** the phone ends the shift while the tablet cannot receive the event
- **THEN** the phone says authority ended immediately, and later tablet commands are handled by the explicit after-departure contract rather than silently assigned to the next person

#### Scenario: Incoming operator signs in

- **WHEN** Priya opens a new shift after Rahul remotely left and Rahul's commands are still draining or flagged
- **THEN** Priya's new work belongs only to Priya, Rahul's records remain unchanged, and Priya receives no alert or acknowledgement task for Rahul's attribution exception

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

An FA SHALL see **every** tablet at outlets they manage and an SA SHALL see every
tablet, each with its setup state, last seen time, last reported unsent count,
and removal. The surface SHALL NOT expose queued payload contents or customer
phone numbers. Inspect, removal and health SHALL each name one explicit tablet;
no action SHALL apply to an outlet's tablets collectively.

Each tablet SHALL additionally carry only the counter status needed to manage
hardware: whether a shift is open, the name of the person holding it, and when
it opened. It SHALL NOT show bills rung, open-order counts, payment totals, or
cash contributed to the drawer. Managers read outlet-day Cash and UPI totals in
Billing History Totals and activity counts in their dedicated Billing views.

The reader's authority governs each tablet exactly as it governs its outlet. A
Franchise Admin SHALL receive only the tablets at outlets they are assigned to,
and the database SHALL be what refuses a request for another outlet's — not the
surface. The operator's name is the only personal fact this surface carries;
customer names, phone numbers and bill contents SHALL remain absent.

The surface SHALL state **the moment its status was read**, and every value it
shows SHALL come from that one read. It SHALL offer an explicit re-read, and
SHALL re-read when it is opened. It SHALL NOT subscribe, poll or run a timer:
this is an oversight screen consulted occasionally on a battery-powered phone,
not the counter itself, and the app's badge convention already forbids both.

A reported count SHALL be labelled with the time that tablet reported it, and a
zero SHALL NOT be read as an empty queue on a tablet that has not reported since.

#### Scenario: Manager checks their tablets
- **WHEN** an FA opens Tablets at an outlet with two counters
- **THEN** both appear with their own labels and non-identifying status, no other outlet's tablet appears, and every action names one of them

#### Scenario: Telemetry is stale
- **WHEN** a tablet has not reported since its displayed timestamp
- **THEN** the surface labels the status as last reported rather than claiming it is current

#### Scenario: The owner checks the counters from away from the outlet
- **WHEN** an SA opens Tablets while a shift is open on one of Kalyani's two tablets
- **THEN** each card names its own shift state and, where one is open, the person holding it and when, without displaying bills, orders, payment totals or drawer cash

#### Scenario: No shift is open
- **WHEN** a tablet is set up but nobody holds its counter
- **THEN** the card says so plainly and shows no shift figures, rather than showing zeroes that read as a quiet day

#### Scenario: The status is asked for at an outlet the reader does not hold
- **WHEN** a hand-crafted request asks for another outlet's live shift status
- **THEN** the database refuses it, and refuses it whether or not the surface offered the request

#### Scenario: The reader wants the status again
- **WHEN** the reader re-reads the surface
- **THEN** every status fact and the stated reading time move together for every tablet, and nothing on any card updates between reads

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

### Requirement: A tablet may re-enter its own live shift without the server, and may never open one

A set-up tablet SHALL be able to reopen a shift **it already holds** from its own
resume record when no backend response is available, provided the record is
complete, names this installation, and the shift has not ended and has neither
expired nor passed the outlet cutover.

Requesting, confirming, handing over and leaving a shift SHALL remain online
operations, because each requires the server and the operator's own device. No
offline path SHALL create a shift, extend one, admit a different operator, or
substitute for the four-digit confirmation.

#### Scenario: The tablet resumes the shift it already had

- **WHEN** the tablet cold-starts offline holding a resume record for an unexpired approved shift
- **THEN** the same shift, operator and business date are in force, and no confirmation is requested or accepted

#### Scenario: A new operator arrives during an outage

- **WHEN** somebody attempts to open or hand over a shift while the backend is unreachable
- **THEN** the tablet explains that opening a counter needs the connection and the person's own phone, and no shift changes

#### Scenario: Removal is unknown while offline

- **WHEN** the tablet is removed by an admin while it is offline
- **THEN** the resumed counter cannot learn of it, says plainly that this cannot be checked while offline, and every command it captured is refused by the database once it reconnects

### Requirement: An active tablet's label is unique within its outlet

An active tablet SHALL carry a human-readable label unique among the active
tablets at its outlet, so a manager choosing which counter to remove, and an
operator reading a creator's name on a pipeline card, are never guessing which
till is meant. A label SHALL NOT be a security identifier, and a refusal SHALL
disclose nothing about another outlet's labels.

#### Scenario: A duplicate active label is submitted

- **WHEN** an admin sets up or renames a tablet to a label already held by an active tablet at that outlet
- **THEN** the database refuses it and names the collision without revealing any other outlet's labels

#### Scenario: A removed tablet's label is reused

- **WHEN** a tablet is removed and a replacement is set up under the same label at that outlet
- **THEN** it is accepted, and the removed tablet's history keeps the label it carried

### Requirement: Each tablet runs its own shifts

Every tablet SHALL create and enforce its own shifts. A shift SHALL authorise
only the tablet and outlet recorded on it, and ending, expiring or removing one
tablet's shift SHALL NOT touch a shift on another tablet.

#### Scenario: One operator holds two counters

- **WHEN** one eligible person opens a shift on each of two tablets at the same outlet, confirming each from their own phone
- **THEN** two distinct shifts exist, and every command is attributed to the tablet and shift that actually produced it

#### Scenario: One shift ends

- **WHEN** a person leaves the counter on one tablet from their phone
- **THEN** only that tablet returns to its shift-request screen, and the other counter is unaffected
