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

### Requirement: Test harness covers unit, component, and end-to-end layers

The project SHALL run a unit and component test runner and an end-to-end browser runner, both wired into the standard commands and into continuous integration. End-to-end tests SHALL run against a production build rather than a development server, so that behaviour which only exists in a real build is actually exercised.

#### Scenario: Unit tests run

- **WHEN** the test command is run
- **THEN** the unit and component suites execute and report results

#### Scenario: End-to-end tests run against a real build

- **WHEN** the end-to-end suite runs
- **THEN** it builds the app, serves the build, and exercises it

### Requirement: Continuous integration on every push and pull request

A CI workflow SHALL run install, lint, format check, typecheck, unit tests, the contrast validator, the production build, and the end-to-end suite on every push and pull request. A failure in any step SHALL fail the workflow.

#### Scenario: A failing check blocks the pipeline

- **WHEN** a commit that fails any of those steps is pushed
- **THEN** the CI workflow reports failure

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
