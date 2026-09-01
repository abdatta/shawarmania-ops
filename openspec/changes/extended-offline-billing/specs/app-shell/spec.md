## ADDED Requirements

### Requirement: A cold start with no backend opens the counter or nothing

On a set-up tablet whose first session resolution receives no backend response,
the shell SHALL open the billing-only counter when a complete resume record for
this same installation proves an approved shift that has not ended and whose
expiry and outlet cutover are both still ahead. It SHALL otherwise keep today's
could-not-confirm screen with its retry.

An offline counter SHALL expose no personal-role surface, no account menu and no
sign-out, exactly as an online one does, and SHALL carry the persistent offline
line with the time of its last successful read.

#### Scenario: Valid offline resume

- **WHEN** the tablet cold-starts offline before its approved shift expires
- **THEN** the billing-only counter opens with offline provenance and no personal-role pages

#### Scenario: Offline cold start after the shift ended

- **WHEN** the same tablet cold-starts offline after its shift expired or the outlet cut over
- **THEN** the shell withholds new billing, shows unsent and needs-attention status, and directs the operator to reconnect and open a shift from their own phone

#### Scenario: A person's session is unaffected

- **WHEN** any human session cold-starts with no backend response
- **THEN** nothing changes: resume records are a counter-tablet mechanism and grant no human session anything

## MODIFIED Requirements

### Requirement: Billing lifecycle surfaces are gated by context and readiness

The registry SHALL define the Counter composer, Open orders, My shift and manager
bill history as gated surfaces. The Counter surface SHALL combine the composer,
**Bills this shift** and the **outlet's preparation pipeline** into one
three-column workspace **at every width**, and Open orders and My shift SHALL
therefore carry no navigation entry of their own: a tab leading to a second copy
of a column already on screen is a second door into one room. Their routes and
standalone layouts SHALL remain, because the gate still decides whether the
content renders and a link into either one still has to resolve. Tablet routes
SHALL expose only Counter-context entries; personal FA and SA shells SHALL expose
their authorised history entries. Until billing goes live, every new entry SHALL
be absent for real users and walkable in demo mode.

The menu column SHALL remain at least 22rem wide. The **middle and activity**
columns SHALL each start at 22rem and offer independent, named resize controls.
Dragging or using the controls' keyboard interaction SHALL resize only the named
column, never fold, reorder, or hide a column. The selected widths SHALL be
remembered by the counter browser and invalid or unavailable stored preferences
SHALL fall back to the 22rem default. When the three minimum columns or a chosen
width do not fit, the workspace -- and only the workspace -- SHALL scroll
horizontally.

#### Scenario: Demo Counter navigation
- **WHEN** demo mode renders the Counter shell after this change
- **THEN** the composer, Shift, Menu and Expenses are reachable, Open orders and My shift appear as columns rather than as tabs, and no personal admin navigation appears

#### Scenario: Counter workspace at any width
- **WHEN** demo mode renders the Counter at a landscape-tablet width or narrower
- **THEN** the menu, the middle column and the outlet's preparation pipeline are all present as three touch-safe columns, without changing routes and without any of them folding away

#### Scenario: A counter user resizes an activity column
- **WHEN** a user drags or uses the named resize control for the middle or activity column
- **THEN** that column changes width, the menu remains at least 22rem wide, and all three columns remain in their original order

#### Scenario: A counter reloads with a saved layout
- **WHEN** a counter browser reloads after either resizable column was adjusted
- **THEN** the workspace restores the valid saved widths, or both columns use the 22rem default when no valid preference is available

The Counter shell SHALL NOT carry a read-only Menu surface. The Counter's own menu
column shows every item, its price, its veg marker and an Off marker on anything
unavailable, permanently and beside the bill, so a second page carrying the same
facts is a second place to look. The refusal of a Biller's menu write SHALL remain
the menu policies', unchanged by the surface's absence.

#### Scenario: A biller asks whether an item is still on
- **WHEN** a biller needs to know what is available and what it costs
- **THEN** the Counter's menu column answers it without leaving the till, and no separate Menu entry exists in the Counter shell

#### Scenario: A biller's menu write
- **WHEN** a Biller session attempts a menu write directly against the data layer
- **THEN** it is refused by policy exactly as it was while the read-only screen existed

#### Scenario: Real user before promotion
- **WHEN** a real signed-in user loads the application before billing goes live
- **THEN** the new billing entries remain absent rather than disabled

### Requirement: Billing V1 gates expose only the appropriate live context

The gate registry SHALL expose live counter navigation only on a set-up tablet
holding a live shift, whether that shift was resolved from the server or resumed
from a complete resume record while the backend is unreachable. Personal Biller
sessions SHALL retain their Employee and staff navigation, and FA and SA personal
sessions SHALL reach only their authorised management surfaces.

#### Scenario: A Biller signs in on a personal phone
- **WHEN** a Biller authenticates outside tablet context
- **THEN** the shell presents their Employee and staff capabilities and not the live counter

#### Scenario: An eligible operator holds the shift on the tablet
- **WHEN** a Biller, that outlet's FA, or an SA holds an approved shift on the set-up tablet
- **THEN** the shell presents the billing-only counter context and preserves no personal-role pages in that tablet session

#### Scenario: The shift is resumed rather than resolved
- **WHEN** the same approved shift is reopened from a resume record with no backend reachable
- **THEN** the shell presents exactly the same billing-only context, marked offline, and no additional surface becomes reachable by being offline
