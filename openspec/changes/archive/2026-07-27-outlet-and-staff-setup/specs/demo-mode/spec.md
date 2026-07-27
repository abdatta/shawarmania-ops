## ADDED Requirements

### Requirement: Demo fixtures include the unconfigured states, not only the finished one

Demo fixtures SHALL include at least one app account with no roster row and at
least one roster row with no app account, so that both halves of *"this person
cannot check in"* are visible in the walkthrough and the linking that resolves
them can be demonstrated rather than described.

This exists because fixtures that describe an already-configured business are
what allowed a feature to ship unreachable: every test started from a wired-up
world, and none asked how that world comes to exist.

#### Scenario: The demo shows a person who cannot check in

- **WHEN** the demo Staff surface renders
- **THEN** at least one person is shown as having no app account, and at least
  one demo account is shown as being on no roster

#### Scenario: Linking is demonstrable, not pre-baked

- **WHEN** a demo walkthrough links an unlinked account to an unlinked roster row
- **THEN** both surfaces update to show the person as able to check in, without
  the demo tree making any request beyond the app origin

### Requirement: Outlet setup is exercised in demo mode

The demo SHALL support creating and editing an outlet through the same surface
the real session uses, served by the mock adapters, so that the first-outlet
path is walkable without a backend.

#### Scenario: Creating an outlet in demo mode

- **WHEN** a demo Super Admin creates an outlet
- **THEN** it appears in the demo outlet list and can be assigned accounts,
  and no request leaves the app origin
