## Why

The static frontend deployed while production was still missing its attendance
migration. CI proved the migration against a temporary local database but did
not apply or gate on production migration history, so the new adapter reached a
legacy schema and existing pending attendance stopped loading.

## What Changes

- Apply forward production migrations in the deploy workflow after the shared
  verification gate and before Pages publication.
- Scope the credential to a `production-database` environment secret containing
  a project-specific pooler URL; never expose a service-role key.
- Keep manual frontend rollback forward-only by leaving released database
  migration history untouched.
- Make failure fail closed: the currently published frontend remains live when
  migration cannot complete.
- Keep local verification scoped to the checkout by excluding tool-managed
  nested worktrees from lint and formatting scans.

## Capabilities

### Modified Capabilities

- `pwa-and-deployment`: Production migration becomes a required publication
  dependency.

## Durable documentation

- `docs/OPERATIONS.md`
- `docs/TESTING.md`
- `AGENTS.md`
