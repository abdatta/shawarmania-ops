## 1. Device and grant schema

- [ ] 1.1 Add/migrate machine-only counter devices, daily billing grants/shifts, immediate revocation helpers, and the one-active-device-per-outlet constraint.
- [ ] 1.2 Add privileged enrollment, billing-grant, revocation, heartbeat, and upload-only recovery functions that re-derive caller authority.
- [ ] 1.3 Remove synthetic device profiles/assignments from seed, generate database types, and prove migration behavior when an outlet already has device rows.
- [ ] 1.4 Extend catalog-driven DB/RLS tests for every new outlet/child-scoped table, cross-outlet enrollment, concurrent enrollment, revoked requests, and recovery-only writes.

## 2. Role hierarchy and session boundary

- [ ] 2.1 Make Biller assignments satisfy Employee attendance/surface capabilities without creating a second assignment or widening FA/SA attendance.
- [ ] 2.2 Add machine-first real-session resolution that requires no profile and never treats a machine principal as a person.
- [ ] 2.3 Implement isolated non-persisting credential verification and daily grant opening for Biller/own-FA/SA, with no retained human tokens or identifiers.
- [ ] 2.4 Expire grants at cutover, preserve historical attribution, and require online reauthentication without revoking device registration.
- [ ] 2.5 Add unit and real-backend auth tests proving an FA/SA counter login cannot call personal/admin adapters and an ordinary Employee cannot open a grant.

## 3. Enrollment and device surfaces

- [ ] 3.1 Implement enrollment handoff so success replaces the admin session with the machine session and failure leaves no active partial device.
- [ ] 3.2 Build the billing-only Counter shell entry/sign-out states and keep personal navigation unreachable for every eligible operator.
- [ ] 3.3 Build FA/SA Devices management with outlet scoping, last-seen time, last-reported pending count, revocation, and clearly stale telemetry.
- [ ] 3.4 Add the physical-device recovery entry that authenticates an FA/SA without restoring ordinary access or registration.

## 4. Durable local operation store

- [ ] 4.1 Add Dexie and a versioned device-scoped schema for immutable envelopes, canonical hashes, lifecycle states, and migrations.
- [ ] 4.2 Implement atomic local acknowledgement that leaves forms intact on IndexedDB/quota failure and survives logout, reload, restart, and cutoff.
- [ ] 4.3 Implement Web Locks leadership with an IndexedDB lease fallback and response-driven retry state without treating `navigator.onLine` as truth.
- [ ] 4.4 Implement pending/blocked/quarantined telemetry without logging payloads or customer phone numbers.
- [ ] 4.5 Add unit/browser tests for two tabs, process restart, schema upgrade, local failure, grant handover, cutover, and revoked-device recovery state.

## 5. Documentation and verification

- [ ] 5.1 Update `docs/ARCHITECTURE.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/OPERATIONS.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/LIMITATIONS.md`.
- [ ] 5.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [ ] 5.3 Run `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth`.
- [ ] 5.4 Inspect enrollment, cutoff sign-out, Devices, and recovery on phone/tablet viewports in light and dark themes.
- [ ] 5.5 PHASE GATE: each outlet has exactly one enrolled tablet; it reaches only its billing context, revocation is immediate, normal credentials leave no personal session, and locally accepted synthetic operations survive logout/restart without duplication or silent loss.
