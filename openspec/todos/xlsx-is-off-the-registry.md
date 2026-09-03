# SheetJS Left The npm Registry, So `xlsx` Cannot Be Patched

**Type**: Security · **Status**: Open, exception documented 2026-09-03 · **Area**: Security / Aggregator sync

## Expectation

`npm audit` is clean, or every exception names itself with a review date.

## Current behaviour

`xlsx@0.18.5` carries two high advisories — prototype pollution
([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)) and
ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9))
— and **`npm audit fix` cannot resolve them.** `npm view xlsx versions` ends at
0.18.5: SheetJS stopped publishing to npm after that release and now distributes
0.20.x only from `cdn.sheetjs.com`. The lockfile already holds the newest
published version.

The exception is written down in
[`docs/SECURITY_AND_PRIVACY.md`](../../docs/SECURITY_AND_PRIVACY.md) with its
reachability analysis and a review trigger, which is what the standing rule asks
for when no compatible fix exists. This item is the work that discharges it.

## Why it is not a bump

Three reasons, and the second is the one that makes it a change rather than a
one-liner.

1. **The fix is off-registry.** Taking official 0.20.x means depending on a
   vendor CDN tarball rather than a registry package — a change in how a
   dependency is *sourced*, not which version it is.
2. **A `package.json` bump would not fix the exposed path.**
   `supabase/functions/parse-operator-statement` pins its own `npm:xlsx@0.18.5`
   through Deno, a resolution entirely separate from `node_modules`. Nothing
   under `src/` imports the package outside a test, and the built browser bundle
   contains no SheetJS at all. So the only runtime exposure is the Edge Function,
   and only its own import line changes it.
3. **It parses money.** `_shared/statement-parser-core.ts` turns operator
   workbooks into settlement and supply rows, pinned by real fixtures — one of
   whose comments records a specific float SheetJS 0.18 produces from a computed
   cell. A 0.18 → 0.20 move has to run those fixtures and be believed, not
   assumed.

## Rejected: `@e965/xlsx`

`@e965/xlsx@0.20.3` is on the registry and would make `npm audit` green in one
command. It is a **third-party republish** of SheetJS. Routing this business's
financial statement parsing through an unaudited mirror to escape two bounded,
well-understood advisories is the worse bargain, and "the audit is green" would
be the only thing gained.

## Open questions

- Vendor CDN tarball in `package.json`, or vendor the file into the repo? A
  tarball URL is not integrity-pinned by the registry, and a vendored copy has to
  be updated by hand — neither is obviously right.
- Does the Edge Function need `xlsx` at all, or would a narrower reader do? It
  needs sheet-to-JSON over `.xlsx` and nothing else; the surface actually used is
  small enough that the question is worth asking before committing to the
  dependency again.
- Is the npm dependency still needed once the Edge Function is settled? Today it
  exists for one test.

## Trigger to promote

Any of the review triggers in `docs/SECURITY_AND_PRIVACY.md` firing — SheetJS
returning to the registry, the parser becoming reachable by a non-admin role, or
an advisory that does not need an authenticated upload — or the **2026-12-31**
review date, whichever is first.

**Dependencies when seeded**: none. It touches the statement parser, so it should
not share a change with anything else.
