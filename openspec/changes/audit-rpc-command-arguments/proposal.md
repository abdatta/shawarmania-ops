# Proposal: Audit RPC Command Arguments

> **Kind**: data-access verification hardening, not a roadmap change · **Gate**: every current browser and Edge Function RPC call is checked against the database signature it names; a required fact is present after JSON serialization even when its value is unknown; every omission is backed by a database default; and each required-nullable command path is pinned at the real transport boundary.

## Why

A production attendance failure proved that an object which looks complete in
TypeScript can name a different request after JSON silently removes an
`undefined` property. The two reported attendance commands were fixed, but the
rest of the RPC surface has never been audited as one set, and the next live
change will add another command family.

## What Changes

- Inventory every browser-adapter and Edge Function RPC call and compare the
  arguments it actually serializes with the current database function signature.
- Correct any required argument that can still disappear; an unknown fact is
  sent explicitly as `null`, while an argument may be omitted only when the
  database signature deliberately supplies a default.
- Add or strengthen payload and real-transport coverage for every command path
  where a required value may legitimately be unknown.
- Make the same proof part of the repository's definition of complete for each
  new database command family, so mock and SQL-only coverage cannot stand in for
  what crosses HTTP.
- Resolve the behaviour-backlog investigation with recorded audit evidence,
  whether the audit finds another defect or confirms that the attendance fix was
  the only live instance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: require database-command verification to cover the
  serialized request shape, including required facts whose value is unknown.

## Impact

- Browser data-access adapters and privileged Edge Function RPC callers are the
  audited surface; only unsafe callers found by the audit are changed.
- Adapter payload tests and REST tests gain the missing empty/unknown cases.
- `docs/ARCHITECTURE.md` and `docs/TESTING.md` state the lasting rule and its
  verification boundary.
- No roadmap row, migration, policy, RLS, money arithmetic, offline behaviour,
  feature gate, or demo seam changes.

## Non-goals

- Adding database defaults to make forgotten required arguments appear valid.
- Treating intentional omission from a table update patch as a command defect.
- Building a syntax-only checker that guesses nullability or SQL defaults from
  TypeScript spelling.
- Redesigning command APIs or changing their authority, tenancy, idempotency, or
  user-visible outcomes beyond correcting an unsafe payload if one is found.

## Docs to update before archiving

- `docs/ARCHITECTURE.md` — identify the audited command boundary and keep the
  explicit-null rule current.
- `docs/TESTING.md` — require serialized-payload and real-transport evidence for
  required empty/unknown command paths.
