## ADDED Requirements

### Requirement: The composer supports immediate payment and an unpaid order

The billing composer SHALL offer Pay now and Save unpaid after at least one line
exists. Pay now SHALL retain the existing single-method fast path. Save unpaid
SHALL create a device-owned order reference without assigning a bill number and
SHALL clear the composer only after the adapter accepts it.

#### Scenario: Customer pays upfront
- **WHEN** an operator selects one payment method and confirms Pay now
- **THEN** a paid result is created directly without first requiring a saved order

#### Scenario: Customer will pay later
- **WHEN** an operator chooses Save unpaid
- **THEN** the order appears in that device's Open orders with an order reference and no official bill number

### Requirement: Open orders remain editable on their originating device

Open orders SHALL list only orders owned by the registered device. Any eligible
operator using that device SHALL reopen and change lines, quantities, customer
form values, and discount until payment or cancellation. The original creation
time and business date SHALL remain visible and unchanged, including after cutoff.

#### Scenario: Incoming operator edits an order
- **WHEN** a different eligible operator signs in on the same device and edits its unpaid order
- **THEN** the order keeps its creator and original date while recording the new acting operator

#### Scenario: Another healthy device requests the order
- **WHEN** a different device requests an ordinary edit or payment
- **THEN** the order is not offered as editable there

### Requirement: Stale order edits stop instead of merging silently

An edit SHALL carry the version displayed. If that version is stale, the surface
SHALL preserve the attempted input, explain that the order changed, and require
reload/reapplication rather than silently merging or overwriting.

#### Scenario: Two tabs edit one order
- **WHEN** one tab saves version 4 and another submits a change based on version 3
- **THEN** the second save is refused and the operator is offered the current order

### Requirement: Payment finalizes the displayed order in one method

An unpaid order SHALL be payable in full through exactly one payment method.
Successful payment SHALL show the official bill number when available or a
clearly non-official pending reference while delivery is pending. No partial,
deposit, or split payment control SHALL appear.

#### Scenario: Order is paid after cutoff
- **WHEN** an eligible operator signs in online after cutoff and pays an older order
- **THEN** the paid view retains the order's original business date and displays the later payment time/date separately

### Requirement: Unpaid orders are cancelled with attribution, never deleted

An eligible operator on the originating device SHALL cancel an unpaid order only
after confirming a non-empty reason. The cancelled order SHALL leave actionable
lists but remain reviewable with actor, device, time, and reason.

#### Scenario: Operator cancels an order
- **WHEN** an eligible operator confirms cancellation with a reason
- **THEN** the order becomes cancelled and cannot later be edited or paid

### Requirement: Exact phone lookup offers form-local autofill

After a complete valid phone is entered, the surface SHALL request an exact
customer match. A match SHALL prompt before replacing current form details and
SHALL warn when values conflict. Accepting SHALL affect only this order form;
declining SHALL change nothing. A new phone SHALL be automatically saved when
the order or paid bill is accepted.

#### Scenario: Saved customer matches an empty form
- **WHEN** a complete phone matches and the remaining customer fields are empty
- **THEN** the surface offers to fill the saved details

#### Scenario: Saved name conflicts
- **WHEN** a complete phone matches but the form contains a different name
- **THEN** the prompt states that accepting will replace the form name and does not update the saved profile

#### Scenario: No customer matches
- **WHEN** a complete phone has no match and the order is accepted
- **THEN** a global customer is saved automatically from the supplied details

### Requirement: Counter history is limited to the current device shift

My shift SHALL show paid bills belonging to the current shift/device and running
totals by payment method. It SHALL NOT show other shifts, outlet-wide totals,
quarantined payload contents, or another outlet.

#### Scenario: Operator opens My shift
- **WHEN** the current device has bills from its shift and older outlet bills exist
- **THEN** only the current shift bills and their method totals appear

### Requirement: Admin billing history supports immutable correction and recovery

FA SHALL review their outlet's paid bills and SA SHALL review any outlet, with
date/status/payment filters and bill detail. They SHALL void a paid bill with a
reason and create a replacement without editing the original. They SHALL review
quarantined attempts and transfer/cancel orders stranded by an unavailable device.

#### Scenario: Paid bill is corrected
- **WHEN** an authorized admin voids a paid bill and re-rings corrected contents
- **THEN** the original remains unchanged as void and the replacement has a new identity and number

#### Scenario: Quarantined attempt is corrected
- **WHEN** an authorized admin edits a quarantined attempt
- **THEN** submission creates a new linked client UUID and preserves the original attempt

#### Scenario: Stranded order is transferred
- **WHEN** an FA/SA transfers an open order from a revoked or unavailable device to the outlet's replacement device
- **THEN** the surface records the actor, time, reason, old device, and new device

### Requirement: Exceptional delivery states are visible without blocking the composer

The surface SHALL distinguish pending, retrying, late-synced, recovery-required,
quarantined, void, cancelled, and synced states in words. It SHALL keep the main
composer usable and SHALL NOT present routine pending state as a modal dialog.

#### Scenario: Paid command is pending
- **WHEN** local acceptance succeeded but server delivery has not
- **THEN** a pending reference and sync indicator are shown without an official bill number
