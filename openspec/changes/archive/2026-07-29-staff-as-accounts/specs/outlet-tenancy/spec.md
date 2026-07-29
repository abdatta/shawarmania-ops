# outlet-tenancy — delta for staff-as-accounts

## MODIFIED Requirements

### Requirement: An Employee reads only their own records

An Employee session SHALL read only their own attendance rows — the rows
keyed to their own account — and none of any colleague, in either outlet.

#### Scenario: Employee lists attendance

- **WHEN** an Employee lists attendance rows
- **THEN** only rows keyed to their own account are returned

#### Scenario: Employee requests a colleague's rows

- **WHEN** an Employee issues a request explicitly naming a colleague's
  account id
- **THEN** zero rows are returned

### Requirement: Deactivating an outlet stops trading without destroying anything

An outlet SHALL carry an active state that the Super Admin can set. A
deactivated outlet SHALL disappear from assignment lists and operating views,
and SHALL NOT cascade: its accounts and its recorded attendance SHALL remain
exactly as they were, and reactivation SHALL restore the outlet with all of
them intact.

The confirmation for deactivation SHALL state what it does not do, so that an
owner who expects it to revoke logins is corrected before acting.

#### Scenario: Deactivation leaves accounts and history intact

- **WHEN** a Super Admin deactivates an outlet that has accounts and recorded
  attendance
- **THEN** all of those rows still exist and are unchanged, and reactivating the
  outlet restores it to the lists it left

#### Scenario: A deactivated outlet is not offered for assignment

- **WHEN** an admin opens the account form after an outlet is deactivated
- **THEN** that outlet is not among the outlets an account can be assigned to

### Requirement: An outlet that nothing references can be deleted, by the owner alone

A Super Admin SHALL be able to delete an outlet from the app, and no other role
SHALL be offered the action or permitted it. The database SHALL refuse the
delete for every other role regardless of what a client sends — a `DELETE`
grant and an `outlets_delete` policy are the boundary, not the absence of a
button.

Deletion SHALL succeed only while no row anywhere references the outlet. The
refusal SHALL be enforced by referential integrity rather than by a maintained
flag or a count kept in application code, so that an outlet becomes deletable
the moment the last thing referencing it is gone, with nothing to re-mark.

Deletion SHALL NOT cascade. No dependent row SHALL be removed, reassigned or
altered in order to make a delete succeed.

`outlets` is the only table any client role may delete from. This is a named
exception to the schema-wide rule that records are voided, deactivated or
corrected rather than removed — justified because an outlet nothing references
carries no history, and bounded to that table alone.

#### Scenario: The owner deletes an outlet nothing references

- **WHEN** a Super Admin deletes an outlet that no account, device, bill,
  stock item, expense or alert refers to
- **THEN** the outlet is removed and no longer appears on any surface

#### Scenario: A populated outlet cannot be deleted

- **WHEN** a Super Admin attempts to delete an outlet that anything still
  references
- **THEN** the database refuses the delete, and every referencing row is left
  exactly as it was

#### Scenario: No other role can delete an outlet

- **WHEN** a Franchise Admin, Biller or Employee session attempts to delete an
  outlet, including by a hand-crafted request naming its identifier
- **THEN** the database refuses the delete, and the action is offered nowhere
  in their app

#### Scenario: An emptied outlet becomes deletable on its own

- **WHEN** the last row referencing an outlet is removed or moved elsewhere
- **THEN** that outlet can be deleted, with nothing else to update first

### Requirement: An outlet is closed before it can be deleted, and the refusal says what is still attached

The delete action SHALL be offered only for an outlet that is already marked
closed. An active outlet SHALL NOT be deletable in a single step, so that the
reversible action always precedes the irreversible one.

Deletion SHALL be confirmed before it happens, and the confirmation SHALL state
what deletion does that closing does not — that the outlet is removed rather
than hidden, and that it cannot be undone.

When a delete is refused because the outlet is still referenced, the surface
SHALL name what is still attached and how much of it, rather than reporting a
database error or a constraint name. The set of things it looks for SHALL be
derived from the database's own foreign keys, so that a table added later is
included without anyone remembering to add it.

#### Scenario: An active outlet is not offered deletion

- **WHEN** a Super Admin views an outlet that is currently active
- **THEN** no delete action is available for it, and marking it closed is the
  step that reveals one

#### Scenario: Deletion is confirmed, and the confirmation distinguishes it from closing

- **WHEN** a Super Admin chooses to delete a closed outlet
- **THEN** a confirmation states that the outlet is removed rather than hidden
  and that this cannot be undone, and nothing is deleted until it is accepted

#### Scenario: A blocked delete names what is still attached

- **WHEN** a Super Admin attempts to delete a closed outlet that still has
  accounts and recorded attendance
- **THEN** the refusal names those things and their counts, in words rather
  than as a constraint name

#### Scenario: A table added later is included in the refusal

- **WHEN** a new table referencing outlets is added to the schema and an outlet
  carrying rows in it is deleted
- **THEN** the refusal accounts for that table without any change to the
  deletion surface

#### Scenario: A deactivated account still blocks deletion

- **WHEN** a Super Admin attempts to delete an outlet whose only remaining
  references are deactivated accounts
- **THEN** the delete is refused, because the rows still reference the outlet
