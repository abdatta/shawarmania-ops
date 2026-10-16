## ADDED Requirements

### Requirement: A paper sale is a bill that names who entered it and no tablet, shift or biller

The system SHALL record a sale taken on paper as a settled bill whose entry
source is `paper`, carrying the profile that entered it and when, and carrying no
counter tablet, no counter shift and no biller. Every other bill SHALL have entry
source `counter` and SHALL name its tablet and biller and no enterer. The database
SHALL refuse any row that breaks this pairing, from any writer.

#### Scenario: A paper bill is recorded

- **WHEN** the owner records a written order as a paper bill
- **THEN** the bill's entry source is `paper`, it names the owner as enterer with
  the time of entry, and its tablet, shift and biller are empty

#### Scenario: A row claims to be paper and names a tablet

- **WHEN** any writer inserts a bill with entry source `paper` and a counter
  tablet, or with entry source `counter` and no tablet
- **THEN** the database refuses the insert

#### Scenario: A published build rings a bill

- **WHEN** a build published before this change pays a bill at the counter
- **THEN** the bill is recorded exactly as before, with entry source `counter`

### Requirement: Only an outlet's admins may record paper sales, by command

Paper bills SHALL be written only through `record_paper_bill`, which SHALL
derive the caller's authority from their own session: the Super Admin for any
outlet, and a Franchise Admin only for an outlet they currently manage. The
system SHALL refuse a counter tablet session, a Biller, an Employee and an
anonymous caller. No client role SHALL be able to insert a paper bill directly.

#### Scenario: A manager names another outlet

- **WHEN** a Franchise Admin of one outlet calls `record_paper_bill` for an
  outlet they do not manage, with a valid session and a well-formed payload
- **THEN** the database refuses the call and records nothing

#### Scenario: A counter tablet tries to record a paper sale

- **WHEN** a counter tablet's session calls `record_paper_bill` for its own
  outlet
- **THEN** the database refuses the call

### Requirement: A paper bill is validated as a counter bill is

A paper bill SHALL carry one or more lines naming dishes on its outlet's menu,
each snapshotting the dish name and the unit price charged, the price defaulting
to the menu's current price and stateable; cash and UPI payments summing to its
total; and any discount, as a flat amount off the bill or off a line. A dish
given away SHALL be entered at ₹1, as the counter records one. Totals SHALL be integer paise, SHALL round up to the rupee and
SHALL pass the same validation a counter bill's do; a bill SHALL come to at least
₹1, so a bill whose discounts leave nothing SHALL be refused, as at the counter. The bill
SHALL carry a stated time, which SHALL resolve through the outlet's cutover to
its stated business date, and that date SHALL be on or before the outlet's current
business date. An outlet marked closed SHALL accept paper bills for days it
traded.

#### Scenario: A sheet from a closed pop-up

- **WHEN** the owner records a written order for a business date during the
  event, after the pop-up outlet was marked closed
- **THEN** the bill is recorded and numbered in that outlet's sequence

#### Scenario: A time outside the stated day

- **WHEN** a paper bill's stated time resolves through the outlet's cutover to a
  different business date than the one stated
- **THEN** the database refuses it

#### Scenario: A future day

- **WHEN** a paper bill names a business date after the outlet's current
  business date
- **THEN** the database refuses it

#### Scenario: A dish given free

- **WHEN** a written order of two dishes, one of them given away, is recorded
  with the free dish marked free
- **THEN** the bill records both dishes, the free one at ₹1, and its total is the
  paid dish's plus ₹1

#### Scenario: An order given away entirely

- **WHEN** a written order whose every dish was given away is recorded with its
  dishes marked free
- **THEN** it is recorded as a bill of ₹1 a dish

#### Scenario: Discounts that leave nothing

- **WHEN** a paper bill's discounts take its total to nothing
- **THEN** the database refuses it and records nothing

### Requirement: Recording the same written order twice records it once

`record_paper_bill` SHALL be idempotent on the bill's identifier: the same
identifier with the same content SHALL return the bill already recorded and its
number, and the same identifier with different content SHALL be refused as a
conflict without changing the recorded bill.

#### Scenario: A file is run twice

- **WHEN** the same file of written orders is recorded a second time
- **THEN** no bill is added and each order returns its original bill number

#### Scenario: A corrected order reuses its key

- **WHEN** an order is recorded again under the same identifier with a different
  quantity
- **THEN** the call is refused as a conflict and the recorded bill is unchanged

### Requirement: A paper bill counts wherever a bill counts

A settled paper bill SHALL count in every figure that counts settled bills —
revenue on Overview, the Ledger and Analytics, dish and category figures, and
hour groupings at its stated time — and its cash SHALL count in its outlet's
drawer at its payment time. A paper bill entered after a drawer count SHALL be
listed among that count's late-arriving bills, and the count SHALL NOT move. A
voided paper bill SHALL count nowhere, as any voided bill.

#### Scenario: Revenue moves by the paper bill

- **WHEN** a paper bill of ₹300 in cash is recorded for a business date
- **THEN** that date's revenue on Overview, the Ledger and Analytics, and the
  drawer's expected cash for the interval containing its time, each rise by
  ₹300

#### Scenario: A paper day after the drawer was counted

- **WHEN** cash paper bills are recorded for a day whose drawer was counted
  after their stated times
- **THEN** the count is unchanged and lists the paper bills as arriving after it

### Requirement: A paper bill may name a customer and sends no receipt

A paper bill MAY carry a customer's phone and name. With a phone, the system
SHALL link the bill to the customer as a counter bill's phone is linked, and the
bill SHALL earn points at its outlet under the outlet's rules as they stand when
it is entered, reversed if it is voided. A paper bill SHALL NOT spend points. No receipt
message SHALL be queued or sent for a paper bill.

#### Scenario: A paper bill with a valid mobile

- **WHEN** a paper bill carrying a valid Indian mobile is recorded at an outlet
  with points on and receipt delivery enabled
- **THEN** the customer earns that bill's points and no receipt message is ever
  claimed for sending

### Requirement: A paper bill reads from paper

Wherever a bill's till or biller is shown, a paper bill SHALL read **from paper** in
its place, and its detail SHALL say who entered it and when. In demo mode the
scenario SHALL include paper bills so the mark is walkable.

#### Scenario: Billing history lists a paper bill

- **WHEN** the owner opens Billing history for a day with paper bills
- **THEN** each paper bill's row reads from paper where a counter bill reads by
  its biller and on its till, and expanding it shows who entered it and when

### Requirement: A file of paper sales is checked before it is written, and can be undone

The paper-sales script SHALL read a file of written orders and, by default, write
nothing: it SHALL report the orders, items, cash, UPI and discounts it would
record, and how many are already recorded. It SHALL write only when told to,
signed in as the person entering, and SHALL never use the service-role key. Its
undo SHALL cancel every recorded bill in a file, with a stated reason, through
the ordinary void.

#### Scenario: Dry run

- **WHEN** the owner runs the script on a day's file without asking it to write
- **THEN** it prints the day's totals by tender and records nothing

#### Scenario: Undo

- **WHEN** the owner runs the script's undo on a file with a reason
- **THEN** every bill recorded from that file is voided with that reason and
  its points reversed, and running the undo again changes nothing
