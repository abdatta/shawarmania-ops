## RENAMED Requirements

- FROM: `### Requirement: The demo link is found in the owner's account menu, not on the public landing page`
- TO: `### Requirement: The demo link is found in the owner's account menu, not on the unauthenticated entry screen`

## MODIFIED Requirements

### Requirement: The demo link is found in the owner's account menu, not on the unauthenticated entry screen

Nothing an unauthenticated visitor can reach SHALL offer a route into demo mode.
The Super Admin's account menu SHALL offer one entry into it, and that entry
SHALL address demo mode itself rather than any single role. Sharing the link is
left to the browser, so no in-app copy action is required.

Demo mode SHALL remain reachable without authentication, so that a shared link
works for a recipient who has no account.

Leaving demo mode SHALL continue to return to the application root, and the
screen the root resolves to for a visitor with no session is not demo mode's
concern. The exit exists for the owner who was demonstrating, so arriving at the
way in is the correct outcome of leaving.

#### Scenario: The unauthenticated entry screen

- **WHEN** a visitor with no session opens the application root and reaches the
  screen it resolves to
- **THEN** no route into demo mode is offered

#### Scenario: The owner produces the link

- **WHEN** the Super Admin opens their account menu
- **THEN** a demo entry is offered, and it addresses demo mode rather than one role's path

#### Scenario: A recipient with no account

- **WHEN** somebody with no session opens the shared link
- **THEN** demo mode renders, without a sign-in being requested

#### Scenario: Leaving the demo still returns to the root

- **WHEN** a visitor uses the indicator's exit
- **THEN** the application root is reached and resolves as it would for any
  visitor, and the demo indicator is gone
