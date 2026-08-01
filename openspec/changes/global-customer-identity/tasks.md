## 1. Migration preflight and global schema

- [ ] 1.1 Add a read-only migration preflight for customer row count, invalid phones, equivalent duplicates, and conflicting duplicates without printing PII.
- [ ] 1.2 Add canonical Indian-phone normalization and tests for accepted presentation variants and invalid/incomplete input.
- [ ] 1.3 Migrate equivalent duplicates and foreign keys deterministically, abort conflicts, remove outlet/aggregate columns, and enforce one non-null globally unique canonical phone.
- [ ] 1.4 Rewrite synthetic seeds and regenerate database types.

## 2. Narrow access paths

- [ ] 2.1 Revoke direct customer-table access from outlet roles and machine sessions and add exact complete-phone lookup with minimal response fields.
- [ ] 2.2 Add per-device/caller lookup rate bounds whose telemetry contains no raw/reversible phone PII.
- [ ] 2.3 Add concurrency-safe create-or-get behavior that creates new phones automatically and never updates an existing profile from billing.
- [ ] 2.4 Add the separate SA management read boundary without adding a profile-editing UI.

## 3. Tenancy and adapter contract

- [ ] 3.1 Classify customers explicitly as global in the catalog-driven isolation suite and keep every customer-linked transaction outlet/child-scoped.
- [ ] 3.2 Prove by hand-crafted DB/RLS requests that FA/Biller/device cannot list, prefix-search, direct-select, or use a known customer ID to read another outlet's transactions.
- [ ] 3.3 Add typed lookup/create adapter methods with phone validation and no Supabase import from screens.
- [ ] 3.4 Test concurrent first creation, existing-name conflict, exact lookup, rate refusal, SA access, and no cross-outlet bill leakage.

## 4. Documentation and verification

- [ ] 4.1 Update `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/SCREENS.md`, and `docs/LIMITATIONS.md`, including the franchise shared-directory disclosure before #14.
- [ ] 4.2 Update the data-retention interaction without prematurely promoting the general retention change.
- [ ] 4.3 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [ ] 4.4 Run `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls`, and the relevant real-auth E2E path.
- [ ] 4.5 PHASE GATE: one normalized phone identifies one global customer; billing can retrieve it only by complete exact phone; outlet roles cannot enumerate customers or read another outlet's transactions.
