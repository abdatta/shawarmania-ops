# Bill Receipt Delivery

## Purpose

A customer who gives their number at the counter receives their receipt, and the
points the bill earned, by SMS once the bill has settled on the server: once per
bill, however often an offline till replays it, and never for history, a
demonstration or a bill with no valid number. Settling never waits for the
message. Its delivery status is reported truthfully to the outlet's managers
alone, and each outlet may stop collecting customer details altogether.

## Requirements

### Requirement: A new settled bill with a number sends automatically

The system SHALL enqueue one receipt SMS when a newly settled bill with a valid
Indian mobile reaches the server while delivery is enabled. Providing that number
SHALL be receipt-message opt-in with no separate consent step. The SMS SHALL
contain the bill's earned points, frozen outlet balance after the bill and receipt
link, using the approved template and no shortener. Zero-earned bills SHALL send
zero and preserve the existing balance.

#### Scenario: Customer pays
- **WHEN** a new settled bill with a valid number commits
- **THEN** it is queued after its points exist without waiting on Prepared

#### Scenario: Number skipped
- **WHEN** a bill has no valid number
- **THEN** no delivery is created and billing succeeds

### Requirement: Offline sync and replay do not duplicate submission

SMS SHALL be submitted asynchronously after server commit. Billing SHALL NOT
wait for MSG91. A bill UUID SHALL have at most one automatic provider submission,
including under replay, worker concurrency and a lost response. An uncertain
submission SHALL be visible and SHALL NOT be retried automatically.

#### Scenario: Offline bill arrives twice
- **WHEN** an eligible bill syncs and its command is replayed
- **THEN** one job exists and only one worker may submit it

#### Scenario: Lost provider response
- **WHEN** acceptance cannot be established
- **THEN** the job is uncertain and no second automatic submission occurs

### Requirement: Activation excludes history and demo

Delivery SHALL start disabled. Enabling SHALL send nothing for bills paid before
activation. Demo SHALL make no provider request or delivery write. Cancelled bills
and revoked receipt links SHALL NOT be submitted.

#### Scenario: Activation
- **WHEN** delivery is enabled in an outlet with history
- **THEN** existing and pre-activation offline bills send nothing

#### Scenario: Demo sale
- **WHEN** a demo customer pays
- **THEN** no real SMS sends

### Requirement: Status is truthful, authenticated and isolated

Owner and same-outlet managers SHALL see queued, sending, submitted, delivered,
failed, uncertain or skipped state. API success SHALL NOT claim handset delivery.
Authenticated callbacks SHALL be idempotent and work before the send response is
recorded. Clients SHALL NOT claim/submit/manufacture reports or read another
outlet's deliveries. Diagnostics SHALL NOT contain phones or receipt tokens.

#### Scenario: Failure
- **WHEN** MSG91 rejects a send or reports operator failure
- **THEN** the manager sees a fixed explanation and can share manually on WhatsApp

#### Scenario: Report first
- **WHEN** a delivered report precedes the worker's send response
- **THEN** the recorded state remains delivered

#### Scenario: Other outlet
- **WHEN** a manager hand-crafts a request for another outlet's delivery
- **THEN** no row is returned and no write is allowed

### Requirement: Identify at payment before choosing tender

At outlets collecting customer details, direct bills and saved orders SHALL ask for a customer number at payment when
none is attached, with receipt-and-points wording and one-tap skip. An attached
number SHALL be shown and kept. Ordering SHALL retain optional customer entry;
Order and Save changes SHALL NOT require identification or Skip, even when
collection is enabled. Required service choices SHALL still apply.
Membership and redeemable points SHALL precede the recomputed total and tender.
Only fresh balances SHALL permit additional points; directory failure SHALL NOT
prevent payment. Customer and pricing snapshots SHALL survive offline replay.

#### Scenario: Number supplied only when paying
- **WHEN** a customer gives their number while paying a previously anonymous order
- **THEN** the bill snapshots that customer, applies selected loyalty before tender,
  and server settlement creates the same single automatic receipt job

#### Scenario: Order without an earlier customer decision
- **WHEN** collection is enabled and the biller orders or edits without using customer entry
- **THEN** the order is accepted without requiring Skip, and payment asks for the missing number

#### Scenario: Skip or dismiss
- **WHEN** the biller skips the payment-time number question
- **THEN** tender opens in one tap and the numberless bill sends no receipt
- **WHEN** they dismiss instead
- **THEN** the unpaid bill and ordering decision remain intact

#### Scenario: Changed total
- **WHEN** customer or points changes after tender was allocated
- **THEN** the allocation clears and the Paid action requires the new exact total

#### Scenario: Failed saved-order acceptance
- **WHEN** saving checkout changes fails locally
- **THEN** payment is not accepted and the checkout remains available
- **WHEN** revision succeeds but accepting payment fails
- **THEN** retry pays the same revised order without making another bill

### Requirement: Each outlet can disable customer collection

The system SHALL offer a default-on Collect customer details setting for each
outlet. Active owner and same-outlet franchise admins SHALL be able to change it;
other roles and other-outlet franchise admins SHALL NOT. Off SHALL hide customer
entry when composing or editing, permit anonymous orders without a customer
decision, and skip the number prompt for direct and saved-order payment. Existing
customer facts and benefits SHALL remain intact. The cached outlet menu SHALL
carry this setting offline; missing older-cache values SHALL default to on.

#### Scenario: Outlet does not collect customer details
- **WHEN** collection is off and a biller orders, edits or pays an anonymous order
- **THEN** no customer control or number prompt appears and no Skip is required
- **AND** ordinary service questions still apply and the anonymous bill earns no customer points or receipt SMS

#### Scenario: Existing customer order
- **WHEN** an identified order is paid after collection is switched off
- **THEN** its customer and benefits are retained without customer-edit controls

#### Scenario: Assigned franchise admin
- **WHEN** a franchise admin changes collection for their assigned outlet
- **THEN** the choice persists and reaches that outlet's counter menu
- **WHEN** the same caller targets another outlet or a biller calls the RPC
- **THEN** the database refuses the change
