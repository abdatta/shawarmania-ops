# Project Scaffold

## Purpose

Guarantees that the repository stays buildable, testable and structurally honest as it grows. A fresh clone works with no undocumented setup; the architectural boundaries that carry the security and delivery model are enforced by tooling rather than by review; and every check that matters runs on every push, so a violation fails in the pipeline rather than in production.

## Requirements

### Requirement: Toolchain is green from a fresh clone

From a fresh clone with only Node.js and npm installed, dependency installation, tests, lint, typecheck and the production build SHALL all succeed with no additional setup.

#### Scenario: Fresh clone passes every script

- **WHEN** the repository is cloned and the install, test, lint, typecheck and build commands are run in order
- **THEN** every command exits zero

#### Scenario: Planning tooling is unaffected

- **WHEN** the roadmap reconciler is run
- **THEN** it reconciles the roadmap exactly as before, with no change to its behaviour

### Requirement: Layer boundaries are enforced by tooling

The source tree SHALL be organised into the layers named in the architecture — routes, features, data access, domain, and outbox — and lint SHALL enforce that only the data-access layer imports the database client and that the domain layer imports from no other layer.

#### Scenario: A screen reaching for the database fails lint

- **WHEN** a file outside the data-access layer imports the database client and lint runs
- **THEN** lint exits non-zero, naming the restricted import and what to depend on instead

#### Scenario: Impure domain code fails lint

- **WHEN** a file in the domain layer imports a module from another layer and lint runs
- **THEN** lint exits non-zero

### Requirement: The behaviour backlog's index lists every note in it

Lint SHALL compare the notes in `openspec/todos/` against the links in
`openspec/todos/README.md` and SHALL exit non-zero, naming each file, when either
has drifted from the other: a note no link mentions, or a link to a note that no
longer exists.

That index is the page the backlog is read from. The note files hold the detail,
but the index holds each item's Type, Status, Area and the trigger that has to
fire before it is worth promoting, so a note the index does not mention is not
deferred work but lost work — nothing about the repository looks broken while it
goes unread. The second direction matters as much as the first, because a
dangling row is what a promoted item leaves behind when its file is removed and
its row is not moved to the graduated table.

The index remains authored rather than generated. The trigger column is a
judgement no tool can derive, so the check verifies coverage only and SHALL NOT
write, reorder or reword rows.

#### Scenario: A note added without its row fails lint

- **WHEN** a note is added to `openspec/todos/` and no link in the index mentions
  it, and lint runs
- **THEN** lint exits non-zero, naming the file and where the row belongs

#### Scenario: A promoted note whose row was left behind fails lint

- **WHEN** an index row links to a note that no longer exists, and lint runs
- **THEN** lint exits non-zero, naming the file

#### Scenario: An index in sync passes

- **WHEN** every note is mentioned by the index and every link resolves, and lint
  runs
- **THEN** the check passes, including for a note reached only from the graduated
  table

### Requirement: Test harness covers unit, component, and end-to-end layers

The project SHALL run a unit and component test runner and an end-to-end browser runner, both wired into the standard commands and into continuous integration. End-to-end tests SHALL run against a production build rather than a development server, so that behaviour which only exists in a real build is actually exercised.

#### Scenario: Unit tests run

- **WHEN** the test command is run
- **THEN** the unit and component suites execute and report results

#### Scenario: End-to-end tests run against a real build

- **WHEN** the end-to-end suite runs
- **THEN** it builds the app, serves the build, and exercises it

### Requirement: Continuous integration on every push and pull request

A CI workflow SHALL run install, lint, format check, typecheck, unit tests, the
contrast validator, the production build, and the end-to-end suite on every push
and pull request **that can change what is built, served or migrated**. A failure
in any step SHALL fail the workflow.

A push or pull request confined to prose — the documentation tree, the change,
spec and backlog directories, and root-level markdown — SHALL instead run a
documentation tier that gates formatting and the behaviour backlog's index, and
SHALL publish nothing, there being nothing in such a commit to publish.
Executable files under those directories are not prose and SHALL take the full
suite.

The two filters SHALL be complements **for every event either tier runs on**:
every commit SHALL match at least one tier on both a pull request and a push to
the default branch, so that no commit can reach the default branch with no checks
at all. Coverage is a property of event and path together; a tier covering only
one event leaves the other unguarded. The publication gate SHALL NOT be weakened
by this split — a commit that runs the full suite publishes only if the full suite
passes, exactly as before.

#### Scenario: A failing check blocks the pipeline

- **WHEN** a commit that fails any of those steps is pushed
- **THEN** the CI workflow reports failure

#### Scenario: A commit that cannot change the app skips the suite

- **WHEN** a push or pull request touches only the documentation tree, the
  change, spec and backlog directories, or root-level markdown
- **THEN** the full suite does not run, the documentation tier runs the format
  check and the backlog index check, and nothing is published

#### Scenario: A tool living beside prose still takes the full suite

- **WHEN** a push changes an executable file under the change-management tree,
  such as the roadmap reconciler
- **THEN** the full suite runs

#### Scenario: A mixed commit takes the full suite

- **WHEN** a push changes both prose and application code
- **THEN** the full suite runs and gates the publish

#### Scenario: No commit goes unchecked

- **WHEN** any commit is pushed to the default branch, or raised as a pull request
- **THEN** it matches the full suite, the documentation tier, or both, and never
  neither

#### Scenario: A prose commit pushed straight to the default branch is still checked

- **WHEN** a commit confined to prose is pushed directly to the default branch
  rather than through a pull request
- **THEN** the documentation tier runs, and the commit is not left unchecked
  because the full suite declined it

### Requirement: Client configuration carries only public values

The repository SHALL document exactly the public client environment variables and SHALL NOT contain a service-role key or equivalent privileged credential in any committed file, example file, or client configuration. Local environment files SHALL be ignored by version control.

#### Scenario: Environment template documents only the public pair

- **WHEN** a developer inspects the environment example file
- **THEN** it lists only the public project URL and anonymous key, with explanatory comments, and contains no privileged credential

#### Scenario: Local environment files are not committed

- **WHEN** a local environment file exists in the working tree
- **THEN** version control ignores it

### Requirement: Local backend development is reproducible

The repository SHALL contain committed configuration sufficient to bring up the local backend stack, so that a developer does not have to reconstruct it from documentation.

#### Scenario: Local stack starts from committed config

- **WHEN** a developer starts the local backend stack in a fresh clone
- **THEN** it comes up using the committed configuration

### Requirement: Generated database types are committed and current

TypeScript types generated from the database schema SHALL be committed to the
repository and wired into the database client, so that fixtures and adapters
compile against what the database can actually serve. A pipeline check SHALL
regenerate the types from the migrations and fail if the committed types
differ.

#### Scenario: Schema change without regenerated types

- **WHEN** a migration changes the schema and the committed types are not regenerated
- **THEN** the pipeline check fails, showing the drift

#### Scenario: The database client is typed

- **WHEN** application code calls the database client with a table or column that does not exist in the schema
- **THEN** the typecheck fails

### Requirement: The database suite runs in continuous integration

Continuous integration SHALL bring up a fresh local database stack, apply all
migrations and seeds, and run the database policy suite and the REST-level
isolation probes on every push and pull request. A failure in any of these
SHALL fail the workflow.

#### Scenario: A policy regression is pushed

- **WHEN** a commit that weakens or omits a Row-Level Security policy is pushed
- **THEN** the database job fails the workflow
