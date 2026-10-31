# Proposal: retire-fewer-requests

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-30 when
> `the-app-asks-the-server-less` was archived, on the owner's word that 35% fewer
> requests per order is the success test.

## Why

The `fewer-requests` gate (code `FR`, `retireBy` 2027-01-31) has done its job.
It was turned on in production at 07:11 UTC on 16 October 2026 and has stayed
on: `change_gate_events` holds that one turn and nothing since, read on 30
October. On 22 October the app made about 370 gateway requests per order
against about 560 before, with no failures. **It was never pulled**: on 30
October the owner waived the pull and the full log cycle's reading, because the
on path had run two weeks and its round trip is `none:` (it changes when the app
reads, never what it writes). Its off path is now dead code with a switch on it,
and every live gate doubles what the browser suites must run.

Nothing depends on it, in the code or in `change_gate_dependencies`, and no
database function, policy, trigger or view reads the key.

## What changes

- **Code.** Every toggle point keeps its on branch: the kitchen reads its
  categories only when its filter changes; the counter listens on the
  table-naming channel, telling a menu edit from a sale and merging bursts; the
  expense list's suggestions come from `names()`; a shared count re-reads on the
  foreground only when stale; a running sync is checked every three seconds; and
  a tablet's minute gate answers ride on its health report whenever Tablet health
  is on.
- **The off path's code goes**: the counter adapter's `subscribeToOutletBilling`
  (live and demo), the change-gates adapter's v1 `reportHealth` (live and demo),
  and `useDeviceHealthReport`'s `carriesGates` switch. The kitchen's per-board
  category effect and the 0.7-second sync check go with their branches.
- **The key** moves to `RETIRED_CHANGE_GATES`, and out of the demo's gate words.
- **Tests.** The `describeChangeGate('fewer-requests', …)` blocks become plain
  tests of the on behaviour, and their off cases go;
  `billing-counter-fewer-requests.test.tsx` becomes
  `billing-counter-notices.test.tsx`. The counter tests that nudged the plain
  channel nudge the table-naming one. The signed-in
  `e2e-auth/fewer-requests.spec.ts` keeps its budget and its by-path assertions,
  retagged `@cg-on:tablet-health`: its gate answers ride on the health report
  only while Tablet health is on, so with every gate off a tablet reads them
  itself, as it should.
- **Spec and docs.** `project-scaffold`'s three requirements lose their gate
  conditions; *The request budget holds lower with the gate on* is renamed. `docs/`
  (ARCHITECTURE, RELEASES, TESTING) stops calling the behaviour gated.
- **Database: nothing now.** The gate's row stays on, so a tablet on an older
  build keeps the on path. After three services on the retirement build, a
  contract migration (`-- release: contract fewer-requests`) sets the row's
  `retired_at`. What the off path leaves is small: `report_device_health` (v1),
  which old builds called directly. It cannot be dropped, because
  `report_device_health_v2` calls it to write the row; the contract migration may
  revoke `authenticated`'s execute on it, so only v2 reaches it.

## Change gate

No gate: a retirement keeps the behaviour already on.
