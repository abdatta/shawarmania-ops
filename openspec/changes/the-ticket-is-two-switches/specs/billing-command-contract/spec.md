## MODIFIED Requirements

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
the ones that took the payment, under the same historical-shift validity every
delayed command uses; where a bill exists it is settled and not already voided;
the order is paid; and the commanding time falls **inside the ticket's edit
window**.

The ticket's edit window SHALL be derived, never stored: it closes five minutes
after the later of the bill's `paid_at` and the order's `prepared_at`, and it
SHALL NOT close at all while `prepared_at` is null, because a ticket whose food
is still owed is not finished. A bill carrying no order SHALL close five minutes
after its own `paid_at`. `correct_bill_payment` SHALL answer to the same window.
Outside it all three SHALL be refused permanently. Direct table writes performing
any of these effects SHALL remain impossible for every client role.

No guard SHALL refuse an end-of-day confirmation on the grounds that a payment
is still inside its window; finishing the day ends the window instead, and the
shift requirement every command already answers to is what refuses a later
unwind.

#### Scenario: Preparation command replays exactly

- **WHEN** an accepted `set_order_preparation` envelope is submitted twice
- **THEN** both responses report the same result and `prepared_at` holds one value

#### Scenario: Repreparing a paid order is refused

- **WHEN** the owning tablet submits `set_order_preparation` with prepared false against a paid order
- **THEN** the command is refused with a category naming the state and nothing changes

#### Scenario: An unwind within the window succeeds atomically

- **WHEN** the originating tablet submits `void_order_payment` inside the ticket's edit window
- **THEN** the bill is void with kind `counter_unpay` and the order is open again in one transaction, or neither effect exists

#### Scenario: An unwind on an unprepared order is always inside the window

- **WHEN** either unwind command arrives an hour after payment for an order whose `prepared_at` is null
- **THEN** it is accepted, because the window has not started

#### Scenario: An unwind outside the window is refused

- **WHEN** either unwind command's commanding time exceeds five minutes past the later of the bill's `paid_at` and the order's `prepared_at`
- **THEN** the command is refused permanently, the bill stays settled and the order stays paid

#### Scenario: A bill with no order keeps the payment-time window

- **WHEN** a correction or unwind is submitted against a directly paid bill more than five minutes after its `paid_at`
- **THEN** it is refused, because there is no preparation for the window to wait on

#### Scenario: Another tablet cannot unwind a payment

- **WHEN** a different tablet of the same outlet hand-crafts `cancel_paid_order` for a bill it did not take
- **THEN** the database refuses it, under the same device-and-shift guard as every ordinary order action

#### Scenario: A direct write cannot void a bill

- **WHEN** any session attempts the void transition through the data API
- **THEN** the database refuses the write, whatever the window

#### Scenario: A finished day refuses every unwind

- **WHEN** any of the three commands is hand-crafted for a bill whose business day has been finished on its tablet
- **THEN** the database refuses it
