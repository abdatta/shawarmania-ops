# identity-and-access (delta)

## MODIFIED Requirements

### Requirement: Each role lands on a shell it holds an assignment for

After sign-in a session SHALL be routed to the shell of the highest role it
holds a live assignment for. A session SHALL be able to reach any role shell it
holds a live assignment for, and SHALL NOT be able to render one it cannot
reach — navigating there SHALL redirect it home.

A session holding the owner role SHALL additionally reach the outlet-level
manager shell, at every outlet, without holding an assignment at any of them.
Its authority there is the owner's own and is resolved by the database from the
owner role, so no assignment is written to grant it and none is required to use
it. What that authority stops short of does not change: the existing non-cash
boundary stands, so at an outlet they hold no assignment at the owner is offered
neither a day close nor a withdrawal, and the database refuses both.

Navigation SHALL be the union of the surfaces the session can reach, so that a
person who manages one outlet and works at another reaches both sets of surfaces
without switching anything.

#### Scenario: All four roles reach their own shell

- **WHEN** a Super Admin, a Franchise Admin, a Biller, and an Employee each
  sign in
- **THEN** each lands on their own role's home surface with that role's
  navigation

#### Scenario: A mixed-role person sees both sets of surfaces

- **WHEN** a person holding a Franchise Admin assignment at one outlet and an
  Employee assignment at another signs in
- **THEN** they land on the Franchise Admin shell and their navigation includes
  their own attendance alongside the manager surfaces, with no switcher

#### Scenario: The owner reaches the manager shell unassigned

- **WHEN** a Super Admin holding no outlet assignment navigates to the
  outlet-level manager shell
- **THEN** it renders, scoped to an outlet they may see, rather than redirecting
  them home

#### Scenario: The owner's unassigned reach still stops at the drawer

- **WHEN** a Super Admin holding no assignment at an outlet opens that outlet's
  cash surface
- **THEN** the day is shown, neither a day close nor a withdrawal is offered,
  and both are refused by the database if attempted by a hand-crafted request

#### Scenario: A path for an unreachable role redirects

- **WHEN** a signed-in session navigates to the path of a role it can neither
  hold nor reach
- **THEN** it is redirected to its own home rather than rendering that shell

#### Scenario: A signed-in visit to the landing page goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to its own home rather than shown the unauthenticated
  landing page
