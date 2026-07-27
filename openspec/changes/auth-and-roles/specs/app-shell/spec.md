## ADDED Requirements

### Requirement: A real session provider fills the session interface

The real session provider SHALL construct the session from the authenticated
user's own profile record and access-token claims, and SHALL supply it through
the same session interface the demo provider implements. The real tree SHALL
construct only real data adapters, and the demo tree only mock adapters, with
no shared factory selecting between them at runtime.

#### Scenario: The shells serve a real session unchanged

- **WHEN** a real session renders a role shell
- **THEN** the shell reads role, outlet, and display name through the same
  interface it uses in demo mode, with no mode-conditional branches in shell or
  feature code

#### Scenario: The real tree constructs no mock adapters

- **WHEN** the real tree renders
- **THEN** the adapters it supplies are the real implementations, selected by
  which provider stack mounted rather than by a mode parameter

### Requirement: The shell exposes an account slot alongside the demo banner

Each role shell SHALL accept a slot in its persistent chrome for
session-specific controls, filled by the real tree with the account menu and by
the demo tree left unfilled. Shell components SHALL NOT branch on session mode
to decide what the slot contains.

#### Scenario: The account menu appears only in real mode

- **WHEN** a shell renders under the real provider stack and then under the
  demo provider stack
- **THEN** the account menu is present in the first case and absent in the
  second, with no mode test inside the shell
