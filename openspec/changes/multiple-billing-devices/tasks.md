## 1. Multi-device Enrollment Contract

- [ ] 1.1 Add active same-outlet device-label uniqueness and per-device health metadata while retaining the one-active-device index during migration and tests.
- [ ] 1.2 Expand enrollment, rename, inspect, and revoke contracts to target one explicit device and re-derive FA/SA authority for its immutable outlet.
- [ ] 1.3 Migrate the existing V1 device at each outlet in place without changing machine identity, credentials, pending local work, or historical attribution.
- [ ] 1.4 Remove the one-active-device-per-outlet constraint only after multi-device database, RLS, revocation, and concurrency tests pass.
- [ ] 1.5 Regenerate schema types and update typed demo/seed fixtures with two independently identified devices at one outlet.

## 2. Management, Ownership, And Recovery

- [ ] 2.1 Build typed FA/SA device collection adapters and management surfaces for labels, status, attribution, last contact, grant summary, and timestamped PII-free queue counts.
- [ ] 2.2 Keep daily grants device-specific and prove one operator's grants on two devices retain distinct device/grant attribution.
- [ ] 2.3 Enforce originating-device-only normal order edits, payment, and cancellation across multiple active same-outlet devices.
- [ ] 2.4 Extend audited FA/SA transfer to require an explicit active same-outlet target device, expected version, and reason.
- [ ] 2.5 Keep each Dexie queue local to its physical device and ensure recovery or quarantine on one device never controls another device's drain.

## 3. Concurrency And Accounting

- [ ] 3.1 Add database stress tests for simultaneous pay-now and order-payment commands, lost-response retries, UUID/hash conflicts, optimistic edits, and transactional per-outlet number allocation.
- [ ] 3.2 Add RLS tests proving every device remains limited to its own outlet, FA remains limited to assigned outlets, and SA cross-outlet management uses only designed surfaces.
- [ ] 3.3 Add revocation tests proving one device is blocked immediately at the server while another same-outlet device and every human assignment remain active.
- [ ] 3.4 Update device current-shift and authorized outlet-history views to reconcile several devices without double counting and without sorting chronology by bill number.
- [ ] 3.5 Extend settlement readiness and tests so every participating device must end its grant, resolve its own queue, and hold a current seal; one device cannot satisfy or hide another's blocker.
- [ ] 3.6 Carry the `counter-billing` correction from `openspec/todos/pipeline-rename-left-two-sentences-behind.md` into this change's delta: the composer's saved-order scenario says the order appears in Preparing, matching the pipeline requirement beside it, while the standalone page and manager tab keep their Open orders heading. If #34 did not take the `app-shell` half, take it here too, then close the todo.
- [ ] 3.7 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/LIMITATIONS.md` for multi-device operation.

## 4. Verification And Phase Gate

- [ ] 4.1 Run two independent browser/device contexts at one outlet through concurrent online payment, extended offline capture, interleaved reconnect, response loss, order-transfer conflict, and single-device revocation.
- [ ] 4.2 Verify official bill numbers are unique, sequential in server acceptance order, never reused, and independent of original order/payment timestamps and business dates.
- [ ] 4.3 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`, then inspect phone/tablet management and counter layouts in both themes.
- [ ] 4.4 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth` against the local backend.
- [ ] 4.5 PHASE GATE — Billing V2.2 multiple devices: two devices at one outlet bill concurrently online and offline with device-owned orders, exactly-once effects, unique sequential server numbers, isolated queues, audited transfer, independent revocation, and all-device settlement seals before sign-off; a hand-crafted request still cannot cross outlets.
