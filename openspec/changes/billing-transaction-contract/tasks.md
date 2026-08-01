## 1. Preflight And Schema

- [ ] 1.1 Inspect production and seed counts for bills, bill items, and customers; abort the migration with non-PII diagnostics if unexpected real money history exists.
- [ ] 1.2 Add outlet-scoped orders, order items, order events, billing command receipts, and device-day seals with UUID keys, explicit business dates, integer-paise totals, device/grant attribution, optimistic versions, and required foreign keys.
- [ ] 1.3 Extend bills with order and payment clocks, payment business date, optional source-order linkage, payment operator/device attribution, and late/recovery flags without weakening immutable paid-history constraints.
- [ ] 1.4 Add database constraints and triggers for order state transitions, aggregate line arithmetic, captured item snapshots, version increments, and immutable paid/cancelled states.
- [ ] 1.5 Preserve the transactional per-outlet bill-number allocator so only successful paid-bill creation consumes an official number.
- [ ] 1.6 Regenerate Supabase schema types and update typed seeds/fixtures for the new order and billing command contract.

## 2. Atomic Billing Commands

- [ ] 2.1 Implement canonical command-envelope hashing, schema-version validation, UUID claiming, exact replay responses, and changed-payload idempotency conflicts.
- [ ] 2.2 Implement atomic create, revise, and cancel order commands with originating-device ownership, expected-version checks, actor attribution, and order events.
- [ ] 2.3 Implement atomic pay-now and pay-order commands that validate all lines/totals, allocate one bill number, persist final snapshots, and commit the receipt and result together.
- [ ] 2.4 Implement attributed bill void and corrected-replacement linkage while preventing in-place mutation of settled bill facts.
- [ ] 2.5 Implement FA/SA recovery transfer and recovery cancellation for open orders whose source device is revoked, requiring same-outlet replacement context and a reason.
- [ ] 2.6 Enforce historical grant bounds, pre-revocation creation, future-clock tolerances, and explicit late/recovery result flags for delayed commands.
- [ ] 2.7 Revoke direct client insert/update/delete privileges on orders, order items, bills, and bill items so all money mutations use the transactional command surface.
- [ ] 2.8 Implement online end-grant/device-day sealing, command-watermark invalidation, and the locked server readiness check over open orders, live grants, and every participating device.

## 3. Tenancy, Authority, And Concurrency Tests

- [ ] 3.1 Add RLS policies for every new outlet-scoped table and prove Biller/FA sessions cannot read or mutate another outlet while SA cross-outlet access remains limited to designed surfaces.
- [ ] 3.2 Add database tests for eligible operator authority, same-device ownership, expected-version conflicts, revoked-device recovery, and ordinary Employee denial.
- [ ] 3.3 Add concurrent command tests proving exact retries return one result, changed UUID payloads fail, competing order revisions do not merge, and successful payments allocate one non-reused bill number.
- [ ] 3.4 Add database tests for atomic parent/line failure, integer-paise aggregate arithmetic, historical snapshots, and direct-DML denial.
- [ ] 3.5 Add accounting-date tests proving deferred revenue remains on the order business date while cash and payment method totals use the payment business date, including payment after cutoff.
- [ ] 3.6 Add database tests proving open orders, live grants, unresolved device queues, missing/stale seals, and commands accepted after sealing block settlement readiness even through hand-crafted requests.

## 4. Typed Adapter Contract And Documentation

- [ ] 4.1 Add typed adapter/domain command and result shapes for order lifecycle, payment, void/replacement, conflicts, late acceptance, and recovery without promoting any feature gate.
- [ ] 4.2 Update `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, and `docs/BUSINESS_CONTEXT.md` with orders, atomic payment conversion, dual accounting clocks, and immutable bills.
- [ ] 4.3 Update `docs/OFFLINE_AND_SYNC.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/LIMITATIONS.md` with command receipts, historical grants, recovery authority, and the launch exclusions.

## 5. Verification And Phase Gate

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [ ] 5.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth` against the local backend.
- [ ] 5.3 PHASE GATE — Billing transaction contract: demonstrate direct pay and deferred pay producing the same immutable bill shape, exact retry without duplication, rejected changed-payload reuse, optimistic edit conflict, same-device enforcement, audited recovery, distinct revenue/payment business dates, and database-enforced settlement blockers before `ui-billing-lifecycle` begins.
