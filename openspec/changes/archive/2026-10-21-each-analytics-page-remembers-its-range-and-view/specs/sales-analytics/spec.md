## ADDED Requirements

### Requirement: Each page reopens on its last date shortcut
Items and Sales SHALL each remember, for the signed-in person on that browser and separately in demo mode, the last date shortcut (1d, 7d, 30d or Month) whose range was chosen there, and SHALL open on it whenever the address names no dates, counted from the outlet's current business date, with that shortcut's grouping. A choice on one page SHALL NOT change the other. Ranges chosen by hand or by stepping to an earlier period SHALL NOT change what is remembered. Where the remembered shortcut is not offered, its nearest one SHALL be used (Month for 30d, 30d for Month). With nothing remembered, or with storage unavailable, the page SHALL open on 7d. An address naming dates SHALL open on those dates.

#### Scenario: Items on a day, Sales on a week
- **WHEN** the owner taps 1d on Items, opens Sales, taps 7d there, and opens the app again the next day
- **THEN** Items opens on that business day grouped by hour, and Sales opens on the seven days ending that day grouped by day

#### Scenario: A hand-picked range is a one-off
- **WHEN** the owner, with 1d remembered on Sales, picks 3–9 Oct by hand and later reopens Sales
- **THEN** Sales opens on 1d

#### Scenario: Another person on the same phone
- **WHEN** a manager signs in on a phone where the owner remembered 30d on Items
- **THEN** Items opens on 7d for the manager

### Requirement: Each trend reopens as it was last read
Items and Sales SHALL each remember, the same way as the date shortcut, whether the person last read the trend as Chart, Cumulative or Table, and the card SHALL open on it whenever the address names no view. With nothing remembered the card SHALL open as Chart. A choice on one page SHALL NOT change the other, and an address naming a view SHALL open on it.

#### Scenario: Items as a table, Sales as a running total
- **WHEN** the owner chooses Table on Items and Cumulative on Sales, then reopens each page from the navigation
- **THEN** Items opens as the table and Sales as the running total
