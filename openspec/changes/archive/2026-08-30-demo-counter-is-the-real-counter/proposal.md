# Proposal: The Demo Counter Is The Real Counter

> **Model**: Claude Opus 5 · **Wave**: none · **Depends on**: #50 · **Gate**: `/demo/biller` mounts the same `CounterShell` the enrolled tablet mounts, so Finish Day, its readiness sheet, Hand over, the shift-request screen and the no-shift resting state are all walkable in demo; one shift is one fact across the counter, the Tablets surface, every phone's live-shift card and billing attribution; and a manager can walk the after-departure attribution review over a bill that is already in the day's takings.

## Why

The demo biller is not a demonstration of the counter. It is a second,
independent implementation of one, and it has drifted far enough that the
walkthrough now teaches things production does not do and the docs describe a
screen nobody can reach.

There are two real biller experiences. The **enrolled tablet** at `/counter`
mounts `src/features/counter/counter-shell.tsx` through `CounterRoot`: no
navigation, no account menu, no sign-out, one page carrying the device label,
the sync indicator, Hand over, Finish day, and two stacked panels — the till,
then Expenses inline beneath it. A **real biller's phone** never reaches any
counter surface at all, because `GatedSurface` resolves real sessions through
`personalNavigationRoles`, which strips `biller`; they get the Employee shell.

The demo biller is neither. It is the tab-navigation shell
`src/shell/counter-shell.tsx` driven by the role router, with Counter and
Expenses as separate tabs. It was built before the tablet became its own branch
and was never brought back.

The cost is now concrete. Change #50 shipped a Finish Day readiness sheet, an
advisory tender-edit prompt, a renamed **Leave counter** confirmation and a
manager-side attribution review, and **not one of them can be shown to anybody**,
because every one of them lives on a screen the demo does not mount or depends on
a fact the demo cannot produce.

Underneath that sits a worse problem. The demo holds **two disconnected shift
representations that never sync**: `DemoCounter.shifts` for the handshake and
`DemoStore.shifts` for billing. The store seeds a shift open for Demo Biller at
Kalyani; the counter seeds none. So the Tablets surface says Priya is on shift
since 11:00 while every phone says nobody is; approving a handshake during a
walkthrough opens a shift billing has never heard of and attributes nothing to;
and ending a shift from a phone leaves the store's shift open. The demo
contradicts itself about the single fact the counter is organised around.

## What Changes

- Mount the **same** `CounterShell` for `/demo/biller` that the enrolled tablet
  mounts, behind a synthetic `CounterDeviceSession` provided through
  `CounterDeviceContext` by a demo-owned host. The demo stops having a counter
  of its own and starts showing the real one.
- Make the counter's whole lifecycle walkable in demo as a result: the no-shift
  resting state, asking for a shift by name, the four large digits, the wait, the
  timeout, three wrong codes destroying the request, Hand over, Leave counter
  from a phone, and Finish day with its readiness sheet and advisory tender-edit
  prompt.
- Move the demo off `public.shifts`, the pre-tablet shift model production
  retired on 2026-08-11, and onto `public.counter_shifts`, the one the live
  counter actually uses. The demo currently attributes every bill through the
  retired table and writes its ids into three command columns that reference the
  live one, so it stores values production could not hold. After the move the
  counter, the Tablets surface, every phone's live-shift card and the billing
  figures read one table; a shift can expire at the outlet's cutover; and Finish
  day can record `day_finished` as distinct from an operator leaving.
- Seed the after-departure attribution exception into the demo scenario, so the
  manager's billing history shows the flagged bill and all three review outcomes
  are walkable, with the bill inside the day's takings and every dependent figure
  still agreeing.
- Retire the demo biller's tab chrome and its now-unlinked surfaces, recording
  the decision in the gate registry the way that file records every other one.
- Make `docs/DEMO_MODE.md` true again. Two sentences in it describe a screen that
  does not exist; this change builds the screen rather than deleting the
  sentences.

## Capabilities

### Modified Capabilities

- `demo-mode`: the Biller walkthrough is the enrolled tablet's own shell rather
  than a role-shell imitation of it; one shift fact across every demo surface;
  the after-departure attribution exception joins the coherent scenario.

## Impact

The demo route tree gains a counter host and loses the Biller tab shell. The
mock counter and billing adapters converge on one shift representation. The demo
store gains an attribution-flagged bill. The gate registry loses the Biller's
navigation entries. `e2e/counter.spec.ts` (22 tests), `e2e/operations.spec.ts`,
`src/demo/demo-reset.test.tsx` and `src/demo/demo-safety.test.tsx` are all
affected, and the assertions at `e2e/counter.spec.ts:496-497` and `:543` change
meaning rather than merely moving.

**No live adapter, migration, policy, RPC or production behaviour changes.** No
new adapter method is needed: `requestShift`, `cancelRequest`,
`getRequestResolution`, `listPendingRequests`, `listLiveShifts`, `confirmShift`,
`rejectRequest`, `endShift`, `reportState`, `subscribeToDeviceHandshake`,
`inspectFinishDay`, `closeShift` and `reviewAttribution` are already implemented
in the mocks. What is missing is a host, one lifecycle, and seeds.

## Non-goals

- A device setup or enrolment story in demo. `/counter/setup` issues and consumes
  a real setup code, and a demo of enrolment would be demonstrating hardware
  provisioning to an audience that is being shown a shop.
- A "pretend to be offline" control. The demo reaches offline states the way a
  real tablet reaches them, and mock billing already honours `navigator.onLine`.
- Any change to a live adapter, migration, policy or production behaviour.
- **Dropping `public.shifts` from the database.** The demo stops using it here,
  but real bills from before 2026-08-10 still hang their attribution off it, so
  removing the table is a data decision rather than a cleanup and belongs in its
  own change with its own answer about legacy bill attribution.
- Any new route by which a demo session could reach Supabase. The structural
  impossibility guarded by `demo-safety` is not weakened to get the tablet shell
  mounted; the demo gets its own host precisely because `CounterRoot` imports
  `createSupabaseAdapters`.
- Reconciling the demo biller's **phone** experience. In production a Biller's
  phone is the Employee shell, and `/demo/staff` already demonstrates it.

## Roadmap

**No ROADMAP.md row, number or wave. Confirmed by the owner on 2026-08-30.**

This corrects drift between the demo and a production surface that already
shipped, and repairs a demo-only inconsistency; it adds no product capability.
The convention in this repo is that fixes and delivery tooling get a change
folder and nothing on the board.

Raised explicitly because this change is fatter than a typical fix: it repaired
two genuine production bugs in the counter's shift column, it moved the demo onto
a different database table, and it is what makes #50 demonstrable at all. The
owner considered those and kept it off the board, on the reasoning that a rule
which takes an exception the first time it feels awkward stops being a rule.

## Docs to update before archive

`docs/DEMO_MODE.md` (the two false sentences at the shift-screen and handshake
bullets; the walkthrough's Biller section; new Finish Day, Leave counter and
attribution-review scenes), `docs/SCREENS.md` (the demo Biller is no longer a tab
shell), and `docs/TESTING.md` (what demo coverage now proves).

**Also updated, because the change touched them:** nothing in `docs/DATA_MODEL.md`
or `docs/OFFLINE_AND_SYNC.md` describes the demo's table choice, and no schema,
policy or live behaviour moved, so neither needed an edit. Recorded here so the
absence reads as a decision rather than an oversight.
