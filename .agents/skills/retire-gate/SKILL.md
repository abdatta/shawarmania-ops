---
name: retire-gate
description: Retire a Shawarmania change gate after its change has run on — delete the off path and toggle points, tombstone the key, untag tests, release that, then after every tablet has run the new build for a week write the contract migration. Use when $next-change lists a gate as due, lint warns a retireBy has passed, or the user asks to retire a gate.
---


# Retire a gate

A change gate is temporary. Once its change has run on, the off path is dead
code with a switch on it, and every live gate doubles what must be tested. Lint
warns from the gate's `retireBy` and fails fourteen days after. Retirement comes
in two halves, code first and database a week later, because old builds stay on
tablets until they update (design D11, steps 10 and 11).

**Not the probe.** A gate marked `selfTest` — `probe`, *PB* — is the gate
system's own test switch: it has no toggle point, no `retireBy`, and is never
retired (owner, 2026-10-16).

## 0. Preconditions — stop at the first that fails

1. **The change is archived**, which means the gate was turned on in production,
   pulled once, and saw real use.
2. **The gate is on in production**, and has stayed on since its pull. Ask the
   owner to read its *History* on the Change gates page, or read
   `change_gate_events` read-only if you have production read access.
3. **Every gate that depends on it is retired first**, or in this same change.
   `lint:change-gates` fails a declared gate depending on a retired one.

## 1. The retirement change — code only

Use the folder `$openspec-archive-change` seeded, `openspec/changes/retire-<key>/`, or write it.
Its proposal's `## Change gate` section reads `No gate: a retirement keeps the
behaviour already on.` It needs no gate of its own, and no migration.

- **Every toggle point keeps its on branch and loses the rest.** Find them all:
  `useChangeGate('<key>')`, `snapshot['<key>']`, `bootSnapshot()['<key>']`.
  Delete the off path's code where nothing else uses it.
- **Move the key** from `CHANGE_GATES` to `RETIRED_CHANGE_GATES` in
  `src/change-gates/gates.ts`. The key is never used again; its two-letter code
  is free for a new gate.
- **Tests.** Delete every `@cg-off:<key>` test and every
  `@cg-round-trip:<key>` test. Drop the `@cg-on:<key>` tag from the rest, so they
  run in both states. A `describeChangeGate('<key>', …)` block becomes plain
  tests of the on behaviour.
- **The demo's copy.** `src/data-access/mock/change-gates.ts` holds the demo's
  words and history for every gate; the key leaves both.
- **Spec and docs.** A requirement that names the gate loses its gate sentence and
  its gate-off scenario, through a `## MODIFIED Requirements` delta in the
  retirement folder; `docs/` stops calling the behaviour gated.
- **Leave the database alone.** The gate's row stays and keeps reading on, so a
  tablet still on an older build keeps running the on path.
- `npm run lint:change-gates` passes: it fails a test tag still naming the key.

Release it like any change. It changes no behaviour, because the behaviour it
keeps is the one already on.

## 2. Wait for every tablet — the telemetry check

The contract migration removes what the off path used. A tablet still running a
build with the off path could reach it — if the gate were somehow off — so the
database half waits until no tablet can.

- On the Change gates page, every tablet's **build** must be the retirement build
  or later, continuously **for at least a week**. With **Tablet health** retired
  or off, ask the owner to read each tablet's build stamp instead, and say that
  this is weaker evidence.
- A tablet that has not reported in that week is not evidence of anything: ask
  where it is before going on.

## 3. The contract migration

A new migration whose header declares `-- release: contract <key>`. Only now may
a migration drop, rename, retype, revoke or replace (`npm run lint:migrations`
admits these for a contract migration, and refuses one whose key is not yet in
`RETIRED_CHANGE_GATES`).

- Drop what **only** the off path used: the original function a `name_v2`
  replaced, a column only the old path wrote, an old policy or trigger.
- **Keep the `_v2` names.** Renaming them back would break every published build.
- **Children first.** The database holds the dependencies too, and a parent
  turned off turns its children off, so a gate's contract migration lands before,
  or with, that of every gate it depends on.
- Retire the row, which is the one data change a contract migration may make:
  `update public.change_gates set retired_at = now(), enabled = false where key = '<key>';`
- Update the pgTAP tests that named what was dropped, and run every database gate
  on a fresh reset.
- Ship it through the normal release path.

## 4. Report

The key and code retired; the toggle points and tests removed; the date the
retirement build reached every tablet and the evidence; the contract migration
and what it dropped. Anything not done yet — usually step 3, waiting on the week
— with the date it becomes due.
