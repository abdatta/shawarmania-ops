## ADDED Requirements

### Requirement: A menu opens where it can be read

A menu, popover or other transient panel placed in the window SHALL open on its
usual side of its trigger when it fits there, on the other side when it does
not, and SHALL be held inside the window either way. No part of an open menu
SHALL lie outside the window while the window is large enough to hold it.

The window here is what a person can read. Chrome the app keeps fixed over the
window's top or bottom edge, such as the phone's navigation bar, SHALL count as
that edge: a menu SHALL NOT open over it when the other side of its trigger has
room.

An open menu SHALL stay beside its trigger while the trigger moves: when the page
scrolls, when the window resizes, and when the trigger's card or row moves
because the list around it changed. It SHALL NOT move the page to make room for
itself.

#### Scenario: A menu that opens upward has no room above

- **WHEN** a pipeline card's menu is opened with its trigger at the top of the window
- **THEN** the menu opens below the trigger, wholly inside the window

#### Scenario: A menu that opens downward has no room below

- **WHEN** a row's actions menu is opened with its trigger at the bottom of the window
- **THEN** the menu opens above the trigger, wholly inside the window

#### Scenario: A row sits just above the phone's bottom bar

- **WHEN** a row's actions menu is opened on a phone with its trigger just above the navigation bar, where the window has room below the trigger and the bar covers it
- **THEN** the menu opens above the trigger, clear of the bar

#### Scenario: The trigger moves while the menu is open

- **WHEN** a menu is open and its card slides into a place another card freed
- **THEN** the menu ends beside its trigger, and the page does not scroll
