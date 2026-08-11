## ADDED Requirements

### Requirement: The menu is a real record a manager creates and maintains in the app

An authorised manager SHALL create, rename, reprice, reorder, mark unavailable and
retire menu categories and items for an outlet they are entitled to, entirely
through the application and with no SQL. Prices SHALL be entered and stored in
integer paise. A retired or unavailable item SHALL disappear from the counter
without altering any bill or order line already captured.

**A gate must be reachable from an empty database.** Billing cannot go live at an
outlet until that outlet's menu exists, and it must have arrived by a route a new
franchisee could repeat.

**A category SHALL NOT be a thing a manager creates on its own.** The unit of work
is the item; a category is the heading items are grouped under, entered as a
free-form field on the item that suggests the outlet's existing categories and
creates an unrecognised one on the way through — the pattern the expense list
already uses. The surface SHALL therefore offer one add action, and SHALL NOT be
able to leave an empty category behind.

**A near miss SHALL be caught by comparison, and offered as a choice.** Because a
near miss silently fragments the counter's grid, a category the outlet does not
already have SHALL be compared against the ones it does before it is created. The
comparison SHALL ignore case, accents, punctuation and spacing, and SHALL find the
same name spelled differently, a singular beside a plural, a transposition or a
dropped or added letter, and one name sitting inside another. Where it finds
candidates, the surface SHALL present them as selectable choices at the moment of
confirmation, and choosing one SHALL file the item under that existing category
under its existing spelling — the correction belongs where the mistake was caught,
not behind a cancel and a retype. Creating the typed category anyway SHALL be one
of those choices rather than a separate route.

Selecting a choice SHALL NOT commit it. One action SHALL commit whichever choice
is selected, and SHALL be unavailable until one is, because a row that filed the
item the instant it was touched would put it under the wrong heading on a
mistaken tap — the fault this whole requirement exists to prevent. No choice SHALL
be selected by default, so the category is one the manager picked rather than one
the dialog did.

**Where nothing matches, nothing SHALL be asked.** A confirmation that fires on
every new category is read by nobody by the fourth item, and an outlet's whole menu
is entered in one sitting. An unmatched category SHALL therefore be created
without a dialog, which is what leaves the dialog meaning something when it does
appear.

**A newly added item or category SHALL be scrolled into view and briefly
highlighted.** Appending puts new work at the bottom, off screen, and a manager who
cannot see what they just added reads it as a failure and adds it again — so the
cost of not doing this is duplicate menu items, not mild confusion. The highlight
SHALL be suppressed under a reduced-motion preference; the scroll SHALL NOT be,
because it is orientation rather than decoration.

A newly created category SHALL be appended after the outlet's existing ones, and
the manager SHALL be able to reorder categories deliberately. Category order SHALL
NOT be alphabetical or fixed at creation: it is the order the counter groups by,
which is a decision the business makes.

The manager's item row SHALL carry its actions in one menu at the right with the
price immediately left of it, SHALL mark an unavailable item beside its name, and
SHALL render that row in the same disabled treatment as a deleted expense row.

#### Scenario: The first item at a new outlet
- **WHEN** a manager adds an item and types a category that resembles none the outlet has
- **THEN** the category exists with that item inside it and nothing was confirmed — with no separate step that could have created it empty

#### Scenario: A near-miss on an existing category
- **WHEN** the typed category differs from an existing one only by a character, a plural, capitalisation, an accent, punctuation or spacing
- **THEN** the existing category is offered as a choice before a new one is created, because two headings for one group split that group at the counter

#### Scenario: The near-miss is corrected where it was caught
- **WHEN** the manager picks an offered category and commits that choice
- **THEN** the item is filed under that existing category, spelled as that category already is, without the form being reopened or the name retyped

#### Scenario: A mistaken tap files nothing
- **WHEN** an offered category is touched but the choice is not committed
- **THEN** no item and no category has been written, and nothing can be committed until a choice is selected

#### Scenario: The deliberate near-miss is still allowed
- **WHEN** the manager means the new name despite the offered candidates
- **THEN** creating the typed category is available in the same dialog, and the category is created as typed

#### Scenario: The added item lands below the fold
- **WHEN** an item or a category is added and its place on the list is off screen
- **THEN** the list scrolls to it and it is briefly highlighted, so it is never mistaken for an add that failed

#### Scenario: A category's place at the counter is wrong
- **WHEN** a category was created later but should be read before another
- **THEN** the manager reorders it on the menu screen and the counter's grouping follows, without any item being retyped

#### Scenario: The last item leaves a category
- **WHEN** an item is retired and its category holds nothing else
- **THEN** no empty heading is left for a manager to tidy up

#### Scenario: The owner enters an outlet's menu
- **WHEN** a Super Admin creates that outlet's categories, items and prices through the menu surface
- **THEN** those items are immediately sellable at that outlet's counter and at no other outlet

#### Scenario: A price is corrected
- **WHEN** a manager changes an item's price
- **THEN** lines added afterwards use the new price and every captured order line and settled bill is unchanged

#### Scenario: An item is taken off
- **WHEN** an item is marked unavailable
- **THEN** it cannot be added at the counter and every historical line naming it still reads correctly

#### Scenario: Another outlet's menu
- **WHEN** a Franchise Admin hand-crafts a menu write for an outlet they do not manage
- **THEN** the database refuses it

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
- **WHEN** the tablet reloads or starts and cannot reach the backend for approval or a fresh menu
- **THEN** V1 opens no new billing work from a persisted cache, and shows unsent-work status instead
