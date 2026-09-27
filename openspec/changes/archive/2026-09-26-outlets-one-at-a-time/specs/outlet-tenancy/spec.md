## ADDED Requirements

### Requirement: Outlets lists every outlet, and each opens a page of its own

The Outlets surface SHALL list the outlets the reader may see, one row each,
stating its name, short code, location label, whether it is open, and its
tablets in one line. Selecting a row SHALL open that outlet's own page at
`outlets/:outletId`, which SHALL show that outlet and no other and SHALL offer no
outlet picker.

The owner's list SHALL include closed outlets, after the trading ones and marked
closed. A manager's list SHALL NOT include a closed outlet.

Whether an outlet is trading SHALL read Open or Closed, as plain words in a
Status column drawn as Team draws a person's status, with no coloured dot: a dot
names a live reading, and this is a setting somebody chose.

The list SHALL be shown even when the reader may see only one outlet.

The outlet's page SHALL offer a back action that returns the reader to the screen
they came from. Where the page was the first screen the app opened, it SHALL go
to the Outlets list instead of leaving the app.

An outlet the reader may not see SHALL read on its page exactly as one that does
not exist, and SHALL show nothing about it.

The address confers no authority. Every write SHALL remain decided by the
database from the writer's own assignments.

#### Scenario: A row opens its outlet

- **WHEN** the owner selects Kanchrapara's row on Outlets
- **THEN** Kanchrapara's page opens, showing only Kanchrapara

#### Scenario: Back returns where the reader came from

- **WHEN** a reader opens an outlet's page from Overview and presses back
- **THEN** they are on Overview again

#### Scenario: Back from a page opened first

- **WHEN** an outlet's page is the first screen the app opened, and the reader presses back
- **THEN** the Outlets list opens

#### Scenario: A closed outlet is listed last

- **WHEN** the owner opens Outlets while one outlet is closed
- **THEN** it is listed after every trading outlet, marked closed, and its page offers reopening and deletion

#### Scenario: One outlet is still a list

- **WHEN** a reader who may see one outlet opens Outlets
- **THEN** a list of that one outlet is shown, and selecting it opens its page

#### Scenario: An outlet the reader may not see

- **WHEN** a manager opens `outlets/:outletId` naming an outlet no assignment of theirs names
- **THEN** the page says it is not an outlet they can see, and shows nothing about it

#### Scenario: A new outlet opens on its page

- **WHEN** the owner adds an outlet from the list
- **THEN** that outlet's page opens

## MODIFIED Requirements

### Requirement: An outlet is read alongside what it is raising and the tablet standing at it

An outlet's page SHALL hold everything about it: its details,
and the tablets standing at its counter with the state each last reported. So
the question "is this shop all right?" is answered where the shop is, and no
group of the outlet's things SHALL read as standing beside the outlet rather than
within it.

Administering those tablets SHALL be done on that page, for that outlet, and
SHALL NOT need a separate page or a picker the reader must then set.

A tablet's state SHALL be what it last reported, and SHALL say so when the tablet
is out of touch, so that figures nothing is reporting are never read as live.

Closing an outlet SHALL be offered once, at the foot of its page, apart from its
routine actions. A trading outlet SHALL NOT offer deletion.

#### Scenario: The page says how the counter is

- **WHEN** an outlet's tablet is holding bills it has not sent
- **THEN** that tablet's card on the outlet's page states how many, and since when

#### Scenario: A tablet gone quiet

- **WHEN** a tablet has not reported recently
- **THEN** its card leads with being out of touch, before anything else it last reported

#### Scenario: Tablets are administered on the page

- **WHEN** a reader who may administer tablets sets one up, edits it or removes it
- **THEN** they do it from that outlet's page, and it acts on that outlet

#### Scenario: Closing is apart

- **WHEN** the owner opens a trading outlet
- **THEN** Mark closed is offered once at the page's foot, and deletion is not offered
