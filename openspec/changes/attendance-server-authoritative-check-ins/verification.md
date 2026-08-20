# Verification evidence

## Reproduction before the fix

Against the pre-change local database function, a synthetic employee command
with a valid assigned outlet and an `attempted_at` five minutes ahead of the
database clock failed with SQLSTATE `P0001` and `an attendance attempt cannot
be recorded for the future`. The focused pgTAP contract was added before the
migration and failed on that assertion for the same reason.

The complementary backward-clock case showed the old function accepted and
stored the submitted past instant, allowing the handset timestamp to determine
the canonical business date and late calculation. No production account,
position, or attendance payload was read or recorded for this reproduction.

## Implementation verification

The forward migration preserves the deployed eight-argument
`attendance_submit_attempt` RPC and its authenticated grant, but writes a
database `statement_timestamp()` and the business date that same instant maps to
at the target outlet. Its request fingerprint keeps the legacy date and time as
command identity only, so an exact retry remains idempotent across a cutover
without turning a device clock back into authority. The new
`attendance_current_context` function is security invoker and returns a shared
database time plus a date for each outlet already visible through RLS.

The typed adapter and demo adapter both expose that context. Employee surfaces
use it for first attempts, retry previews and current-day reads, refresh on
foreground and named stale/day-closed responses, and preserve the database
response as the rendered attendance row. Location is still requested only for a
check-in action.

## Automated gates

| Gate | Evidence |
|---|---|
| Focused adapter/component tests | 3 files, 39 tests passed |
| `npm run format` / `npm run format:check` | Passed |
| `npm run lint` | Passed; five pre-existing warnings and no errors |
| `npm run typecheck` | Passed |
| `npm test` | 112 files, 1,308 tests passed |
| `npm run contrast` | 50 light/dark token pairs passed AA |
| `npm run build` | Passed; existing chunk-size advisory only |
| `npm run test:e2e` | 244 browser tests passed at tablet and desktop widths |
| `npm run db:start` + `npm run db:reset` | Fresh migration reset passed, including `20260820000001_attendance_server_authoritative_check_ins.sql` |
| `npm run test:db` | 40 files, 1,796 pgTAP assertions passed |
| `npm run test:rls` | 9 realtime, 191 REST/RLS, and 4 billing-race tests passed |
| `npm run test:e2e:auth` | 21 real-backend browser tests passed |
| `npm run db:types` | Generated declarations refreshed from the reset database |
| `npx openspec validate attendance-server-authoritative-check-ins --strict` | Change is valid |
| `npm run roadmap:sync` | Roadmap already in sync; 0 rows updated |

The REST check deliberately sends a date and timestamp in 2099 through the
unchanged eight-argument PostgREST RPC. It succeeds, and the stored canonical
time/date are database-authored instead. RLS probes show an Employee and a
Franchise Admin see context only for Kalyani, a Super Admin sees both requested
outlets, and a Kanchrapara-only request from the Employee returns an empty set.

## Visual inspection

Edge inspection covered Employee Home and My attendance in light and dark at
390×844 and 1024×768. Both rendered without horizontal overflow or console
errors; the history shimmer settled into the same content geometry. The full
Playwright walkthrough separately covered all four demo role shells.

No verification gate was omitted.
