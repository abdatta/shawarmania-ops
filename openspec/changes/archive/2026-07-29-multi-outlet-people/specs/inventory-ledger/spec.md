# inventory-ledger — delta for multi-outlet-people

## ADDED Requirements

### Requirement: The owner records a stock correction at any outlet, and only a correction

The Super Admin SHALL be able to append an inventory correction at any outlet
without holding an assignment there, carrying the mandatory note every
correction already carries. The movement SHALL be attributed to the owner and
SHALL be shown as the owner's entry wherever the ledger is read.

Movements of every other kind — added, used, wasted — SHALL remain the work of
a person assigned to that outlet, because counting stock in and out is done
standing in the shop. The database SHALL refuse the others from this path.

A Super Admin who holds a Franchise Admin assignment at the outlet SHALL be
able to record any movement there, because that authority comes from the
assignment.

#### Scenario: The owner corrects a count remotely

- **WHEN** a Super Admin appends a correction with a note at an outlet they
  hold no assignment at
- **THEN** the movement is stored, the item's current quantity moves by exactly
  that delta, and the ledger row reads as the owner's entry

#### Scenario: A remote stock receipt is refused

- **WHEN** a Super Admin holding no assignment at an outlet attempts to append
  an `added`, `used` or `wasted` movement there, including by a hand-crafted
  request
- **THEN** the database refuses the write and the item's quantity is unchanged

#### Scenario: The ledger still reconciles after an owner correction

- **WHEN** an item's movements include an owner-recorded correction
- **THEN** the item's current quantity equals the sum of every movement delta,
  exactly as for any other movement
