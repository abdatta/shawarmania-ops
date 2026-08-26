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
