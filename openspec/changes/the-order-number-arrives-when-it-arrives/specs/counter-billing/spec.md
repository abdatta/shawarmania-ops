## RENAMED Requirements

- FROM: `### Requirement: A queued bill carries a local reference, never a bill number`
- TO: `### Requirement: Unsent work shows the shape of its number, and is said to be unsent once`

## MODIFIED Requirements

### Requirement: Unsent work shows the shape of its number, and is said to be unsent once

Until a bill or an order has been sent it has no number, because numbers are
assigned by the server on a successful send, per outlet and sequentially. Until
then the surface SHALL show, where the number will be, **a placeholder in the
shape of the number** — and SHALL NOT show any other reference, token or
identifier in its place.

**Nothing that can be read as an identifier may stand in for one.** A short
reference of the kind this requirement used to demand was honest about not being
a number and still read as one, because a few characters in an identifier slot is
what an identifier looks like — so the real number replacing it read as the work
changing identity rather than as its number arriving. That is the confusion the
reference was introduced to prevent, arriving by another door.

The placeholder carries no text, so the surface SHALL give it an accessible
description stating that the number has not been assigned yet; a placeholder
that is silent to a screen reader is an absent one.

**The surface SHALL state in plain words that work is not sent yet, once**, in
its sync indicator, which is permanently visible and counts exactly the items
waiting. It SHALL NOT repeat that statement on each unsent item: the indicator
already names the condition and the count, and a second copy on every card is the
same sentence thirty times.

**No surface SHALL use the word provisional**, here or anywhere else in billing. A
biller at 9pm needs to know what to do next, and a word nobody says out loud is
where that stops.

Where unsent work must be *named* — in an accessible name, a confirmation, or a
heading — the surface SHALL name it in words rather than by an identifier it does
not have.

#### Scenario: An order that has not yet synced
- **WHEN** an order is saved at the counter and has not been delivered
- **THEN** its card shows a placeholder the shape of the order number, no number and no other reference, and an accessible description saying the number is not yet assigned

#### Scenario: The number arrives
- **WHEN** the server assigns the number and the surface reads it back
- **THEN** the placeholder is replaced by that number, and nothing that was shown before it was an identifier

#### Scenario: A bill that has not yet synced
- **WHEN** a settled bill is still queued
- **THEN** it shows no bill number and no stand-in for one, and the sync indicator states that work is not sent yet

#### Scenario: The unsent condition is stated once
- **WHEN** several orders are waiting to be sent
- **THEN** the sync indicator names the condition and the count, and no individual card repeats it

#### Scenario: Unsent work is named in words
- **WHEN** an unsent order is named in an accessible name or a confirmation
- **THEN** it is named in words, never by a generated reference standing in for its number

#### Scenario: A cancelled bill consumes no number
- **WHEN** a queued bill is cancelled before it is sent and a later bill is then sent
- **THEN** the later bill's number is the next in the outlet's sequence, with no gap left by the cancelled one
