## ADDED Requirements

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

## MODIFIED Requirements

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
