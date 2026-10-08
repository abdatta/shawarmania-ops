## ADDED Requirements

### Requirement: A tablet is a counter or a kitchen, and an admin changes which

Every set-up tablet SHALL have a kind, `counter` or `kitchen`. Setup SHALL produce a
counter. A Super Admin MAY change the kind of any tablet, and a Franchise Admin MAY
change the kind of a tablet at an outlet they actively manage, from the Tablets
section's Edit action; the database SHALL enforce this independently of the
surface. The tablet's identity, name, outlet, session and history SHALL be
unchanged.

Changing the kind, in either direction, SHALL cancel any pending shift request on
the tablet, end any live shift on it with the reason `device_kind_changed`, and set
the kind, all in one transaction. The tablet SHALL then show the shift-start screen
of its new kind.

Changing a tablet to `kitchen` SHALL be refused, naming what is outstanding, while
its latest sufficiently fresh device report does not state zero unresolved local
work, or while any order it took is open or paid and not prepared. Changing a tablet
to `counter` SHALL NOT be refused on those grounds.

#### Scenario: A counter becomes a kitchen at the start of the day

- **WHEN** an FA changes a tablet with no live shift, no unresolved work and no unfinished orders to Kitchen
- **THEN** the tablet shows the kitchen's shift-start screen and keeps its name and outlet

#### Scenario: A live shift is ended by the change

- **WHEN** an owner changes a kitchen tablet holding Asha's live kitchen shift to Counter
- **THEN** Asha's shift ends with reason `device_kind_changed`, and the tablet shows the counter's shift-start screen for somebody to start a new shift

#### Scenario: The counter still owes an order

- **WHEN** an FA tries to change a counter tablet to Kitchen while an order it took is paid and not prepared
- **THEN** the change is refused naming that order, and nothing about the tablet changes

#### Scenario: Unsent work

- **WHEN** an FA tries to change a counter tablet to Kitchen while its latest report states unsent work
- **THEN** the change is refused saying so

#### Scenario: Another outlet's FA

- **WHEN** an FA hand-crafts a kind change for a tablet at an outlet they do not manage
- **THEN** the database refuses it

### Requirement: A kitchen shift opens like a counter shift and reaches only the kitchen

A kitchen tablet SHALL open a shift through the same request, displayed code and
confirmation on the person's own device as a counter, worded for the kitchen, and
SHALL admit the same people: an active Biller assigned to that outlet, its active
Franchise Admin, or an active Super Admin. The shift SHALL record kind `kitchen` and
SHALL expire, be handed over, be left and be ended by removal exactly as a counter
shift is. One person MAY hold a counter shift and a kitchen shift at the same time.

A kitchen shift SHALL reach only: its outlet's kitchen board, its outlet's menu
categories, its own tablet's filter, its own acknowledgements, its outlet's change
notification, and the tablet's own device, request, shift and heartbeat rows. It
SHALL issue no billing command and SHALL read no bill, payment, customer, expense,
drawer, ledger or order row directly. Every such refusal SHALL be by the database,
proved by hand-crafted request.

A kitchen shift SHALL NOT hold a business day open, and Finish Day SHALL neither
wait for nor end it.

#### Scenario: The biller opens the kitchen

- **WHEN** the outlet's Biller enters their username on the kitchen tablet and the displayed code on their own phone
- **THEN** a kitchen shift opens and the kitchen screen shows

#### Scenario: One person, two jobs

- **WHEN** a person holding a live counter shift opens a kitchen shift on the kitchen tablet
- **THEN** both shifts are live and neither ends the other

#### Scenario: No shift, no orders

- **WHEN** a kitchen tablet with no live kitchen shift hand-crafts a read of its outlet's kitchen board
- **THEN** the database refuses it

#### Scenario: A kitchen shift tries to bill

- **WHEN** a kitchen tablet with a live kitchen shift hand-crafts a create-order, pay or prepare command, a customer lookup, or a read of bills, orders or expenses
- **THEN** the database refuses each one

#### Scenario: Finish Day with a kitchen running

- **WHEN** a counter tablet finishes the day while a kitchen shift is live at the outlet
- **THEN** the day closes and the kitchen shift continues until its own end

## RENAMED Requirements

- FROM: `### Requirement: A person can leave their counter from their own device`
- TO: `### Requirement: A person can leave any of their shifts from their own device`

## MODIFIED Requirements

### Requirement: A person can leave any of their shifts from their own device

A person holding a live shift SHALL see it on their own phone and MAY choose to
leave it. A person holding more than one live shift SHALL see each as its own row
naming its kind, tablet and start time, grouped by outlet, each with its own
**Leave**; the confirmation SHALL name the kind and the tablet being left. A person
holding one shift SHALL see one row, with **Leave counter** or **Leave kitchen** as
its kind requires. The confirmation SHALL distinguish this immediate remote stop
from ordinary Hand over at the tablet. Leaving takes effect at the database
immediately and SHALL end only the shift chosen. The tablet stops exposing new work
when it next learns the state, while its device-level delivery continues.

#### Scenario: Ordinary handover

- **WHEN** one person is replacing another at the counter
- **THEN** the tablet recommends Hand over so the old shift stays live until the incoming person's approval opens the next shift atomically

#### Scenario: Offline tablet learns remote leave late

- **WHEN** the phone ends the shift while the tablet cannot receive the event
- **THEN** the phone says authority ended immediately, and later tablet commands are handled by the explicit after-departure contract rather than silently assigned to the next person

#### Scenario: Incoming operator signs in

- **WHEN** Priya opens a new shift after Rahul remotely left and Rahul's commands are still draining or flagged
- **THEN** Priya's new work belongs only to Priya, Rahul's records remain unchanged, and Priya receives no alert or acknowledgement task for Rahul's attribution exception

#### Scenario: Leaving one of two shifts

- **WHEN** a person holding a counter shift on Till 1 and a kitchen shift on Kitchen 1 presses Leave on the kitchen row and confirms *Leave the kitchen on Kitchen 1?*
- **THEN** only the kitchen shift ends, and Till 1 keeps billing under the counter shift
