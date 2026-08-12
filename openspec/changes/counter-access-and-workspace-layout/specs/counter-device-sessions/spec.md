## MODIFIED Requirements

### Requirement: A tablet is set up with a one-time code, and no password is typed on it

An authorised admin SHALL generate a single-use setup code for one outlet: a
Franchise Admin only for an outlet they manage, a Super Admin for any active
outlet. The code SHALL be stored only as a hash, be readable by no client role,
expire, and be consumed by its first successful use. An unconfigured tablet
SHALL offer a clearly labelled in-app route from the signed-out front door to
the setup form. Entering the code on that tablet SHALL create the device
session. No account password SHALL be accepted on a tablet at setup or at any
time afterwards.

#### Scenario: An unconfigured installed tablet reaches setup
- **WHEN** the signed-out app opens on an unconfigured counter tablet
- **THEN** its sign-in screen offers a clearly labelled link to the setup form,
  without asking the tablet for a personal account password

#### Scenario: Manager sets up their outlet tablet
- **WHEN** an FA generates a setup code on their own phone and it is entered on the counter tablet, and no active tablet exists for that outlet
- **THEN** one active tablet is created for that outlet and the browser receives its device session

#### Scenario: A second active tablet is refused
- **WHEN** a setup code is used while the outlet already has an active tablet
- **THEN** setup is refused and neither tablet changes

#### Scenario: Cross-outlet setup is refused
- **WHEN** an FA hand-crafts a setup code request for an outlet they do not manage
- **THEN** no code, Auth identity or tablet row is created

#### Scenario: A code is reused
- **WHEN** a setup code that has already been consumed or has expired is entered
- **THEN** setup is refused and the response reveals nothing about the code's history

#### Scenario: Setup fails midway, before the code is consumed
- **WHEN** the machine identity is created and the redemption is refused for any reason
- **THEN** that identity is deleted, the code is not consumed, and the same code still works

#### Scenario: Setup fails after the code is consumed
- **WHEN** redemption succeeds but the tablet does not establish its session — the response is lost, or the sign-in fails
- **THEN** the code is spent and the tablet row stands, the tablet says so plainly rather than blaming the code, and an admin removes it and issues another
