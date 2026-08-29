# Delta: counter-billing

## MODIFIED Requirements

### Requirement: Item names and prices are read, not decoded

A menu tile, a bill line and a closed bill's line SHALL show the item's full
name, never truncated with an ellipsis, because the end of the name is what
distinguishes items on this menu from each other. A menu tile SHALL carry its
price at the top right, in the same place whatever the name above it does, and
an unavailable item SHALL show that it is off **instead of** its price.

Bills in a list SHALL name today as today rather than repeating the date on
every row. Yesterday SHALL retain its relative label; an earlier date in the
current calendar year SHALL omit the repeated year, and a date from an older
year SHALL retain it. Every comparison SHALL use Asia/Kolkata rather than the
browser's local timezone.

#### Scenario: Two items with a long shared prefix

- **WHEN** a category holds items whose names differ only near the end
- **THEN** both names are shown in full, the tile growing to fit rather than clipping, and every tile in that row keeps the same height

#### Scenario: An item the kitchen has run out of

- **WHEN** an item is unavailable
- **THEN** its tile shows an Off marker where its price would be, and shows no price at all, so a figure that cannot be sold cannot be quoted

#### Scenario: A shift's bills across calendar dates

- **WHEN** the biller reads this shift's closed bills
- **THEN** each row says Today with the time, says Yesterday for a shift that crossed midnight, omits the year for any earlier date in the current calendar year, and retains the year for an older year
