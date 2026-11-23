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

With `customer-names-capitalised` on, the counter SHALL capitalise a name in the
name field itself, word by word, as each word is finished: when a space follows
it, after a short pause in typing, and on confirming the customer box. A word
SHALL be capitalised when its cased letters are all lowercase, or all uppercase
and three or more, or one lowercase letter followed by two or more uppercase
ones; capitalising lowercases each letter and uppercases it where it begins the
word or follows a character that is neither a letter nor a digit. Any other word
SHALL be left as typed. A word still being typed SHALL NOT be changed. A
correction SHALL change the case of letters only and SHALL NOT add, remove or
reorder any character, move the cursor or change the selection, or cause a later
keystroke to land anywhere but where it would have landed with no correction; a
correction that cannot be applied with that guarantee, including while the
keyboard is composing a word or after the text has changed since the correction
was decided, SHALL be skipped and the word left as typed. The counter SHALL add no line, button or
step for this. Once the biller deletes any character of a word the counter
corrected, or types inside it, the counter SHALL correct nothing more until the
customer box closes, and SHALL save exactly what the field shows, trimmed. The
name saved SHALL be the name the field shows. The database SHALL store the name
the counter sends, unaltered beyond trimming. With the gate off, the counter
SHALL save the name as typed.

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

#### Scenario: A name typed in one case is capitalised in the box
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types `rahul das` or `RAHUL DAS` for a new number
- **THEN** the field reads `Rahul ` once the space after the first word is typed, and `Rahul Das` after a pause or on confirming, with no other line or button shown
- **AND** confirming saves `Rahul Das` to the new customer and onto the order and bill

#### Scenario: A word still being typed is not changed
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types `RAH`, pauses, and types `UL`
- **THEN** the field reads `Rahul` once the word is finished, never `RahUL`

#### Scenario: A correction never moves the cursor
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** a word in the field is corrected while the biller is typing, whether at a space or at a pause, and the biller keeps typing
- **THEN** the cursor and selection are exactly where they were before the correction, and every following keystroke lands where it would have landed with correction off

#### Scenario: A correction that might move the cursor is skipped
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** a word is finished while the keyboard is still composing it, or the biller types again before the correction is applied, or the biller has put the cursor inside the text
- **THEN** the field is not changed at that moment, and the word is corrected only at a later finish that carries the same guarantee, or not at all

#### Scenario: Going back to a corrected word turns correction off
- **GIVEN** `customer-names-capitalised` is on and the field reads `Sanjay` after the biller typed `SANJAY`
- **WHEN** the biller backspaces into the word, types `SANJAY` again and confirms
- **THEN** the field reads `SANJAY`, nothing more is corrected while the box is open, and `SANJAY` is saved to the customer and onto the order and bill

#### Scenario: A word typed in mixed case, or initials, is left alone
- **GIVEN** `customer-names-capitalised` is on
- **WHEN** the biller types `McKenzie`, `d'Souza` or `MD rahim`
- **THEN** the field reads `McKenzie`, `d'Souza` or `MD Rahim`, and that is what is saved

#### Scenario: With the gate off, a name is saved as typed
- **GIVEN** `customer-names-capitalised` is off
- **WHEN** the biller types `rahul das` for a new number and confirms
- **THEN** the field is never changed and `rahul das` is saved
