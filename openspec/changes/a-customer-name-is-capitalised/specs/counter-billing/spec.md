## MODIFIED Requirements

### Requirement: A customer is identified by their phone, and their name is recorded with it

Both customer snapshots SHALL remain nullable, and the database SHALL never
require either: a bill or order carrying no customer at all is valid, and nothing
downstream may assume one.

The phone is the identity that resolves a returning customer and creates a
customer record. The name is that customer's own name, given with their number
and snapshotted onto the order and bill as it stood at the sale.

A name SHALL be recorded only for a customer identified by phone. The counter
SHALL NOT request or store a name for an order whose customer gave no number;
the preparation pipeline and shift list SHALL identify it by its order number.
Previously captured historical names SHALL remain intact.

Customer entry SHALL be optional when placing or editing an order. The counter
SHALL NOT require identification or Skip before Order or Save changes. At outlets
collecting customer details, payment SHALL ask for a number when none is attached
and offer one-tap Skip before tender. An attached number SHALL be shown and kept.
Collection off SHALL hide entry and bypass the payment prompt. No database
constraint SHALL be added for this UI checkpoint.

A phone SHALL be a complete Indian mobile number canonicalised by the same rule
the database uses, or resolve and create nothing. The counter SHALL NOT report a
number as malformed while it is still being typed.

With `customer-names-capitalised` on, a name typed at the counter that has three
or more cased letters, every one of them lowercase or every one of them
uppercase, SHALL be saved capitalised word by word: each letter lowercased, and
uppercased where it begins the name or follows a character that is neither a
letter nor a digit, with runs of whitespace reduced to one space. Before it is
saved the counter SHALL show the name it will save, and SHALL offer, in one tap,
to save the name exactly as typed instead; that choice SHALL hold until the
customer box closes. A name typed in mixed case, a name with fewer than three
cased letters, and a name with no cased letters SHALL be saved as typed. The
database SHALL store the name the counter sends, unaltered beyond trimming. With
the gate off, the counter SHALL save the name as typed.

#### Scenario: A bill with no customer reaches the database
- **WHEN** a bill or order is written with both customer fields null
- **THEN** the database accepts it without a customer requirement

#### Scenario: An order is rung for a customer who gave no number
- **WHEN** the biller places an order without entering a customer or pressing Skip
- **THEN** the order carries no customer name, phone or id, no customer record is created or matched, and its order number identifies it

#### Scenario: An identified customer is snapshotted whole
- **WHEN** the biller identifies a customer and the order is accepted
- **THEN** the order and bill carry the customer id, canonical phone and name, not the id alone

#### Scenario: The saved profile is never rewritten from the till
- **WHEN** a name differing from the matched customer's saved name is given at the counter
- **THEN** that name is snapshotted onto this order and bill only, and the saved global profile is unchanged

#### Scenario: A name typed in one case is capitalised, and says so first
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types `rahul das` or `RAHUL DAS` for a new number
- **THEN** the counter shows that it saves as `Rahul Das` before anything is saved
- **AND** confirming saves `Rahul Das` to the new customer and onto the order and bill

#### Scenario: The biller keeps a name as typed
- **GIVEN** `customer-names-capitalised` is on and the counter shows a capitalised name for `SANJAY`
- **WHEN** the biller taps Keep as typed and confirms
- **THEN** `SANJAY` is saved exactly as typed, to the customer and onto the order and bill

#### Scenario: A name typed in mixed case is left alone
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types `MD Rahim`, `d'Souza` or `McKenzie`
- **THEN** no capitalised name is shown and the name is saved exactly as typed

#### Scenario: A short name is left alone
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types a name with fewer than three letters, such as `AA`
- **THEN** no capitalised name is shown and the name is saved exactly as typed

#### Scenario: With the gate off, a name is saved as typed
- **GIVEN** `customer-names-capitalised` is off
- **WHEN** the biller types `rahul das` for a new number and confirms
- **THEN** no line is shown and `rahul das` is saved
