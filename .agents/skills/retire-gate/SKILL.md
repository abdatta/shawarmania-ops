---
name: retire-gate
description: Retire a Shawarmania change gate after its change has run on — delete the off path and toggle points, tombstone the key, untag tests, release that, then after every tablet has run the new build for three services write the contract migration. Use when $next-change lists a gate as due, lint warns a retireBy has passed, or the user asks to retire a gate.
---


# Retire a gate

A change gate is temporary. Once its change has run on, the off path is dead
code with a switch on it, and every live gate doubles what must be tested. Lint
warns from the gate's `retireBy` and fails fourteen days after. Retirement comes
in two halves, code first and database three services later, because old builds
stay on tablets until they update and Republish can put one back (design D11,
steps 10 and 11).

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

## 2. Wait — the readiness check

The contract migration removes what the off path used and retires the row. After
it, a build that still carries the off path breaks if it runs: a tablet that has
not updated, or an older build put back by Republish. So the database half waits
until no tablet runs such a build and a Republish past the retirement is unlikely
to be needed. Check each of these, read-only, and stop at the first that fails,
saying which and what it waits on. `/next-change` runs the same check for every
cleanup still pending.

1. **Every registered device runs the retirement build or later.** Registered is
   every `counter_devices` row not removed, counter and kitchen alike, not only
   the ones that report:

   ```sql
   select d.label, d.kind, o.name as outlet, h.build, h.reported_at
     from public.counter_devices d
     join public.outlets o on o.id = d.outlet_id
     left join public.device_health h on h.device_id = d.id
    where d.removed_at is null
    order by o.name, d.label;
   ```

   A tablet's `build` is the short SHA of the `main` commit Deploy or Republish
   built, so ordering is a git question, not a telemetry one: for each `build`,
   `git merge-base --is-ancestor <retirement commit> <build>` must succeed, with
   `origin/main` fetched. The retirement commit is its copy on `main`, not a
   pre-squash `stage` one. A device with no report, or none since the retirement's
   Deploy, is not evidence of anything: name it to the owner and ask whether it is
   still in use. One that is not is removed from **Tablets**, which takes it off
   this list; one that is waits until it has loaded the new build. Without
   production read access, the owner reads each tablet's build from the Change
   gates page, which is weaker evidence: say so.
2. **Three services on it.** The retirement build went live with the earliest
   successful Deploy run whose head contains the retirement commit
   (`gh run list --workflow deploy.yml --json headSha,conclusion,createdAt`). From
   that run's `createdAt`, every outlet with a registered device has traded at
   least three business days:

   ```sql
   select b.outlet_id, count(distinct b.business_date) as services
     from public.bills b
    where b.created_at >= '<the Deploy run''s createdAt>'
    group by b.outlet_id;
   ```

   Three services is the owner's call (2026-10-18) for how long a Republish to a
   build from before the retirement stays possible. A retirement changes no
   behaviour, so a fault that needs one shows by then. After the contract
   migration, Republish is safe only to a build that contains the retirement.
3. **No person's screen still carries the off path.** Tablet health covers
   counter and kitchen tablets only; the owner's and Franchise Admins' own phones
   never report. If a toggle point the retirement removed was on a person's
   screen, ask the owner to reload the app on their phone before going on.

## 3. The contract migration

A new migration whose header declares `-- release: contract <key>`. Only now may
a migration drop, rename, retype, revoke or replace (`npm run lint:migrations`
admits these for a contract migration, and refuses one whose key is not yet in
`RETIRED_CHANGE_GATES`).

- **Find every database reader of the key first.** The database asks for gates
  too, `app_change_gate('<key>')` in a function, a policy, a trigger's condition
  or a view, and once the row is retired that read answers off: the database
  takes the off path the migration may just have dropped. Search production, and
  a fresh local reset, which must agree:

  ```sql
  select 'function' as kind, p.oid::regprocedure::text as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%<key>%'
  union all
  select 'policy', tablename || '.' || policyname from pg_policies
   where coalesce(qual, '') || coalesce(with_check, '') like '%<key>%'
  union all
  select 'trigger', tgrelid::regclass::text || '.' || tgname from pg_trigger
   where not tgisinternal and pg_get_triggerdef(oid) like '%<key>%'
  union all
  select 'view', schemaname || '.' || viewname from pg_views
   where schemaname = 'public' and definition like '%<key>%';
  ```

  Rewrite each reader in this same migration to keep only its on branch, before
  the update that retires the row. On 2026-10-18 `dish-ticks` had two:
  `order_label_leaves_the_rail()` and `order_line_added_by_an_edit()`.
- Drop what **only** the off path used: the original function a `name_v2`
  replaced, a column only the old path wrote, an old policy or trigger.
- **Keep the `_v2` names.** Renaming them back would break every published build.
- **Children first.** The database holds the dependencies too, and a parent
  turned off turns its children off, so a gate's contract migration lands before,
  or with, that of every gate it depends on.
- Retire the row last, which is the one data change a contract migration may make:
  `update public.change_gates set retired_at = now(), enabled = false where key = '<key>';`
- Update the pgTAP tests that named what was dropped, and run every database gate
  on a fresh reset.
- Ship it through the normal release path.

## 4. Report

The key and code retired; the toggle points and tests removed; the date the
retirement build reached every tablet and the evidence; the contract migration,
what it dropped and which readers it rewrote. Anything not done yet — usually
step 3, waiting on the readiness check — with what it waits on: the device not
yet on the build, or the services still to trade.
