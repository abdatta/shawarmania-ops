## 1. Database contract and migration

- [x] 1.1 Add `day_finished`, immutable post-departure metadata on command receipts and bills, and an append-only attribution-review table with paired-field constraints, indexes, grants and outlet-scoped RLS.
- [x] 1.2 Replace historical device-context validation so only the gap after an `operator` end and before expiry/next shift is accepted; preserve strict removal, cutoff, overlap and day-finished refusal.
- [x] 1.3 Propagate accepted command metadata to bills, include flagged bills in unchanged money readers, and expose an authorised review RPC without rewriting original attribution.
- [x] 1.4 Add pgTAP and REST tests for timestamp boundaries, exact replay, financial inclusion, review outcomes, role/tenancy refusal and post-Finish-Day correction refusal; regenerate database types.

## 2. Typed adapters and durable runtime

- [x] 2.1 Add typed Finish Day readiness, bill attribution exception/review fields, and review actions to the adapter seam and both live/demo implementations.
- [x] 2.2 Move the live outbox subscription, drain leader and telemetry lifetime to enrolled-device scope so they remain active on the shift-request screen without enabling new work.
- [x] 2.3 Classify pending/retrying, needs-attention, open-order, server-unavailable and recent-edit states after an automatic drain; remove the five-minute hard refusal while preserving every genuine blocker.
- [x] 2.4 Add unit tests for no-shift background drain, exact replay, readiness classification, mock parity and no reassignment when a later shift opens.

## 3. Phone, tablet and manager UI

- [x] 3.1 Rename End my shift to Leave counter and add confirmation copy that recommends Hand over for ordinary replacement and explains immediate authority plus flagged offline work.
- [x] 3.2 Build the Finish Day readiness sheet with checking, blocker resolution, Review recent payments, Finish day now, Keep billing and retry states; keep layout/shimmer parity in light and dark.
- [x] 3.3 Label flagged bills and append-only review outcomes/actions in manager/owner billing history while keeping them out of incoming My Shift and giving Priya no alert.
- [x] 3.4 Add component and browser coverage for phone confirmation, Finish Day paths, manager review, silent incoming shift and accessible phone/tablet layouts.

## 4. Documentation and verification

- [x] 4.1 Update `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md` before archive.
- [x] 4.2 Run focused tests, then `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`; fix and repeat until green.
- [x] 4.3 Run a fresh local database through `npm run db:start`, `npm run db:reset`, `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`, `npm run db:types`, and the generated-type diff check.
- [x] 4.4 Exercise the real offline path: queue work before remote leave, queue a sale after leave while disconnected, reconnect, prove both settle exactly once under Rahul with only the latter flagged, open Priya's shift, prove her new sale is hers and no alert appears.
- [x] 4.5 Inspect phone and tablet viewports in light and dark, including checking, every blocker, advisory recent-payment, after-departure review and no-shift drain states; inspect console and requests.
- [x] 4.6 PHASE GATE — the proposal Gate is proved literally, `npm run roadmap:sync` reports the active change, and every unrun external/hardware check is named rather than implied.
