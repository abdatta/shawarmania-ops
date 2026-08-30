## ADDED Requirements

### Requirement: Preparation and payment-takeback are typed atomic commands

The command vocabulary SHALL include `set_order_preparation`,
`void_order_payment` and `cancel_paid_order`, each carrying the standard
envelope — client UUID, type, schema version, canonical payload hash — and
obeying the same replay and conflict rules as every sibling command.

`set_order_preparation` SHALL carry the order id, an explicit prepared flag
and its command time, and SHALL be refused for an order that is not open,
except that marking prepared is accepted for a paid order whose preparation is
not yet recorded — settling that order into a bill when its payment was taken
upfront. Repreparing a paid order SHALL be refused.

`void_order_payment` and `cancel_paid_order` SHALL each name the order and
carry a non-blank reason, and execute as one atomic transaction: the bill's
void transition with its structured kind where a bill exists — an upfront
payer paid before preparation holds its money without one, and unwinding it
discards the held tender — and the order's return to open or to cancelled
respectively. Both SHALL be refused unless the commanding tablet and shift are
the ones that took the payment,
under the same historical-shift validity every delayed command uses; where a
bill exists it
is settled and not already voided; the order is paid; and the commanding time
falls within five minutes of the money's own `paid_at`. Outside that window
both SHALL be refused permanently. Direct table writes performing either
effect SHALL remain impossible for every client role.

#### Scenario: Preparation command replays exactly

- **WHEN** an accepted `set_order_preparation` envelope is submitted twice
- **THEN** both responses report the same result and `prepared_at` holds one value

#### Scenario: Repreparing a paid order is refused

- **WHEN** the owning tablet submits `set_order_preparation` with prepared false against a paid order
- **THEN** the command is refused with a category naming the state and nothing changes

#### Scenario: An unwind within the window succeeds atomically

- **WHEN** the originating tablet submits `void_order_payment` inside five minutes of the bill's stored `paid_at`
- **THEN** the bill is void with kind `counter_unpay` and the order is open again in one transaction, or neither effect exists

#### Scenario: An unwind outside the window is refused

- **WHEN** either unwind command's commanding time exceeds five minutes past the bill's stored `paid_at`
- **THEN** the command is refused permanently, the bill stays settled and the order stays paid

#### Scenario: Another tablet cannot unwind a payment

- **WHEN** a different tablet of the same outlet hand-crafts `cancel_paid_order` for a bill it did not take
- **THEN** the database refuses it, under the same device-and-shift guard as every ordinary order action

#### Scenario: A direct write cannot void a bill

- **WHEN** any session attempts the void transition through the data API
- **THEN** the database refuses the write, whatever the window
