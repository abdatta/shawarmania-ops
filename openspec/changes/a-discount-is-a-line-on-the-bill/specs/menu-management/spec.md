## ADDED Requirements

### Requirement: An outlet's menu discounts are set over categories, several at a time

The menu surface SHALL offer a **Set Discounts** action to the roles that may edit
the menu, and SHALL NOT name the capability anything else. The words sale, offer
and promotion SHALL NOT appear in the product.

Setting one SHALL take a basis — a percentage or an amount in rupees — a value,
and a set of categories chosen through a multi-select carrying a select-all.

An outlet MAY hold any number of active menu discounts at once, at different
values over different category sets, added one at a time. Each SHALL be
independently removable.

A Biller SHALL NOT be able to set, change or remove a menu discount, and the
database SHALL refuse it.

#### Scenario: Two discounts at different values

- **WHEN** a manager sets one discount over two categories and then sets another
  at a different value over two others
- **THEN** both are active, each over its own categories, and each is separately
  removable

#### Scenario: Every category at once

- **WHEN** a manager uses select-all
- **THEN** the discount covers every category in that outlet's menu

#### Scenario: A Biller attempts to set one

- **WHEN** a Biller hand-crafts a menu discount write
- **THEN** the database refuses it

#### Scenario: Another outlet's menu

- **WHEN** a Franchise Admin hand-crafts a menu discount write for an outlet they
  do not manage
- **THEN** the database refuses it

### Requirement: A rupee menu discount cannot exceed the cheapest item it reaches

A menu discount in rupees SHALL NOT be set to a value above the lowest item price
among the categories it covers.

An item SHALL NOT be repriced below the value of an active rupee menu discount
that reaches it, nor moved into a category whose active rupee discount exceeds its
price.

Both SHALL be refused by the database rather than only by the form.

#### Scenario: The discount is set too high

- **WHEN** a manager sets a rupee discount above the cheapest item in a selected
  category
- **THEN** it is refused, and the refusal names the constraint

#### Scenario: The item is repriced too low

- **WHEN** a manager lowers an item's price below a rupee discount already
  reaching it
- **THEN** the database refuses it

#### Scenario: A percentage has no such bound

- **WHEN** a percentage discount is set over any categories
- **THEN** no price floor applies, because a percentage of a price never exceeds
  it

### Requirement: The outlet's counter discount presets are configured with the menu

The menu surface SHALL let the roles that may edit the menu configure the
percentage presets the counter's discount panel offers.

An outlet SHALL hold between none and four presets, ordered, defaulting to ten,
fifteen and twenty percent. The upper bound SHALL be four, so the counter's preset
row never wraps.

#### Scenario: The presets are reduced

- **WHEN** a manager removes a preset
- **THEN** the counter panel offers the remaining ones on one row

#### Scenario: A fifth preset

- **WHEN** a manager attempts to configure a fifth preset
- **THEN** it is refused

## MODIFIED Requirements

### Requirement: The live counter prefers the latest reachable menu

While the backend is reachable, the tablet SHALL fetch the latest menu for its
outlet and SHALL NOT silently prefer a cached version. During a live shift, an
actual backend failure MAY fall back to that shift's last successful snapshot and
SHALL display an offline banner.

**The outlet's active menu discounts and its counter presets are part of the menu
the counter reads**, and SHALL reach the counter by the same path, on the same
triggers, and into the same persisted snapshot as prices and availability. They
SHALL NOT be fetched separately.

**Fetching once is not fetching the latest.** A counter tablet stays on the
billing screen for a whole trading session, and a menu resolved only when that
screen opened is a morning menu being sold from at night. Because a line captures
its item's name, price and discount terms at the moment it is added, a stale grid
is quoted and charged as current, so this is a money fault rather than a display
one.

The live counter SHALL therefore refresh its menu on **two independent triggers**,
and SHALL depend on neither alone:

- **Returning to the foreground.** The counter SHALL re-read its menu when the
  screen becomes visible again, as well as on mount.
- **A change reported by the backend.** The counter SHALL subscribe to changes to
  its own outlet's menu categories, items and discounts while reachable, and SHALL
  treat what arrives as a signal to re-read rather than as the data itself.

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

#### Scenario: A discount is turned on during service
- **WHEN** a manager sets a menu discount and the counter refreshes on either trigger
- **THEN** lines added afterwards carry it, and lines already captured are unchanged

#### Scenario: Both tills pick a discount up
- **WHEN** a manager changes a menu discount at an outlet running two tills
- **THEN** each till picks it up on its own next trigger, with no reload and no
  coordination between them

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
- **THEN** the counter may continue from that shift's snapshot, marks the screen offline, and snapshots the displayed name, price and discount terms into each new line

#### Scenario: The app starts with no reachable backend
- **WHEN** the tablet reloads or starts with no backend response, and holds a complete resume record whose approved shift has not expired
- **THEN** the counter opens from the persisted menu, labels it with the read it came from, sells under the discounts that snapshot carried, and each new line snapshots the displayed name, price and discount terms

#### Scenario: The app starts with no reachable backend and no live shift
- **WHEN** the tablet reloads or starts with no backend response and no unexpired approved shift to resume
- **THEN** it opens no new billing work from a persisted menu, and shows unsent-work status instead

#### Scenario: A price changed elsewhere during the outage
- **WHEN** lines were created from the persisted menu and the tablet later reconnects to a server-side price change
- **THEN** those lines retain their captured name, price and discount while the refreshed menu governs every line added afterwards
