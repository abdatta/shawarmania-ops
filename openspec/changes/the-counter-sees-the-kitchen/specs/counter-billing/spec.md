## ADDED Requirements

### Requirement: A rail card shows whether its kitchens have pressed ACK

At an outlet where at least one kitchen tablet holds a live kitchen shift, each
order on the counter's rail that a live kitchen's board carries SHALL show a bell
in the space beside its dishes, under the customer button and above the card's
menu button, without making the card taller. The bell SHALL be filled in the
primary tone and swinging while any such kitchen's card for the order is new,
edited or cancelled, and SHALL NOT be drawn once every such kitchen's card is
quiet, its space kept so that nothing on the card moves. A kitchen's card SHALL be judged by the kitchen
screen's own rules: quiet when the dishes it last acknowledged equal, dish by dish,
the dishes it shows now. An order the counter has ticked Prepared SHALL count as answered by
every kitchen whose filter shows one of its dishes.

While the bell is swinging, it SHALL show one dot per live kitchen, one kitchen
included, ordered by the kitchen tablets' labels,
in the primary tone for a kitchen still to answer, in the muted tone for one that
has, and as an empty place for a live kitchen whose board does not carry the
order. The dots SHALL disappear when the bell stops, and nothing else on the card
SHALL move when they do. The card SHALL carry no word for any of this; assistive
technology SHALL hear which kitchens have and have not pressed ACK, by name.

With no live kitchen shift at the outlet, or for an order no live kitchen's board
carries, the card SHALL show no bell and SHALL lay out as it would without this
requirement.

A kitchen's ACK, a change to a kitchen's filter, and a kitchen shift starting or
ending SHALL reach the counter within seconds, by the same nudge kitchens receive.

#### Scenario: A new order waits for the kitchen

- **WHEN** a counter saves an order whose dishes the outlet's one live kitchen shows
- **THEN** its rail card shows an orange bell, swinging, with one orange dot under it

#### Scenario: The kitchen presses ACK

- **WHEN** that kitchen presses ACK on the order
- **THEN** within seconds the counter's bell is gone, and nothing on the card moves

#### Scenario: An edit re-arms the bell

- **WHEN** the counter edits an acknowledged order so that the kitchen's dishes change
- **THEN** the bell is orange and swinging again until the kitchen presses ACK

#### Scenario: An edit for the other kitchen

- **WHEN** two kitchens are live, both have acknowledged an order, and the counter adds a dish only the second kitchen shows
- **THEN** the bell swings with two dots, the first grey and the second orange

#### Scenario: Prepared at the counter

- **WHEN** the counter ticks Prepared on an order whose bell is swinging
- **THEN** the bell is gone, its space kept until the order is paid and leaves the rail

#### Scenario: Dots keep their places

- **WHEN** an outlet's live kitchens are labelled *Kitchen 1* and *Kitchen 2*
- **THEN** on every card that shows dots, the left dot is Kitchen 1's and the right dot is Kitchen 2's

#### Scenario: No kitchen on shift

- **WHEN** no kitchen tablet at the outlet holds a live kitchen shift
- **THEN** no rail card shows a bell

### Requirement: The counter's header says when the kitchen is offline

The counter's header SHALL show its status as one segmented control: *Kitchen
offline*, in words, while the outlet has at least one kitchen tablet set up and none
of them holds a live kitchen shift; the sync state; and the time the shift opened.
An outlet with no kitchen tablet SHALL never be shown *Kitchen offline*. The counter's
read of its kitchens SHALL therefore also say how many kitchen tablets the outlet
has set up.

#### Scenario: The kitchen tablet's shift ends

- **WHEN** an outlet's only kitchen tablet has no live kitchen shift
- **THEN** the counter's header reads *Kitchen offline*, and no rail card shows a bell

#### Scenario: An outlet without a kitchen screen

- **WHEN** an outlet has no kitchen tablet set up
- **THEN** the counter's header never reads *Kitchen offline*

### Requirement: A counter learns only which kitchens have answered

The counter SHALL learn a kitchen's answers only through a read that requires a
live counter shift and returns, for its own outlet, the live kitchen tablets' ids
and labels and, per open order, each kitchen's answer as waiting, seen or not
shown. It SHALL return no dish, quantity, acknowledgement time or person, and it
SHALL refuse a kitchen shift, a person's own session and anything without a live
counter shift. A counter shift SHALL be able to read its own outlet's kitchen pulse
and no other outlet's.

#### Scenario: A kitchen shift asks

- **WHEN** a kitchen tablet with a live kitchen shift calls the counter's kitchen read
- **THEN** it is refused

#### Scenario: Another outlet's pulse

- **WHEN** a counter tablet with a live counter shift hand-crafts a read of another outlet's kitchen pulse
- **THEN** it receives nothing

### Requirement: The rail's cards are tickets

Each card on the counter's rail SHALL have the kitchen ticket's torn top edge, its
order number in the display face, and its dish quantities in small tiles, using
only the app's existing colour tokens. A card SHALL be no taller than the same
order's card was before this requirement, except that a one-dish card carrying
the bell MAY grow by up to seven pixels so the bell and its dots sit centred
between the customer button and the card's menu button, with space above and
below.

#### Scenario: Same height

- **WHEN** a one-dish order is on the rail
- **THEN** its card is no taller than a one-dish card was before the ticket look, plus at
  most seven pixels when it carries the bell
