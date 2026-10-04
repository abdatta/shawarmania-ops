# Verification: bill-receipt-delivery

Verified locally on 3 October 2026 and released on 4 October 2026. Production
sending is enabled from 10:17:53 a.m. Asia/Kolkata.

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

## Production release evidence

The owner explicitly approved pushing both repositories, activation, MSG91
configuration and the real test SMS. The 12 earlier Ops commits were included;
the normal merge preserved both the remote #58 release IDs and later evidence.
Implementation `f1d107f8` and merge `493ea0bb` are pushed. Deploy run
`37177579707` passed every verification job, migration, all Edge Functions and
Pages publication. The live Ops entry bundle contains `493ea0bb` and answers 200.

Landing `c4e6092` passed Pages run `37177577578`. Live messaging, terms and privacy
each answer 200 with the approved copy, before Ops activation. Its release
evidence is recorded in `1ab29e4`. No Worker change or redeployment was required.

Production project `iefcidjbfnmsiqithqbj` has migration `20261004000000`, both
handlers, the three server secrets, the Vault endpoint/worker credential and
one active minute recovery job. Both unauthenticated handlers return 401.
The authenticated disabled worker returned 200 with zero processed; the
authenticated unknown report returned 200 with `accepted: false`.

The MSG91 `de16` webhook is enabled for On Report Received, POST JSON to the
report handler, with its distinct private header and only bill UUID, request ID
and status. No mobile or message body is included. Sending was enabled at
`2026-10-04T04:47:53.179311Z` (10:17:53 a.m. IST). History produced zero jobs.

One explicitly authorized test SMS used the shared production submission
contract and the existing Kalyani Cafe bill 199 receipt, with its actual zero
earned points and zero balance, addressed only to the owner's approved number.
It did not manufacture a sale or backfill a customer delivery. MSG91 accepted
request `366a646a7135507942345945` at 04:47:57Z and its filtered log reports
**Delivered** at 04:48:01Z, sender DEDTTL and the approved DLT template. The real
authenticated delivery callback reached the production report handler at
04:48:17.916Z and received 200. Since this manual connection test has no delivery
job, it is acknowledged without attaching it to a customer's history.

The SMS receipt URL, counter view and PDF all returned 200; the PDF is a real
`application/pdf` response. New-bill settlement, offline replay, competing claims
and terminal delivery persistence were proved against the real local backend.
No eligible new production bill existed at the release check, and no synthetic
production sale was added. The first genuine eligible sale will exercise that
same automatic path in production.
