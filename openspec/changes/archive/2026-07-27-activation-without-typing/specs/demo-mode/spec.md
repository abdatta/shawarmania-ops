## ADDED Requirements

### Requirement: The activation handover is demonstrable without leaving the app origin

Demo mode SHALL show the same activation handover a real admin gets — the link,
the machine-readable code image, and the code itself — built entirely in the
browser. No part of the handover SHALL be produced by a request to any host
other than the app's own origin.

#### Scenario: The demo issues a handover with a link and a code image

- **WHEN** an admin persona provisions an account in demo mode
- **THEN** the issued-code panel shows an activation link, a scannable image of
  it, and the code

#### Scenario: Producing the handover makes no off-origin request

- **WHEN** the demo walk provisions an account and renders the handover
- **THEN** no network request leaves the app's own origin
