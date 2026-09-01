## MODIFIED Requirements

### Requirement: The live counter prefers the latest reachable menu

While the backend is reachable, the tablet SHALL fetch the latest menu for its
outlet and SHALL NOT silently prefer a cached version. During a live shift, an
actual backend failure MAY fall back to that shift's last successful snapshot and
SHALL display an offline banner.

**Fetching once is not fetching the latest.** A counter tablet stays on the
billing screen for a whole trading session, and a menu resolved only when that
screen opened is a morning menu being sold from at night. Because a line captures
its item's name and price at the moment it is added, a stale grid is quoted and
charged as current, so this is a money fault rather than a display one.

The live counter SHALL therefore refresh its menu on **two independent triggers**,
and SHALL depend on neither alone:

- **Returning to the foreground.** The counter SHALL re-read its menu when the
  screen becomes visible again, as well as on mount.
- **A change reported by the backend.** The counter SHALL subscribe to changes to
  its own outlet's menu categories and items while reachable, and SHALL treat what
  arrives as a signal to re-read rather than as the data itself.

The subscription SHALL NOT be the only path by which a change reaches the counter,
because a channel that stops delivering does so silently and leaves every price on
screen looking correct. The foreground re-read is the guaranteed floor: the worst
case SHALL be a menu that is current as of the last time somebody returned to the
screen.

A refresh SHALL NOT disturb work in progress. It SHALL replace only the menu
being chosen from; lines already captured on the panel keep their snapshots, an
order under edit remains under edit, and a suspended draft is preserved.

**A persisted menu MAY start the counter, and only inside a shift already
approved online.** The tablet SHALL retain the menu it is selling from as part of
its resume record, MAY open the counter from it after a cold start with no
backend reachable, SHALL label the grid with the read it came from, and SHALL
replace it with the latest menu on the first successful response.

#### Scenario: A price changes while the counter is online
- **WHEN** the counter refreshes after an authorised price change and the backend responds
- **THEN** newly added lines use the latest price while captured order and bill lines keep their snapshots

#### Scenario: The tablet has been open all evening
- **WHEN** a manager reprices an item and nobody touches the counter tablet, which has been on the billing screen for hours
- **THEN** the counter re-reads on the reported change and the next line added is charged at the new price, without anybody reloading the app

#### Scenario: The subscription is silently not delivering
- **WHEN** the change channel stops reporting without erroring and an item is marked unavailable
- **THEN** the counter still picks the change up the next time the screen returns to the foreground, and the item cannot be added from that point

#### Scenario: A refresh arrives mid-order
- **WHEN** the menu is re-read while a bill is part composed or a saved order is being edited
- **THEN** the grid updates and every captured line, the order under edit and any suspended draft are exactly as they were

#### Scenario: The backend drops during a live shift
- **WHEN** the menu loaded successfully and a later refresh receives no backend response
- **THEN** the counter may continue from that shift's snapshot, marks the screen offline, and snapshots the displayed name and price into each new line

#### Scenario: The app starts with no reachable backend
- **WHEN** the tablet reloads or starts with no backend response, and holds a complete resume record whose approved shift has not expired
- **THEN** the counter opens from the persisted menu, labels it with the read it came from, and each new line snapshots the displayed name and price

#### Scenario: The app starts with no reachable backend and no live shift
- **WHEN** the tablet reloads or starts with no backend response and no unexpired approved shift to resume
- **THEN** it opens no new billing work from a persisted menu, and shows unsent-work status instead

#### Scenario: A price changed elsewhere during the outage
- **WHEN** lines were created from the persisted menu and the tablet later reconnects to a server-side price change
- **THEN** those lines retain their captured name and price while the refreshed menu governs every line added afterwards
