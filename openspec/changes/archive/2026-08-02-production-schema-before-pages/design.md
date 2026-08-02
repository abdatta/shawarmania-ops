## Decision

The deploy workflow owns release ordering: shared verification, forward
production migration, then Pages publication. The migration job uses a
project-scoped Postgres pooler URL from the protected `production-database`
environment and runs only `supabase db push`.

Manual frontend rollback skips database mutation because released migrations
are forward-only. Migrations must therefore remain compatible with the
currently published frontend during the short schema-first window.

Local verification ignores `.claude/worktrees`, which contains complete
tool-managed checkouts rather than source owned by the current checkout. This
keeps local lint and formatting equivalent to CI's clean checkout.

## Failure behavior

Any verification, credential, connection, migration or backfill failure blocks
Pages. Transactional migration failure rolls back the database; the old static
deployment remains live in either case.
