# Design System — delta

## ADDED Requirements

### Requirement: What just happened is said by one shared toast

The app SHALL have one toast (`src/components/ui/toast.tsx`), and a surface that
reports an outcome the person might otherwise miss SHALL use it rather than a
banner or pill of its own. A toast SHALL state the outcome in words, SHALL be
readable for at least six seconds before it fades, and SHALL sit where it does
not read as part of the navigation. An outcome that did not go through SHALL be
told apart from one that did by its icon as well as its colour. A toast MAY
carry Undo, live for as long as it shows. A refusal of something the person
submitted SHALL NOT be moved into a toast; it stays on what was refused.

#### Scenario: A sign-in ends while the steps are watched

- **WHEN** a sign-in the owner watched live is signed back in, stops or goes
  quiet
- **THEN** a toast says so, the stopped and quiet ones as warnings

#### Scenario: A person leaves the list

- **WHEN** the owner deactivates or removes someone on Team
- **THEN** a toast names them and what happened, and a deactivation offers Undo
