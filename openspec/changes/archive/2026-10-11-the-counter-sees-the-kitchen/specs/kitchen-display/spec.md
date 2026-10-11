# Delta: kitchen-display

These requirements are added by #70 (`the-kitchen-sees-its-orders`), which archives
before this change. They are restated here whole, as they read once the kitchen's
filter is a view rather than an event (design D7).

## MODIFIED Requirements

### Requirement: New, edited and cancelled orders alert until acknowledged

A card SHALL be in one of four states for a given kitchen tablet: **New** (the
tablet has not acknowledged it), **Edited** (its visible lines differ from the lines
this tablet last acknowledged), **Cancelled** (it was cancelled, or lost every
visible line after this tablet acknowledged it, and this tablet has not acknowledged
the cancellation), or quiet.

**The lines this tablet last acknowledged SHALL be read through the filter in force
now**: a line acknowledged under an earlier filter that this tablet no longer shows
SHALL take no part in the comparison, judged by its dish's current category as an
order's own lines are. A change of filter is therefore never an edit or a
cancellation. Hiding dishes SHALL neither strike them through nor make a card
Edited or Cancelled, and an order with nothing left on show, before or after, SHALL
leave the board without a Cancelled card. Showing dishes this tablet has not
acknowledged SHALL make their card New, or Edited with those dishes marked as added,
until ACK, because a kitchen that widens its filter has not yet seen them.

A New, Edited or Cancelled card SHALL shake on arrival and then name its state in
three ways, never by colour alone: its order number in the state's colour, a ribbon
reading *NEW*, *EDITED* or *CANCELLED*, and an **ACK** control filled in that colour
with its own icon. The colours are the primary tone, the kitchen's edit amber and the
kitchen's cancel red, each a contrast-validated pair in both themes. An Edited card
SHALL mark lines added, strike lines removed and show changed quantities old → new
since the last acknowledgement, the added and changed lines in the edit colour. An edit that changes
none of this tablet's visible lines SHALL leave its card quiet. An edit to a card
not yet acknowledged SHALL leave it New with its current contents.

ACK SHALL clear the card's state colours, ribbon and control; on an Edited card it SHALL also clear
the marks and struck lines; on a Cancelled card it SHALL remove the card. A Cancelled
card SHALL also disappear when the business day it was cancelled on ends. An
acknowledged cancellation SHALL keep an order off the board only while the order is
cancelled or has nothing on show here; an open order with a dish on show SHALL be on
the board whatever was acknowledged before.

An acknowledgement SHALL be recorded on the server for that tablet with what was
acknowledged, SHALL be refused if the order has changed since the version the
kitchen showed, and SHALL be idempotent. Each kitchen tablet's acknowledgements SHALL
be independent of every other's.

While an alert is still owed a ring or one is sounding, its ACK SHALL show how many
rings remain and SHALL move; once they are spent it SHALL stand still. Under reduced
motion the shake and the moving ACK SHALL fade and return instead of moving.

#### Scenario: A new order arrives

- **WHEN** an order with a visible line is saved at the counter
- **THEN** its card shakes, takes the primary tone with a *NEW* ribbon and carries ACK

#### Scenario: An item is added after ACK

- **WHEN** the kitchen has acknowledged an order and the counter adds a Fries line to it
- **THEN** the card shakes, takes the edit colour with an *EDITED* ribbon, marks Fries as added and carries an ACK in that colour

#### Scenario: An edit for the other kitchen

- **WHEN** the counter adds a Pasta to an acknowledged order on a kitchen that does not show Pasta
- **THEN** that kitchen's card stays quiet and its *+N items for another kitchen* count rises

#### Scenario: Every visible item is removed

- **WHEN** the counter removes the only Shawarma from an order this kitchen acknowledged, leaving a Pasta
- **THEN** this kitchen's card reads Cancelled until ACK removes it

#### Scenario: The kitchen hides everything an order has here

- **WHEN** a kitchen that acknowledged an order of Shawarmas changes its filter to show only Burgers
- **THEN** the order leaves its board silently, with no Cancelled card and nothing to ACK

#### Scenario: The kitchen shows it again

- **WHEN** that kitchen changes its filter back to Shawarmas, and the order has not been touched at the counter
- **THEN** the order is back on its board, quiet, exactly as it was acknowledged

#### Scenario: The kitchen hides part of an order

- **WHEN** a kitchen that acknowledged a Shawarma and a Burger changes its filter to hide Burgers
- **THEN** its card stays quiet, shows the Shawarma, strikes nothing through and counts the Burger as an item for another kitchen

#### Scenario: The kitchen takes over another kitchen's dishes

- **WHEN** a kitchen that acknowledged only the Shawarma of a Shawarma-and-Burger order changes its filter to show Burgers too
- **THEN** the card reads Edited, marks the Burger as added and carries ACK; and an order with Burgers that this kitchen never acknowledged reads New

#### Scenario: Cancelled and reloaded

- **WHEN** an order is cancelled and the kitchen tablet reloads before anybody presses ACK
- **THEN** the Cancelled card is still there after the reload

#### Scenario: Cancelled yesterday

- **WHEN** a kitchen shift starts on a business day after an un-acknowledged cancellation
- **THEN** that cancellation is not shown

#### Scenario: Two kitchens acknowledge separately

- **WHEN** one kitchen acknowledges an order that both kitchens show
- **THEN** the other kitchen's card is still New

### Requirement: Alerts ring three times, one sound at a time, most urgent first

Each alert SHALL be owed three rings of its kind's tune, and the three tunes SHALL be
distinct. Only one ring SHALL sound at a time. The next ring SHALL be of the most
urgent kind still owed one, in the order cancelled, new, edited, and one ring SHALL
count for every alert of that kind currently owed one. ACK SHALL remove its card's
alert, and the sound SHALL stop at once when no alert is owed a ring. A card whose
contents change while it is alerting SHALL be owed three rings again.

Opening the screen, and the first read after a shift starts, SHALL ring nothing; the
cards it finds alerting SHALL show their alert silently. Only changes observed while the screen
is open SHALL ring, including those observed on reconnecting after a gap.

**A change of filter saved on the tablet SHALL ring nothing and shake nothing**: a
card that starts alerting because of it SHALL show its alert silently, as on opening
the screen. An order saved, edited or cancelled at the counter after the filter was
saved SHALL ring as usual, even when both are first seen in the same read. A dish
moved to another category on the menu, which nobody at the kitchen chose, SHALL ring
for what it brings into view.

#### Scenario: Three orders at once

- **WHEN** three new orders arrive in one refresh
- **THEN** all three cards shake together and the new-order tune rings three times in total

#### Scenario: A cancellation arrives while new orders are ringing

- **WHEN** a cancellation arrives during the second ring of a new order
- **THEN** that ring finishes, the cancel tune rings next, and the new order's remaining ring follows

#### Scenario: ACK before the rings finish

- **WHEN** the only alerting card is acknowledged during its second ring
- **THEN** the sound stops at once and does not resume

#### Scenario: Nobody answers

- **WHEN** a new order's three rings finish with no ACK
- **THEN** the screen is silent, and the card still shows its alert with its ACK, standing still

#### Scenario: A wider filter is silent

- **WHEN** a kitchen saves a filter that brings three unacknowledged orders onto its board
- **THEN** their cards show New with ACK, and nothing shakes or rings

#### Scenario: An order arrives as the filter is saved

- **WHEN** an order is saved at the counter just after the kitchen saves its filter, and both reach the kitchen in one read
- **THEN** that order's card shakes and rings, and the cards the filter brought do not
