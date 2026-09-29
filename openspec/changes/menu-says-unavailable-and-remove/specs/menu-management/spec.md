## MODIFIED Requirements

### Requirement: Availability is a distinct, thumb-reachable action

Changing an item's availability SHALL be a single action on the item's row,
separate from opening the item for editing, and the item's rendered state
SHALL change immediately to reflect it. The action SHALL be named for what it
does — **Mark unavailable** on an available item and **Mark available** on an
unavailable one — and SHALL NOT be a bare on/off word, because *off* does not say
whether the item is gone from the menu or only sold out. An unavailable item SHALL
remain visible and SHALL be labelled **Unavailable** rather than removed from the
list.

#### Scenario: Marking an item unavailable

- **WHEN** a Franchise Admin chooses Mark unavailable on an item that is available
- **THEN** the item is marked unavailable in place, and no editing form is opened

#### Scenario: An unavailable item stays on the list

- **WHEN** the menu surface renders an item that is not available
- **THEN** the item is present and labelled Unavailable, and its action reads Mark available

### Requirement: A Biller may read the menu and may not change it

A Biller SHALL be able to read their outlet's menu — every item, its price, its
vegetarian marker and whether it is currently sellable — **from the counter
itself**, without navigating away from the bill they are composing. There SHALL
NOT be a separate read-only menu surface in the Biller's shell: the counter's menu
column carries those facts permanently, and a second page carrying the same facts
is a second place to look.

Every menu write SHALL be refused for a Biller by the data layer rather than by the
absence of a control or of a surface. An unavailable item SHALL remain visible to
the Biller, labelled **Unavailable** and **without its price**, since a price nobody can sell
is one a biller might quote before noticing.

#### Scenario: A Biller checks what is available and what it costs
- **WHEN** a Biller needs to know whether an item is on and what it charges
- **THEN** the counter's own menu column answers both without leaving the till, and no Menu entry exists in that shell

#### Scenario: A Biller attempts a menu write
- **WHEN** a Biller session attempts to create, edit, or change the availability of a menu item
- **THEN** the write is refused by the data layer, unchanged by the read-only surface having been removed

#### Scenario: An item the kitchen has run out of
- **WHEN** an item is marked unavailable
- **THEN** the Biller still sees it, labelled Unavailable, carrying no price, and cannot add it to a bill

### Requirement: The menu is a real record a manager creates and maintains in the app

An authorised manager SHALL create, rename, reprice, reorder, mark unavailable and
remove menu categories and items for an outlet they are entitled to, entirely
through the application and with no SQL. Prices SHALL be entered and stored in
integer paise. A removed item SHALL disappear from the counter and an unavailable
one SHALL refuse to be sold there, without altering any bill or order line
already captured.

**Removing is not deleting.** The action SHALL be named **Remove**, and SHALL
confirm before it acts. A removed item SHALL leave the working menu for good while
its row is kept, because captured order and bill lines refer to it; there is no
restore action, and adding the item again is how it comes back. Unavailable is
the temporary state and Remove the permanent one, and the two SHALL NOT share a
word.

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
- **WHEN** an item is removed and its category holds nothing else
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

#### Scenario: Removing an item
- **WHEN** a manager chooses Remove on an item and confirms
- **THEN** the item leaves the menu and the counter, its row is kept, and every captured order and bill line naming it reads exactly as before
