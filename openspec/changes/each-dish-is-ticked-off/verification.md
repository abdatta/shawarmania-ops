# Verification — each-dish-is-ticked-off (#74)

Verified locally on 12 October 2026 against the migrated, seeded Supabase stack
and production-built browser previews owned by this test run.

## Resulting contract

The approved demo workspace now runs through the live adapters. Counter handover
captures each dish independently; Prepared follows the dishes. Kitchens capture
Ready food in append-only receipts, Undo preserves handover, and later food arrives
as a separate ticket. Labels leave with the active order and notes never enter
bills. Older queued billing envelopes remain accepted without rewriting hashes.

Both record tables enforce outlet RLS and refuse all direct client writes. REST
probes first prove their fixtures exist, then test foreign-outlet counter, kitchen
and manager reads and a foreign-order Ready request. Kitchen reads omit customer,
label and money; counter marks omit dish-to-kitchen mappings and operator history.

## Automated evidence

| Command | Observed result |
| --- | --- |
| `npm run format`, then `npm run format:check` | Pass |
| `npm run lint` | Pass; 0 errors, 20 existing warnings |
| `npm run typecheck` | Pass |
| `npm run functions:typecheck` | Pass |
| `npm test -- --maxWorkers=4` | 197 files, 2,462 tests passed |
| `npm run contrast` | 88 pairs passed across light and dark |
| `npm run test:e2e -- --workers=2` | 342 tests passed |
| Fresh `npm run db:reset`, then `npm run test:e2e:auth` | 40 tests passed, including the final kitchen alert refinement |
| `npm run build` (both browser suites' preview startup) | Pass |
| `npm run db:start`, fresh `npm run db:reset`, `npm run test:db` | 86 files, 3,544 assertions passed |
| `npm run test:rls` with local `VITEST_MAX_WORKERS=1` | All seven phases passed: 298 tests |
| `npm run db:types`, then `git diff --exit-code src/data-access/database.types.ts` | Generated schema matches the staged file |

The REST worker limit avoids the Windows Supabase CLI telemetry-file collision;
the checked-in CI worker configuration is unchanged. Database policy tests ran
before the REST probes that leave immutable history. Auth browser reruns use a
fresh reset to avoid earlier settled-bill fixtures.

## Workflow and visual evidence

The live counter/kitchen test exercises a labelled, noted order, Ready cues, a
second ticket, reduction of already-Ready food without restarting the cooking
alert, ACK, Undo, payment while cooking, offline dish ticks and reconnection.
It checks database preparation, label removal, exactly one bill and disappearance
from the kitchen, with no page errors or HTTP 5xx responses. The adapter test also
reopens offline with notes, labels and ticks intact, then durably queues an untick.

Live captures were inspected at 1080 × 810 and 390 × 844 in both themes, including
the phone's panned rail and linked records. The counter keeps the approved two
columns, temporary label, note and silent Ready cue; the kitchen shows narrow food
cards and Done receipts. Demo tests cover cross-tab readiness and the retained
320 ms exit slot plus 180 ms hidden gap before masonry repacks.

The kitchen alert regression was proved red before its fix (1 failed, 5 passed),
then green afterwards (6 passed): unchanged or reduced owed food stays silent,
while increased food and changed instructions still ring.

## Scope

The owner's demo approval remains recorded in design D10 and `handoff.md`.
Counter billing and kitchen tablets already have live gates; this change wires
their approved dish workflow into those surfaces and preserves the demo seam.
Archiving and main-spec synchronization remain a separate requested operation.
