# Verification: bill-receipt-delivery

Verified locally on 3 October 2026. Sending remains disabled pending the release.

| Gate | Evidence |
|---|---|
| Lint | Pass, no errors; 15 existing warnings |
| Format | Formatter run before gates; final `npm run format:check` passes |
| App types | `npm run typecheck` passes |
| Edge types | `npm run functions:typecheck` compiles both new handlers against generated schema |
| Unit/component | `npm test`: 165 files, 2,177 tests pass; adapter fixture rerun: 41 pass |
| Contrast | 64 pairs pass AA in both themes |
| Build | `npm run build` passes |
| Demo browser | `npm run test:e2e`: 284 pass, including no-real-data tripwire and offline paths |
| Database | Fresh reset; `npm run test:db`: 75 files, 2,973 assertions pass |
| HTTP/RLS | `npm run test:rls`: all six phases pass, 282 tests |
| Real-account browser | `npm run test:e2e:auth`: 34 pass, including real offline tablet settlement and both-theme manager views |
| Schema | Types regenerated from reset schema; expected additive delivery types only |
| Visual | Own preview on 7413: failed receipt with WhatsApp fallback in Customer details at 390×844 and 1024×768, light and dark; closed detail and list shimmer remain the same shape |
| Landing | Own preview on 7433: messaging, terms, privacy and links inspected; build, weight and no-secret checks pass |

## Receipt-specific proofs

- The real durable IndexedDB queue accepts a bill offline without a network call.
  Reconnection commits it through the real billing RPC; a deliberately lost
  response retries as a replay and drains the queue. Exactly one delivery job
  exists. Two concurrent service claims produce one job and one stubbed provider
  submission. The actual PostgREST embed is an array and the adapter maps it.
- Database checks freeze points after the bill ledger writes, retain existing
  balance on zero earn, exclude numberless/disabled/pre-activation bills, refuse
  other-outlet reads and browser claims/configuration/reports, skip revoked links,
  protect callback-before-response and never retry unknown or abandoned claims.
- Provider contract checks distinguish submission from delivery, serialize only
  approved variables and tracking UUIDs, reject demo URLs/invalid points, discard
  raw provider errors, authenticate distinct credentials and never retry a lost
  provider response. No real phone, key or message payload is logged or committed.

- Actual local Edge HTTP calls return 401 without the correct credential, 405
  for a worker GET, `{processed: 0}` for the authenticated disabled worker, and
  `{accepted: false}` with HTTP 200 for an authenticated unknown report.
  A real local submitted job becomes delivered through the report Edge Function;
  a later failed callback is acknowledged and cannot downgrade it.

## Issues found and corrected

The schema coverage audit needed the private settings table classified as
service-only. The HTTP fixture initially assumed a to-one delivery embed;
PostgREST returns an array for the composite foreign key, so both HTTP and adapter
fixtures now use that actual shape. The mapper already accepts both shapes.
Exact optional-property typing required omitted RPC arguments instead of explicit
`undefined`. The relevant checks were repeated after each correction.

## Release evidence pending

Matching public pages, migration, deployed functions, server secrets, MSG91 final
reports, activation cutoff, the one authorized handset SMS and its receipt/PDF
remain to be verified. Provider acceptance alone will not be called delivery.
No synthetic sale will be written to production to obtain a test receipt.

The release check found 12 earlier local Ops commits (mostly documentation, plus
the reopened-counter drain fix and verification improvements), and one remote
receipt-release documentation commit. A normal merge requires reconciling only
`the-receipt-says-its-yours/tasks.md`; preserve the remote release IDs and the
local later verification evidence. The full local suites above include all 12
earlier commits. Landing is otherwise fully pushed at `42b07a0`.
