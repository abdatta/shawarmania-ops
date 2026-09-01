## ADDED Requirements

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

## MODIFIED Requirements

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

**A redeemed code creates a tablet that is not yet a counter.** Redemption and
the browser establishing its session cannot share one transaction, so the row
created by redemption SHALL NOT count as an active tablet, SHALL NOT appear on
the Tablets surface, and SHALL reach nothing, until that session is proven. An
unproven row SHALL expire on its own without any administrative action.

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

#### Scenario: Two admins set up at once
- **WHEN** two setup codes for one outlet are redeemed at the same moment and both browsers prove their sessions
- **THEN** two distinct active tablets exist, each with its own identity and a label unique at that outlet

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
