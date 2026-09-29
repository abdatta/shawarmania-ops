## ADDED Requirements

### Requirement: The Menu screen shares the menu a customer reads

The Menu screen SHALL offer a **Share** button, left of **Add** and in the
secondary colours so Add stays the highlighted action, that shares the outlet's
public menu address — because the address exists to be handed to customers. It
SHALL share the link and nothing else: no title and no message. Sharing SHALL behave exactly as sharing
a bill's receipt link does: the device's share sheet where there is one; else the
clipboard, with the control saying the link was copied; else the address shown
as selectable text, with no claim that anything was copied. A dismissed share
sheet SHALL end the interaction rather than fall through to the clipboard.

The address SHALL arrive on the read the screen already makes, not on a second
request. An outlet without an address, and a menu a tablet persisted before
addresses existed, SHALL show no share control.

#### Scenario: A manager shares the menu to WhatsApp
- **WHEN** a manager on a phone taps Share public menu
- **THEN** the phone's share sheet opens carrying the outlet's public menu address and no other text

#### Scenario: A tablet with no share sheet
- **WHEN** the device has no share sheet but can copy
- **THEN** the address is copied and the control says the link was copied

#### Scenario: Neither is available
- **WHEN** the device can neither share nor copy
- **THEN** the address is shown as selectable text and nothing claims it was copied
