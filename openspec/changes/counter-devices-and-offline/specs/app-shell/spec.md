## ADDED Requirements

### Requirement: Tablet context overrides personal-role navigation

The application SHALL, when a browser holds a valid counter tablet device
session, render the Counter shell and only the billing, shift, expenses, sync and
tablet surfaces permitted there. It SHALL NOT render personal Employee, FA or SA
navigation based on the person who holds the shift.

#### Scenario: Owner holds the shift
- **WHEN** an SA's shift request is approved for a tablet
- **THEN** the Counter shell stays mounted and no owner or manager route becomes reachable

#### Scenario: Personal device has a Biller account
- **WHEN** the same Biller signs in on an unregistered personal browser
- **THEN** their Employee-capable personal shell renders instead of the Counter shell

### Requirement: Every personal home surfaces a waiting request and a live shift

The home surface of each personal shell (Employee, Franchise Admin and Super
Admin) SHALL show any shift request awaiting the reader, and any shift the reader
currently holds, with the outlet, the tablet and the time. The request card SHALL
ask for the code displayed on that tablet and SHALL offer rejection without one. A
waiting request SHALL raise the same attention count the shell already renders for
other waiting work. Neither SHALL appear on a shell belonging to anybody else.

#### Scenario: A request is waiting
- **WHEN** a person has a pending shift request and opens their home surface
- **THEN** the card is shown with its outlet, tablet and time, asks for the code on the tablet, and offers a rejection that needs no code

#### Scenario: A request arrives while the app is open
- **WHEN** a request is created while that person's home surface is already on screen
- **THEN** the card appears without the person reloading

#### Scenario: A request is withdrawn while the app is open
- **WHEN** the tablet cancels the request, or it expires, while the card is on screen
- **THEN** the card disappears and says why, rather than accepting a code that can no longer work

#### Scenario: Realtime is unavailable
- **WHEN** the live channel cannot be established
- **THEN** the card still appears when the surface is loaded or refocused, and nothing reports a false empty state

#### Scenario: A shift is live
- **WHEN** the reader holds a live shift
- **THEN** their home shows it with the outlet, tablet and opening time, and offers to end it

#### Scenario: Somebody else's request
- **WHEN** a person opens their home while a request names a different person
- **THEN** nothing about that request is shown or counted
