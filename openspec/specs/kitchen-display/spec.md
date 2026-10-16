# Kitchen Display

## Purpose

Defines the kitchen tablet's board: which unprepared orders it shows and in what order, the category filter each kitchen tablet keeps, the new, edited and cancelled alerts it rings until acknowledged, and how it says when it may be out of date or silent.

## Requirements

### Requirement: The kitchen screen shows the rail's unprepared orders, oldest first by default

A tablet of kind `kitchen` holding a live kitchen shift SHALL show every order at its
outlet that is not yet prepared — open or paid, with no Prepared tick — and has food
still **owed** under the tablet's filter, ordered by `ordered_at` ascending unless the
tablet is set to newest first. A line's owed quantity is its quantity less what a
kitchen has marked Ready or the counter has ticked. The sort SHALL be saved on the
tablet's own record beside its filter and changeable from the same sheet, oldest
first being the default. A cooking ticket SHALL collapse to a gray Done header when marked Ready and
remain until its captured items are handed over at the counter. An untick SHALL
restore that Done ticket. The day change SHALL still finish orders. The board
SHALL pack tickets into the shortest of its responsive columns without row gaps
or stretched cards. A direct
sale with no order SHALL NOT appear. The screen SHALL NOT be filtered by business
date.

Each card SHALL show the order number as its most prominent text, followed by
*· n* when it is the order's second or later ticket here; its service as the counter's pipeline card names it
(*Takeaway*, *Dine-in* or *Table N*); each visible line with food owed, led by a large
owed quantity, with the line's **note** beneath it in a tone that stands out from the
dish name; the time since it was ordered; and — when the order has item lines not
visible here — the count of them as *+N item(s) for another kitchen*. It SHALL NOT
show a price, a total, a discount, a payment state, a packaging line, or the
customer's name, phone, or order label.

The waiting time SHALL take the warning tone from ten minutes, the danger tone
from twenty, and the darker contrast-validated critical red from forty.

The board SHALL NOT scroll by itself. While a card awaiting ACK is out of sight, a
floating pointer SHALL say so, naming the order when there is one and counting them
when there are several, in the colour of the most urgent of them, with an arrow
towards it, and a tap SHALL bring that card into view.

#### Scenario: An order is taken at the counter

- **WHEN** a counter tablet saves an order with a Chicken Shawarma and a Pasta, and the kitchen tablet shows everything except Pasta
- **THEN** within seconds the kitchen shows the order with Chicken Shawarma and *+1 item for another kitchen*, below every older order

#### Scenario: The counter ticks the dishes

- **WHEN** the counter ticks every dish of an order this kitchen shows
- **THEN** the order leaves the kitchen screen without an ACK, and any ringing for it stops

#### Scenario: Paid upfront, still cooking

- **WHEN** an order is paid but its dishes are neither ticked nor Ready
- **THEN** it stays on the kitchen screen

#### Scenario: A pay-now sale

- **WHEN** the counter rings a direct sale with no order
- **THEN** nothing appears on the kitchen screen

#### Scenario: A label and a note

- **WHEN** the counter saves an order labelled *Red shirt* with a Chicken Shawarma noted *No sauce*
- **THEN** the kitchen's card shows the order number and *No sauce* under Chicken Shawarma, without the label

#### Scenario: A note for the other kitchen

- **WHEN** the noted dish is one this kitchen does not show
- **THEN** this kitchen's card shows neither the dish nor its note

#### Scenario: A new order lands below the screen

- **WHEN** the board holds more cards than fit and a new order arrives below the visible ones
- **THEN** a pointer reads *↓ New #N*, and tapping it scrolls that card into view

#### Scenario: The kitchen prefers the newest on top

- **WHEN** the kitchen chooses *Newest first* in the filter sheet and saves
- **THEN** the board lists the newest order first, and still does after a reload

### Requirement: A kitchen tablet chooses which categories it shows

A kitchen tablet SHALL hold a filter mode — *only these categories* or *everything
except these categories* — and a list of its outlet's menu categories, saved on the
tablet's own record and changeable on the tablet by whoever holds its live kitchen
shift. A new tablet SHALL show everything. A category added to the menu later SHALL
appear on a tablet in *everything except* mode and SHALL NOT appear on one in *only*
mode until chosen. A category's rename SHALL NOT change the filter. Moving the
tablet to another outlet SHALL clear its list.

The screen SHALL always state the filter in force, as the label of the control that
changes it. Packaging lines SHALL never be shown, whatever the filter.

#### Scenario: Two kitchens split the menu

- **WHEN** one kitchen tablet shows only Pasta and Burgers and another shows everything except Pasta and Burgers, and the owner adds a Mocktails category
- **THEN** a Mocktail ordered at the counter appears on the second kitchen and not the first

#### Scenario: The filter survives a reinstall

- **WHEN** the kitchen tablet's browser data is cleared and a kitchen shift is started on it again
- **THEN** it shows the filter it had before

#### Scenario: Another outlet's category

- **WHEN** a kitchen tablet hand-crafts a filter naming a category of a different outlet
- **THEN** the database refuses it and the filter is unchanged

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

### Requirement: The kitchen screen says when it may be out of date or silent

The screen SHALL re-read on every change notification, every twenty seconds while
visible, and on return to the foreground. It SHALL show a floating alert that cannot
be dismissed and is not hidden by any card while the browser reports no network,
the live channel is not subscribed, or the last successful read is more than
forty-five seconds old, and SHALL clear it on the next successful read. While it
shows, the cards SHALL remain, dimmed, and ACK SHALL be unavailable.

If the browser is refusing sound, the screen SHALL show an alert of the same
prominence saying so, and the first touch SHALL restore sound.

The screen SHALL keep the display awake while visible where the browser allows it.

#### Scenario: The network drops

- **WHEN** the kitchen tablet loses its network
- **THEN** within forty-five seconds the floating alert says the screen may be out of date, and it clears on the first successful read after the network returns

#### Scenario: The live channel dies silently

- **WHEN** the change notifications stop arriving while the network stays up
- **THEN** the twenty-second re-read keeps the screen current, and if reads fail the alert shows

#### Scenario: Reloaded into a live shift

- **WHEN** the kitchen tablet reloads while its shift is live and the browser refuses to play sound
- **THEN** the screen says sound is off and one tap turns it on

### Requirement: The demo shows a counter ringing a kitchen

Demo mode SHALL offer a kitchen tablet walkthrough mounting the real kitchen screen
over the demo's billing data. A counter walkthrough in one tab and a kitchen
walkthrough in another tab of the same browser SHALL share that data, so an order
saved, edited or cancelled in the counter tab alerts in the kitchen tab. Nothing is
written to real data.

#### Scenario: Two demo tabs

- **WHEN** a demo user saves an order in the counter tab
- **THEN** the kitchen tab shows it shaking and ringing

#### Scenario: Start again in one demo tab

- **WHEN** a demo user presses Start again in either tab
- **THEN** both tabs start again from the same demo data

### Requirement: The kitchen says its part of a ticket is Ready

Every non-cancelled cooking card SHALL carry **Done** as a circular checkbox at
the top right beside the timer. Unchecked it SHALL have a thicker gray outline,
pale interior and gray check inside a timer-sized touch target. Checking SHALL
fill it green, send captured owed lines immediately and exactly once, stop ACK
ringing, and collapse the muted gray ticket to its header. An expand arrow SHALL
replace the timer. Clicking anywhere on the Done card SHALL toggle expansion
both ways, except the Done/Undo control. The arrow SHALL also toggle it. The
checked and unchecked Done circles SHALL have the same outer diameter as the timer.

A Done ticket SHALL persist until every captured item is ticked at the counter.
It SHALL remain undoable whenever visible, with no time limit. Undo SHALL remove
only its readiness, preserving counter handover and making only unhanded food
owed again. A failed write SHALL restore the previous state and report the error.
There SHALL be no progress countdown or outline on the ticket.

Counter handover SHALL remove a Done ticket with a soft fade and small shrink in
its original slot, then hold a brief blank slot before other cards close the gap.
Reduced motion SHALL use only the fade. Unticking SHALL restore it as gray and
Done, rather than making the kitchen cook it again. Each Ready receipt SHALL
remain distinct from later cooking tickets of the same order.

Two kitchens SHALL mark their own dishes Ready independently; a dish both kitchens
show SHALL be ready for both once either marks it.

#### Scenario: Ready on a quiet card

- **WHEN** a kitchen that pressed ACK on an order presses Ready
- **THEN** the counter's dishes fill orange immediately, while the card collapses and remains on the kitchen board until handover

#### Scenario: Ready without ACK

- **WHEN** a kitchen presses Ready on a New card that is still ringing
- **THEN** the ringing stops, the card collapses, and the counter shows the ready-food bell

#### Scenario: Ready races an edit

- **WHEN** the counter raises a Chicken Shawarma from two to three just as the kitchen presses Ready on two
- **THEN** two are ready, and the third arrives on the kitchen as a new ticket

#### Scenario: Undo

- **WHEN** a cook presses Ready by mistake and unchecks its Done control later
- **THEN** only food not already handed over becomes an active ticket again, the checkbox returns to gray, and the counter's Ready fill clears without erasing handover

#### Scenario: Two kitchens

- **WHEN** an order has a Shawarma for one kitchen and a Pasta for another, and only the first presses Ready
- **THEN** only the Shawarma fills orange on the counter, and the Pasta is still on the second kitchen's board

### Requirement: What the kitchen has made never comes back to it

A kitchen's New, Edited and Cancelled states SHALL be judged on food still owed, and
against this tablet's latest acknowledgement made **since its latest Ready** of the
order that was not undone. So:

- Food owed on an order after this kitchen's Ready SHALL arrive as a **new ticket**:
  a New card, numbered *#N · n*, ringing like any new order, showing only the food
  owed.
- Food removed, quantities lowered, or the order cancelled after this kitchen's
  Ready, with nothing left owed here, SHALL show nothing and ring nothing.
- Before Ready, an edit SHALL be Edited and a removal of everything owed Cancelled,
  as for any acknowledged card, compared on owed quantities.

#### Scenario: Something added after Ready

- **WHEN** the kitchen has marked an order of two Shawarmas Ready and the counter adds a Fries
- **THEN** the kitchen shows a New card *#42 · 2* with only the Fries, while the Shawarmas remain in their separate collapsed Done ticket until handover

#### Scenario: One more of a ready dish

- **WHEN** the counter adds one more Shawarma to that order
- **THEN** the kitchen shows a New ticket with one Shawarma

#### Scenario: Removed after Ready

- **WHEN** the counter lowers a Ready line from three to two
- **THEN** no food returns to the cooking ticket and nothing rings; the Done receipt is capped to the remaining quantity

#### Scenario: Cancelled after Ready

- **WHEN** the counter cancels an order whose every dish here was marked Ready
- **THEN** no Cancelled card appears

#### Scenario: Edited while cooking

- **WHEN** the kitchen has pressed ACK but not Ready and the counter lowers a line from three to two
- **THEN** the card reads Edited with the quantity shown three → two until ACK

#### Scenario: Handover and untick

- **WHEN** the counter ticks all items in a Done ticket, then unticks one on an unfinished order
- **THEN** the Done ticket departs with a held blank slot and returns gray, collapsed, and still undoable
