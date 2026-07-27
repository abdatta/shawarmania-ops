## ADDED Requirements

### Requirement: Account invitations are outlet-scoped and their codes are unreadable

The record of an outstanding one-time code SHALL be outlet-scoped like every
other outlet-scoped table, with Row-Level Security restricting reads to the
Super Admin and to the Franchise Admin of the invitation's own outlet. No
client role SHALL be able to read the stored code hash by any means, including
an explicit request for that column. No client role SHALL be able to insert,
update, or delete an invitation; those writes SHALL only be possible with the
service-role credential inside a privileged server-side function.

#### Scenario: A Franchise Admin cannot see another outlet's invitations

- **WHEN** a Franchise Admin scoped to one outlet requests invitations,
  including with an explicit filter naming the other outlet
- **THEN** no rows from the other outlet are returned

#### Scenario: The code hash is unreadable even by the Super Admin

- **WHEN** any signed-in session requests the stored code hash column
- **THEN** the request is refused by the database

#### Scenario: No client can write an invitation

- **WHEN** any signed-in session attempts to insert, update, or delete an
  invitation row directly
- **THEN** the database refuses the write
