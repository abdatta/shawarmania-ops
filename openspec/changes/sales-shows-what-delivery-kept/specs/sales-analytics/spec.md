## ADDED Requirements

### Requirement: Delivery revenue by day
Analytics → Sales SHALL show, below its other cards and behind a heading stating that it is delivery revenue only with one bar per day, one card per delivery channel holding figures for the selected outlet in the current period. The section SHALL follow the page's outlet and date range and SHALL NOT change with the Measure, Group by or period comparison. Each card SHALL show what customers paid, what the platform kept and what the outlet gets for the range, and one column per business date.

#### Scenario: Measure and grouping change
- **WHEN** the owner switches Sales from Revenue to AOV and from Day to Week
- **THEN** the delivery section still shows one column per day of delivery revenue, unchanged, and no analytics request is made

#### Scenario: An outlet with no delivery figures in the range
- **WHEN** the selected range holds no delivery day for the outlet
- **THEN** no channel card is drawn and the section says no delivery figures were recorded, rather than drawing empty or zero columns

### Requirement: What the platform kept is visible
A day whose commission is known SHALL be drawn as one filled column of what customers paid, split into what the outlet gets and what the platform kept in two distinct solid colours. A day whose net is negative SHALL be drawn below the zero line in a charge colour. A day whose commission is unknown SHALL show what customers paid in a third solid fill. A day that is not final SHALL keep its fill and carry a distinct outline, and a disputed day SHALL also carry a marker. Fills SHALL be solid, never hatched or striped, from semantic tokens defined for both themes and checked for contrast. A day with no figures recorded SHALL have no column and SHALL NOT read as zero.

#### Scenario: A charge with no sales
- **WHEN** Zomato recorded no sales and a ₹604.75 charge for a day
- **THEN** that day's column drops below zero in the charge colour, and inspecting it reads customers paid ₹0, kept ₹604.75, you get −₹604.75, Not final yet

#### Scenario: Commission not known yet
- **WHEN** a Swiggy day has ₹278 of sales and no commission recorded
- **THEN** its column shows ₹278 in the cut-not-known fill with the not-final outline, and inspection says Cut not known yet

### Requirement: Weekly delivery charges are listed, not spread
Charges a platform states for a week rather than a day SHALL be listed under that channel's card with their kind, week and amount when the week overlaps the range, and SHALL NOT be divided across daily columns. Hyperpure purchases collected through a payout SHALL NOT be listed as charges.

#### Scenario: Swiggy advertising
- **WHEN** Swiggy deducted ₹578.20 for advertising for 20–26 Sep and the range includes 24 Sep
- **THEN** the Swiggy card lists Ads, 20–26 Sep, −₹578.20, and no daily column changes because of it

### Requirement: Delivery detail arrives in the Sales snapshot
The Sales snapshot SHALL carry each recorded delivery day's commission (or its absence) and settlement state, and the weekly charges overlapping the current window, in the one aggregate read the page already makes. The Items view SHALL carry neither. The database SHALL return only the requested outlet's figures to an authorised owner or manager and refuse every other caller.

#### Scenario: A manager crafts a request for another outlet
- **WHEN** an outlet manager requests the Sales snapshot of an outlet they are not assigned to
- **THEN** the database refuses it, and no delivery day or weekly charge of that outlet is returned
