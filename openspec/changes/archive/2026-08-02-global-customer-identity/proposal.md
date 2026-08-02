# Proposal: Global Customer Identity

> **Model**: Opus · **Wave**: D · **Depends on**: #2, #22 · **Gate**: one normalized phone identifies one business-wide customer; outlet roles can retrieve it only with the complete phone, cannot enumerate the directory or read another outlet's bills, and the boundary is proved by database tests.

## Why

Billing should recognize a returning customer at either Shawarmania outlet
without creating conflicting outlet-local identities. This promotes the formerly
parked todo now that lookup, visibility, and update semantics are settled.

## What Changes

- **BREAKING**: Replace outlet-owned customer identity with one business-wide
  profile keyed by a globally unique normalized phone number.
- Permit only exact complete-phone lookup for eligible billing contexts; expose
  no browse, prefix search, aggregates, or other outlets' bills.
- Automatically create a customer profile when a new complete phone is saved.
- Return saved details for prompted form autofill without letting billing update
  an existing profile.
- Reserve global profile management for Super Admin while shipping no editing UI.
- Migrate synthetic/outlet-local rows deterministically and refuse ambiguous
  real-data merges rather than guessing.

## Capabilities

### New Capabilities

- `global-customer-identity`: Phone normalization, exact-match access,
  creation, non-enumeration, and separation from outlet transaction history.

### Modified Capabilities

- `outlet-tenancy`: Customer identity becomes a narrow business-wide resource
  while bills and customer transaction history remain outlet-isolated.

## Impact

Customer schema and foreign keys, generated types, lookup/create RPCs, grants,
adapter, seeds, migration checks, and tenancy tests change. This is not a general
cross-outlet read path.

## Non-goals

- Loyalty, marketing, visit/spend aggregates, exports, or digital receipts.
- Directory browsing by outlet roles or access to another outlet's transactions.
- Updating an existing profile from billing.
- Supporting several customers under one phone at launch.

## Docs to update before archive

`docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/SCREENS.md`, and `docs/LIMITATIONS.md`.
