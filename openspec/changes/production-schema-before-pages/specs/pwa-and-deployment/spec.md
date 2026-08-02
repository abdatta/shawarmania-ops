## MODIFIED Requirements

### Requirement: Push to main migrates then deploys, and only after verification passes

A push to `main` SHALL run the shared verification suite, apply pending forward
production migrations, and publish the static frontend only after both succeed.
The production migration job SHALL use an environment-scoped, project-specific
database credential and SHALL run migration push only. It SHALL NOT reset or
seed production, push local configuration, expose a service-role key, or
reverse migration history during a manual frontend rollback.

#### Scenario: Migration precedes publication

- **WHEN** a verified commit on `main` contains a pending migration
- **THEN** continuous integration applies it before Pages publishes that commit

#### Scenario: Migration failure blocks publication

- **WHEN** production migration cannot complete
- **THEN** the prior frontend remains published and a transactional migration
  leaves production unchanged

#### Scenario: Manual rollback preserves forward schema

- **WHEN** an earlier frontend commit is republished manually
- **THEN** production migration history remains at its current forward version
