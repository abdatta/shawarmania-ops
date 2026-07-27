# Project Scaffold — delta for `data-model-and-tenancy`

## ADDED Requirements

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
