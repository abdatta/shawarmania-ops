## MODIFIED Requirements

### Requirement: Push to main migrates then deploys, and only after verification passes

A push to `main` SHALL run the shared verification suite, apply pending forward
production migrations, deploy every Edge Function in the repository, and publish
the static frontend only after all three succeed. The production migration job
SHALL use an environment-scoped, project-specific database credential and SHALL
run migration push only. It SHALL NOT reset or seed production, push local
configuration, expose a service-role key, or reverse migration history during a
manual frontend rollback.

Edge Function deployment SHALL run after the migration and before publication,
so that the schema a function calls exists before the function does, and the
function a bundle calls exists before that bundle is served. It SHALL use a
credential scoped to its own environment and distinct from the database
credential. It SHALL NOT delete functions absent from the repository, and SHALL
NOT run during a manual frontend rollback.

Failure of either the migration or the function deployment SHALL leave the
previously published frontend live.

#### Scenario: Migration precedes publication

- **WHEN** a verified commit on `main` contains a pending migration
- **THEN** continuous integration applies it before Pages publishes that commit

#### Scenario: Functions precede publication and follow the migration

- **WHEN** a verified commit on `main` is published
- **THEN** every Edge Function in the repository is deployed after the migration
  completes and before Pages publishes that commit

#### Scenario: Migration failure blocks publication

- **WHEN** production migration cannot complete
- **THEN** the prior frontend remains published and a transactional migration
  leaves production unchanged

#### Scenario: Function deployment failure blocks publication

- **WHEN** an Edge Function cannot be deployed
- **THEN** the prior frontend remains published, rather than a bundle being
  served that calls a function production does not have

#### Scenario: Manual rollback preserves forward schema

- **WHEN** an earlier frontend commit is republished manually
- **THEN** production migration history remains at its current forward version,
  and no Edge Function is redeployed from the earlier commit

## ADDED Requirements

### Requirement: Every Edge Function deploys without being named

The release SHALL deploy every Edge Function present in the repository, derived
from the repository itself rather than from a list maintained by hand in a
workflow, a script or a document. Adding a function SHALL require no edit to any
enumeration for that function to reach production.

The project a function is deployed to SHALL be derived from the same
configuration the published bundle is built against, so that functions cannot be
deployed to a project other than the one the published application calls. The
deployment SHALL fail rather than proceed when that configuration is absent or
malformed.

#### Scenario: A newly added function reaches production

- **WHEN** a change adds an Edge Function directory and names it nowhere else
- **THEN** the next release deploys it, and the bundle that calls it is
  published only after it exists

#### Scenario: A function is never deployed to another project

- **WHEN** the configuration naming the project is absent or does not carry a
  resolvable project reference
- **THEN** the release fails without deploying any function, rather than
  deploying to a default project

#### Scenario: A function absent from the repository is left alone

- **WHEN** a function exists in the project and not in the repository
- **THEN** the release leaves it in place rather than deleting it

### Requirement: An Edge Function declares its gateway authentication

Every Edge Function in the repository SHALL carry an explicit gateway
authentication declaration in the committed Supabase configuration. Verification
SHALL fail when a function has none, because an undeclared function silently
receives the authenticating default, and a function written to serve a caller
who holds no token would then be refused at the gateway before it runs, while
appearing healthy.

#### Scenario: A function added without a configuration block fails verification

- **WHEN** an Edge Function directory exists with no matching configuration
  block
- **THEN** verification fails and names the function, on both the pull-request
  and the deployment path

#### Scenario: A token-free function is proved open after deployment

- **WHEN** a function declared to require no token is deployed
- **THEN** an unauthenticated request carrying an invalid payload is answered by
  the function's own refusal rather than by the gateway's authentication refusal
