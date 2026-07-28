## ADDED Requirements

### Requirement: An outlet's address can be filled from a search in one action

The outlet form SHALL offer a search that suggests real places and, when one is
picked, fills the address block in a single action — street line, second line,
city and PIN code together.

The search SHALL restrict its results to India. It SHALL be debounced, and a
response to a superseded query SHALL NOT replace the results of a later one.

Picking a suggestion SHALL write every address field, including clearing those
the suggestion does not carry, so the address is never a mixture of two places.
The outlet's location label SHALL be filled only when it is empty, and SHALL
NEVER be overwritten, because it is the owner's own wording rather than an
address component.

#### Scenario: Picking a place fills the address

- **WHEN** an admin searches for a place while creating an outlet and picks a
  suggestion
- **THEN** the street line, second line, city and PIN code are filled from it in
  one action

#### Scenario: A pick never leaves a mixture of two addresses

- **WHEN** an admin picks one suggestion and then picks a different one that
  carries no PIN code
- **THEN** the PIN code from the first is cleared rather than left beside the
  second's street

#### Scenario: A label the admin wrote is never overwritten

- **WHEN** an admin types a location label and then picks a suggestion
- **THEN** the label they typed is left exactly as it is

#### Scenario: An empty label is filled from the pick

- **WHEN** an admin picks a suggestion while the location label is still empty
- **THEN** the label is filled from the place that was picked

### Requirement: The district is derived from the PIN code, never from the map

The district SHALL be resolved from the PIN code through a postal directory,
and SHALL NOT be taken from the geocoding result — no field of which is the
Indian revenue district.

The resolution SHALL run both when a suggestion supplies a PIN code and when an
admin edits the PIN code by hand, so the district is filled for somebody who
never opens the search.

Resolving the district SHALL NOT delay the rest of the fill.

#### Scenario: The district follows a picked place

- **WHEN** an admin picks a suggestion carrying a PIN code
- **THEN** the address fields fill immediately and the district is filled from
  that PIN code once the directory answers

#### Scenario: Typing a PIN code alone fills the district

- **WHEN** an admin types a valid PIN code by hand without using the search
- **THEN** the district is filled from it

#### Scenario: A PIN code the directory does not know leaves the field alone

- **WHEN** the postal directory returns nothing for a PIN code
- **THEN** the district is left empty for the admin to type, and no error is
  shown

### Requirement: The address search never blocks creating an outlet

The lookup SHALL be optional to the operation in progress. A lookup that fails,
times out, is refused or is unreachable SHALL produce no error message, SHALL
leave every field editable, and SHALL leave the outlet creatable exactly as it
is without the lookup.

A search that completes with no matches SHALL say so, because silence is
indistinguishable from a search still running.

#### Scenario: An unreachable lookup changes nothing

- **WHEN** the address lookup cannot be reached
- **THEN** no error is shown, every address field remains editable, and the
  outlet can be created with a hand-typed address

#### Scenario: No matches is stated rather than left blank

- **WHEN** a search returns no results
- **THEN** the surface says there are no matches and points at the fields below

#### Scenario: Every filled field stays editable

- **WHEN** an admin picks a suggestion and then edits any filled field
- **THEN** the edit is kept and the outlet saves with the edited value

### Requirement: An address lookup never supplies an outlet's position

The address lookup SHALL NOT write `latitude`, `longitude`, `geofence_radius_m`
or the survey timestamp, and the coordinates returned by a geocoder SHALL be
discarded rather than carried through the application.

Capturing an outlet's position on site SHALL remain the only way an outlet
becomes surveyed.

#### Scenario: Picking a place leaves the outlet unsurveyed

- **WHEN** an admin creates an outlet, picks an address suggestion, and saves
- **THEN** the outlet has no captured position, judges nobody against a fence,
  and is still shown as unsurveyed

#### Scenario: Coordinates are not carried through the application

- **WHEN** a geocoding result carrying coordinates is turned into a suggestion
- **THEN** the suggestion has no latitude or longitude to read
