# Billing Delivery

## Purpose

Guarantees that a counter accepts work into a durable local store before acknowledging it, drains one replay-safe dependency graph from one leader, classifies outcomes from real request evidence, preserves unresolved work across shifts and updates, and finishes a business day only after the online queue is resolved.

## Requirements

### Requirement: Counter acknowledgement is a durable local commit

The system SHALL write an immutable, versioned billing command envelope to the
tablet's IndexedDB before it reports success or clears the operator's form, and
SHALL NOT require a network response for that acknowledgement. Payment envelopes
SHALL become eligible for ordinary delivery without waiting for their five-minute
tender-edit window; a later payment correction SHALL be a separate immutable
envelope chained behind the payment it corrects.

#### Scenario: Local commit succeeds while the backend is unreachable
- **WHEN** an operator submits a valid counter mutation during a live shift and the backend request cannot complete
- **THEN** the system durably stores the envelope, clears the form only after that commit, marks the command not sent yet, and shows the offline state

#### Scenario: Durable storage fails
- **WHEN** IndexedDB cannot durably commit a submitted command
- **THEN** the system does not report success, does not clear the form, and explains that the operation was not saved

#### Scenario: Payment delivery starts before its edit window ends
- **WHEN** an immediate or on-handover payment is durably committed locally
- **THEN** it becomes eligible for the ordinary drain immediately and its five-minute edit action remains available on the paid-bill card

### Requirement: Payment corrections preserve ancestry and local audit

A payment-correction envelope SHALL carry a new client UUID, the bill identity,
the effective revision it replaces and one exact replacement Cash/UPI allocation
set. It SHALL depend on the payment command that creates the bill and on any prior
correction for that bill. Local acceptance SHALL retain the original payment and
every correction, update the tablet's effective bill and shift totals, and mark
the new adjustment not sent yet until its authoritative result arrives.

#### Scenario: Correction is made before the payment is delivered
- **WHEN** the tablet accepts a payment edit while its parent payment remains unsent
- **THEN** both envelopes remain immutable, the correction waits for its parent, and unrelated command chains continue draining

#### Scenario: Correction is replayed after reconnecting
- **WHEN** a valid payment correction created inside the five-minute window reaches the server later or loses its first response
- **THEN** its immutable creation time is validated, exact replay resolves to the same revision, and no duplicate correction is appended

#### Scenario: Correction is permanently refused
- **WHEN** the server rejects a stale, late, unauthorised or malformed payment correction
- **THEN** the envelope moves to needs attention with its ancestry and attempted allocation retained, and the original accepted payment remains effective on the server

### Requirement: Unsent work survives session and application lifecycle

Unsent and needs-attention envelopes SHALL survive the shift ending, cutover,
browser restart and compatible application updates while the tablet remains set
up. The enrolled device SHALL continue delivery and non-identifying telemetry
without a live shift. Replaying an immutable old envelope SHALL NOT grant the
tablet authority to create new work.

#### Scenario: Remote leave with queued work

- **WHEN** an operator leaves from their phone while their tablet retains unsent commands
- **THEN** the tablet returns to shift request when it learns the end, keeps draining those exact commands in the background, and exposes no new-work control until another shift is approved

### Requirement: One leader drains commands in dependency order

The system SHALL elect at most one active drain leader per local store, SHALL
retry with bounded backoff, and SHALL deliver each command only after its local
ancestors have reached an accepted result. A blocked chain SHALL NOT block
unrelated commands.

#### Scenario: An order is created, revised and paid while requests fail
- **WHEN** the local store holds dependent create, revise and pay commands for one order
- **THEN** the drain submits them in dependency order and never submits a payment against an order the server has not been told about

#### Scenario: One order chain needs attention
- **WHEN** a command in one order's chain is permanently refused
- **THEN** its descendants stop and are visibly blocked while unrelated chains keep draining

### Requirement: Reachability is derived from real request evidence

The system SHALL distinguish a missing response from a server authentication,
authorisation, validation or identity response. It SHALL use browser connectivity
hints only to trigger attempts, never as proof the backend is reachable.

#### Scenario: Wi-Fi exists but the backend cannot respond
- **WHEN** the browser reports online but billing requests return no HTTP response
- **THEN** the system shows the offline banner and retains commands for retry

#### Scenario: The server refuses a command
- **WHEN** the backend returns a structured authorisation or validation refusal
- **THEN** the system records that server outcome and does not mislabel it as an offline failure

### Requirement: Delivery outcomes are explicit and idempotent

An accepted response or an exact replay SHALL resolve one local command to the
same server result. Retryable failures SHALL stay unsent. A permanent refusal
SHALL move to needs attention, and SHALL be classified as correctable or
terminal by whether resending the same payload could ever succeed.

A correctable refusal SHALL offer correction, and a correction SHALL use a new
UUID linked to the refused command. A **terminal** refusal SHALL offer discard
alone: the system SHALL NOT offer to resend a payload whose refusal cannot
change, and SHALL refuse such a correction if one is attempted. A refusal
SHALL name the order it concerned wherever the refusing operation identified
one, so the item can be read without correlating timestamps.

A discard SHALL retain actor, time and a non-blank reason. Correction and
discard SHALL be available only on the originating tablet to an operator
holding its live shift, and both SHALL retain the refused trace.

#### Scenario: The response is lost after the server commits

- **WHEN** the server commits a command, the response is lost, and the same UUID and payload are retried
- **THEN** the exact replay returns the original result and the local command resolves with no duplicate bill

#### Scenario: A UUID is reused with different content

- **WHEN** a retry uses an existing command UUID with a different canonical payload
- **THEN** the system moves it to needs attention as an identity conflict and does not treat it as delivered

#### Scenario: A refusal that cannot change offers no correction

- **WHEN** a payment is refused because its order is no longer open
- **THEN** the item offers discard and not correction, and an attempted correction is refused rather than resent

#### Scenario: A refusal says which order it was about

- **WHEN** an operator or a manager reads a refused command whose operation identified an order
- **THEN** the order is named on the item, without any payload or customer detail

### Requirement: A removed tablet stops delivering and keeps its evidence

Removing a tablet SHALL stop ordinary reads, shifts and queue delivery without
deleting local envelopes. There SHALL be no privileged upload path from a removed
tablet; work left unsent on one is a recorded operational limitation, and the
Tablets surface SHALL warn before removing a tablet reporting unsent work.

#### Scenario: A removed tablet attempts to drain
- **WHEN** a removed tablet's leader attempts delivery
- **THEN** every request is refused at the database boundary and the envelopes remain on the device

### Requirement: Delivery diagnostics exclude customer details

Operational status and telemetry SHALL expose counts, age, command type,
non-identifying references and result categories, without logging customer phone
numbers or command payloads. Manager diagnostics SHALL be read-only and SHALL
offer no correction or discard action.

#### Scenario: A manager inspects a delayed queue
- **WHEN** a manager views delivery diagnostics
- **THEN** they see actionable unsent and needs-attention metadata with no customer phone numbers and no payload content

### Requirement: Finish Day explains readiness before acting

Every Finish Day attempt SHALL open one readiness sheet, attempt delivery, and
obtain authoritative server state before enabling completion. It SHALL name each
hard blocker and its resolution. Unsent/retrying work, needs-attention work, open
orders, or inability to obtain server authority SHALL block completion.

The five-minute tender-edit window SHALL be advisory. An otherwise ready tablet
MAY review recent payments, keep billing, or finish immediately. Finishing SHALL
end that edit opportunity and SHALL NOT bypass a hard blocker.

#### Scenario: Recent payment is the only concern

- **WHEN** the latest payment remains editable but delivery, attention, orders and server authority are clear
- **THEN** the sheet offers Review recent payments, Finish day now and Keep billing without a countdown blocker

#### Scenario: Local commands are unresolved

- **WHEN** automatic drain leaves pending, retrying or needs-attention commands
- **THEN** the sheet names their categories, explains reconnect or local resolution, and does not offer Finish day now

#### Scenario: Finish deliberately ends correction authority

- **WHEN** the operator chooses Finish day now
- **THEN** the server ends the shift as day finished, records the device confirmation, and refuses any correction created after that instant

### Requirement: Unwinds chain behind the payment they reverse and project locally before delivery

`void_order_payment` and `cancel_paid_order` envelopes SHALL join the same
per-order dependency chain as the payment they reverse, so an unwind can never
deliver ahead of its payment whatever the connectivity. Before delivery, the
tablet's local reads SHALL project an accepted unwind: a voided-and-reopened
order reappears as open with its prior preparation state, a cancelled order
leaves the actionable pipeline, and neither presents the unwound bill as
settled in shift totals.

#### Scenario: Offline unpay replays after its payment

- **WHEN** an operator takes a payment back offline and both commands deliver after reconnecting
- **THEN** the pay lands first, the unwind second, the bill ends void with kind `counter_unpay`, and no duplicate bill exists

#### Scenario: The pipeline reads the unwind immediately

- **WHEN** `void_order_payment` is durably accepted locally while offline
- **THEN** the order card returns to its prior section at once and shift totals stop counting that bill, without waiting for delivery

### Requirement: Accepted work stays visible across the delivery handoff

A command's acceptance moves its effect from the tablet's outbox into the
server's own rows and retires the local envelope. The counter's reads SHALL
compose those two sources such that no ordering of that handoff against a
read in progress can present accepted work as though it never happened. In
particular a settled payment SHALL NOT reappear as an unpaid order, whatever
the moment of acceptance relative to the read.

The tablet SHALL hold one projection of what it believes about an order, and
every reader SHALL use it. A command that would act on an order SHALL be
refused locally when that projection already shows the action taken, rather
than being sent for the server to refuse.

#### Scenario: A payment is accepted while the pipeline is refreshing

- **WHEN** the server accepts a payment during a pipeline read that began before it
- **THEN** the order is presented as paid, leaves the payable section, and no further payment can be taken for it on that tablet

#### Scenario: A payment already taken is refused before it becomes a command

- **WHEN** an operator attempts a payment for an order the tablet already holds as paid
- **THEN** the tablet refuses it in place, naming the order as already paid, and mints no command

#### Scenario: Taking a payment back leaves the order payable again

- **WHEN** an operator unwinds a payment inside its edit window and takes payment again
- **THEN** the second payment is accepted, because the refusal follows the order's projected state rather than its command history

### Requirement: Capture continues across a deliberate restart inside one shift

Within a shift already approved online and not yet expired, the delivery store
SHALL keep accepting commands after the application is closed, updated or
reloaded with no backend reachable, and SHALL retain them until a real response
returns. Continuous capture SHALL NOT depend on the tab or the application
staying open.

#### Scenario: The tablet is restarted twice during one outage

- **WHEN** the counter accepts work, is closed and reopened, accepts more, is reloaded again, and the backend is unreachable throughout
- **THEN** every envelope, its dependency edges and its local resolutions survive both restarts and drain in order when a response returns

#### Scenario: The outage lasts the rest of the shift

- **WHEN** the tablet resumes offline and accepts commands until its shift expires
- **THEN** all of them remain durable and dependency-ordered, and none is discarded by expiry

### Requirement: Delivery outcomes are unchanged by how long the work waited

A command captured after an offline cold start SHALL resolve through the same
outcomes as one captured during a transient drop: accepted, exact replay,
correctable refusal offering correction, or terminal refusal offering discard
alone, each retaining its refused trace and naming the order the operation
identified. Age SHALL NOT convert a refusal into a success or a success into a
retry.

#### Scenario: A long-delayed payment is refused as not open

- **WHEN** a payment captured hours earlier reaches a server whose order was cancelled by a manager in the meantime
- **THEN** it moves to needs attention as a terminal refusal naming that order, offers discard and not correction, and its descendants stop while unrelated chains keep draining

### Requirement: A queue belongs to one tablet and never to its outlet

Each tablet SHALL retain and drain only its own envelopes, dependency edges,
results and local resolutions. No tablet SHALL become responsible for, or gain
visibility of, another tablet's queue, and correction, discard and drain SHALL
remain available only on the tablet that created the work.

Telemetry MAY publish non-identifying aggregate state per tablet and SHALL NOT
copy payloads or customer facts anywhere, for monitoring or otherwise.

#### Scenario: One tablet is offline

- **WHEN** one tablet at an outlet loses connectivity while the other keeps trading
- **THEN** each drains from its own store, the online tablet neither delivers nor displays the offline tablet's commands, and neither counter is blocked by the other

#### Scenario: A refusal stops one chain and no other tablet

- **WHEN** a command is permanently refused on one tablet
- **THEN** its descendants stop on that tablet alone, and the other tablet's unrelated chains keep draining

### Requirement: Removing one tablet does not disturb another's delivery

Refusal of a removed tablet's commands, and the handling of the work left on it,
SHALL NOT stop or delay delivery from any other active tablet at the same outlet.

#### Scenario: One tablet is removed mid-service

- **WHEN** an admin removes one of two tablets while both hold unsent work
- **THEN** the removed tablet's requests are refused at the database and its envelopes stay on the device, while the other tablet continues billing and draining without interruption
