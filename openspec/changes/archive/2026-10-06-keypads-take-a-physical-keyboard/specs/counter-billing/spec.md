## MODIFIED Requirements

### Requirement: Frequent counter actions are tap-first and actor-neutral

The direct-payment and saved-order payment actions SHALL be labelled Mark Paid,
not Paid, Pay now or Pay in full. Saving food-first work SHALL be labelled Order,
use a non-save icon and be the primary composer action. Mark Paid SHALL be
secondary in the composer and primary on an already-open order. Payment SHALL use a touch keypad and method tiles; cancellation
SHALL use icon actions, preset reasons and one editable reason field. The phone
input SHALL request the native numeric keypad on touch devices. Keyboard entry
SHALL remain optional for cancellation and otherwise limited to customer details
and to the on-screen number pads below.

Every on-screen number pad in a billing dialog SHALL also take a physical
keyboard where one is attached: a typed digit SHALL press that digit's key, a
typed decimal point the pad's decimal key where it has one, Backspace its delete
key, and Enter the dialog's primary action. A key the pad has disabled SHALL
stay disabled when typed. A pad SHALL NOT gain a text field for this, so a touch
screen never raises its own keyboard over it. An auto-repeated Enter SHALL NOT
act. Typing into a text field, and Enter on a control reached with Tab, SHALL
keep their ordinary behaviour.

#### Scenario: Biller records ordinary full payment
- **WHEN** the biller taps Mark Paid and then one tender method without keying an amount
- **THEN** the entire remaining balance is allocated to that method

#### Scenario: Biller cancels for a common reason
- **WHEN** the biller taps the cancel icon, selects a preset reason and confirms
- **THEN** cancellation completes without opening the keyboard

#### Scenario: Biller types on a pad from a physical keyboard
- **WHEN** a number pad is open on a counter with a keyboard attached and the biller types digits, Backspace and then Enter
- **THEN** the readout changes as if the matching keys had been tapped, and Enter does what the dialog's primary action does

#### Scenario: A held Enter confirms once
- **WHEN** the biller holds Enter on a pad whose primary action is enabled
- **THEN** the action happens once, and nothing reaches the dialog that opens after it

#### Scenario: A touch screen never raises its keyboard over a pad
- **WHEN** a number pad opens on a touch screen with no keyboard attached
- **THEN** no text field takes focus and the device's own keyboard stays down
