## ADDED Requirements

### Requirement: The server links the sale to the customer, from the phone it was given

A recorded order or bill SHALL be linked to the global customer identified by the
phone the accepted command carried. The link SHALL be resolved by the server at
the moment the command is recorded, and SHALL NOT be taken from a
client-supplied identifier.

A command carrying no phone SHALL be linked to no customer.

The resolution SHALL NOT be subject to the interactive lookup's rate bound, and
SHALL NOT be able to refuse the sale: a command whose customer cannot be resolved
SHALL still be recorded, carrying its snapshots and no customer link.

#### Scenario: A sale is rung against a number
- **WHEN** an accepted command carries a valid phone
- **THEN** the recorded order or bill is linked to the one global customer holding that phone, whether or not that customer existed beforehand

#### Scenario: A tablet settles a day's offline trade at once
- **WHEN** a tablet that has been offline drains far more queued commands than the interactive lookup bound permits in its window
- **THEN** every command is recorded and linked, and none is refused

#### Scenario: A skipped sale is linked to nobody
- **WHEN** an accepted command carries no phone
- **THEN** the recorded order or bill carries no customer link, and no customer is created

#### Scenario: The directory cannot be reached
- **WHEN** the customer cannot be resolved while a command is being recorded
- **THEN** the sale is still recorded with its snapshots and no customer link, and the money is unaffected
