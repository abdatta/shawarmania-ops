# Proposal: retire-one-revenue

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-21 when
> `revenue-reads-the-same-everywhere` (#76) was archived; expanded 2026-10-22 on
> the owner's word to retire it now and cut `pro-rata-pnl`'s dependency on it,
> rather than wait for #79 and retire both together.

## Why

The `one-revenue` gate (code `RV`, `retireBy` 2027-01-31) has done its job. It
was turned on in production at 12:42 IST on 16 October 2026 and has stayed on,
through every service since, on every device expected to operate. **It was never
pulled**: the owner waived the off-and-on on 21 October, because turning revenue
off mid-trade buys nothing and its on path writes nothing (round trip `none:`).
Its off path is now dead code with a switch on it, and every live gate doubles
what the browser suites must run.

## The dependant stays, and stops depending

`pro-rata-pnl` (#79) depends on `one-revenue`, because Pro-rata P&L is built on
One Revenue's figures. #79 is not archived: its gate was turned on only on 21
October and has not been pulled, so it cannot retire with this one.

A dependency is not a note. It is checked live in three places: a page runs a
gate only while every gate it depends on is on; the database's
`app_change_gate` does the same; and turning a parent off on the Change gates
page turns its dependants off. A retired gate reads off everywhere. Left in
place, the edge would turn Pro-rata P&L off on every screen the moment
`one-revenue` retired.

So this change **cuts the edge**. Retiring `one-revenue` keeps its figures for
good, which is the only thing the dependency protected. `pro-rata-pnl` loses its
`dependsOn` in the code, and a migration deletes its
`change_gate_dependencies` row with the code half, so the two keep describing the
same gate (`lint:change-gates` compares them). Deleting the row now rather than in
the contract migration is safe: `one-revenue` stays on until then, so a build that
still declares the dependency still finds its parent on. The one difference is
that turning `one-revenue` off on the Change gates page no longer turns Pro-rata
P&L off with it.

**Rejected: waiting for #79 and retiring both together.** One code half, one wait
and one contract migration instead of two of each, but it keeps RV's off path
alive for weeks for no reason the owner shares (2026-10-22).

## What changes

- **Code.** Every toggle point keeps its on branch: Overview's card (the old card,
  its four reads and the *Month through yesterday* header go), the Ledger's day
  and month (the netted revenue, the ceiling wording and the *at most* labels go;
  a month's `figures` is always there), Analytics' Sales and Items (Month,
  aligned and cut reads, always). The Overview adapter loses `sales`, `revenue`
  and `expenses`; the live Analytics adapter calls only `sales_analytics_v2` and
  `sales_analytics_series_v2`. `one-revenue` moves to `RETIRED_CHANGE_GATES`,
  and out of the demo's gate words.
- **The dependency.** `pro-rata-pnl` loses `dependsOn: ['one-revenue']`;
  migration `20261101010000_pro_rata_pnl_stands_alone.sql` deletes the edge, under
  a `release-lint: allow data` with its reason. `lint:change-gates` learns to
  read a dependency deleted by a later migration.
- **Tests.** Unit tests of the off path go, and the `describeChangeGate` blocks
  become plain tests of the on behaviour; Overview's screen tests are rewritten
  against the one card. In the browser suites, `@cg-on:` and `@cg-off:` tags go;
  the signed-in `analytics.spec.ts`, `overview.spec.ts` and
  `overview-boundaries.spec.ts`, which held only off-path tests already covered
  on the on path by `e2e-auth/one-revenue.spec.ts`, are deleted; the demo's
  off-tagged tests are kept and made to read the on behaviour, or deleted where
  they pinned only the old one.
- **Spec and docs.** `outlets-overview`'s *Today's revenue names the sale in
  progress* loses its gate condition. `docs/` stops calling the behaviour gated
  and stops describing the off path.
- **Database, after three services on the retirement build.** A contract
  migration (`-- release: contract one-revenue`) drops the first-generation reads
  only the off path called (`overview_sales`, `overview_revenue`,
  `overview_expenses`, `sales_analytics`, `sales_analytics_series`), updates the
  pgTAP tests that name them, and sets the gate's `retired_at`. No function,
  policy, trigger or view reads the key.

## Change gate

No gate: a retirement keeps the behaviour already on.
