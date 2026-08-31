# Proposal: Navigation Groups And Surface Cull

> **Model**: Opus · **Wave**: E · **Depends on**: #12 · **Gate**: the owner's phone shows four navigation entries — Overview, Finances, Attendance, Setup — and every surface they reach is one they still use; tapping a group opens its children in a card anchored to the tab that opened it, a collapsed group shows the sum of what its children are waiting on, and opening it replaces that sum with the parts; a Franchise Admin reaches their own outlets read-only and administers a tablet from the outlet it stands in; seven demo-only surfaces are gone from the codebase with their database tables untouched; and the four-role demo walkthrough still walks.

## Why

Navigation had grown to sixteen flat entries. On the owner's phone that is a
horizontally scrolling bottom bar with roughly half the entries off the right
edge and nothing saying they are there — a tab you have to remember exists and
scroll sideways to find is not navigation. This is the gap recorded in
[`openspec/todos/navigation-outgrows-a-flat-list.md`](../../todos/navigation-outgrows-a-flat-list.md),
and its stated trigger has fired.

The list also contains surfaces nobody is going to use. Four of the sixteen are
demonstration screens with no live data behind them, two of which the roadmap
still plans to build. The owner reviewed the app against the business as it
actually runs and concluded the opposite: the app is complete, and what remains
is planning from before the counter was trading. Grouping screens the business
has abandoned would be tidying a drawer full of things to throw away.

So this change does both halves at once, deliberately. Cutting first and then
grouping would mean designing the groups twice; grouping first would mean
finding homes for entries about to be deleted.

## What Changes

- **Two-level navigation.** Four top-level entries: Overview, **Finances**
  (Billing, Drawer, Expenses, Ledger), **Attendance**, and **Setup** (Outlets,
  People, Delivery, Menu, Tablets). A group is a heading with surfaces under it
  and no surface of its own; it is never a link, and only its children navigate.
- **Grouping is metadata, not addresses.** Every surface keeps the path it has
  today, so every link the owner already holds keeps working.
- **On a phone**, tapping a group opens a card floating above the bar, anchored
  to the tab that opened it by a tail. On a **wider screen**, one rail draws
  groups as ordinary rows with a chevron, children indented beneath.
- **A collapsed group carries the sum of its children's waiting work**, and
  opening it replaces that sum with each child's own count. No waiting work sits
  invisibly behind something unexpanded.
- **Franchise Admins get an Outlets surface**, read-only, scoped to the outlets
  they are assigned to. They have none today.
- **The outlet card becomes the place an outlet is read and administered**: what
  that outlet is raising, the state of the tablet standing at its counter, and
  the way in to administer that tablet. Tablets stops being a top-level entry.
- **Seven demonstration surfaces are deleted** — gate, route, component and
  tests — because the business is not going to build them: Compare, P&L (both
  roles), Reports, Alerts (both roles), and Stock with its movement ledger.
- **The roadmap loses the work that built them.** `#13 owner-console-live`
  becomes a todo rather than a plan, and `#14 outlet-onboarding` is rewired off
  it.

## Capabilities

### Modified Capabilities

- `app-shell`: navigation gains a second level. Entries may declare a group;
  groups sort against ungrouped entries on one scale; a group's children are
  reached by expanding it rather than by an address of its own.
- `attention-badges`: the rule that a reader must never change a selection to
  discover work exists behind it now applies to a collapsed navigation group,
  one level above the channel and outlet switches it already governs.
- `outlet-tenancy`: a Franchise Admin may read the outlets their assignments
  name, and may reach the tablet administration for one of them from it.
- `demo-mode`: the four-role walkthrough loses the screens this change deletes.

### Removed Capabilities

- `outlet-alerts`: the alert thread, its status machine and the cross-outlet
  inbox. Never ran on live data. What an outlet is raising is read on its card
  instead, and the thinking is preserved as a todo.
- `inventory-ledger`: stock movements and the current-quantity cache. Already
  formally shelved on the roadmap; this removes the demonstration surface that
  outlived the decision.
- `profit-estimates`: the two named profit bases. The estimate had no live
  reader and the roadmap change that would have given it one is withdrawn.

### Partially Removed Capabilities

- `cross-outlet-oversight`: the period comparison of two outlets goes. **The
  outlet switcher and the per-outlet reading stay** — they are what the owner's
  Overview and the day view are built from, and they are used daily.

## Impact

The gate registry, both phone and rail navigation, the attention badge
mechanism, the Outlets surface, the outlet scope resolver, `owner-home`'s links
and chips, eight route entries, seven feature directories, four specs, the
roadmap and its dependency graph, and the demo fixtures behind the deleted
screens.

**The database is not touched.** `inventory_movements`, `outlet_alerts`,
`alert_responses` and everything else in
`supabase/migrations/20260726000006_inventory.sql` and
`20260726000009_alerts.sql` stay exactly as they are, with their policies and
their isolation tests. The owner asked to delete the surfaces; dropping live
tables is irreversible and was not asked for. A later change may retire them
once these rows have been confirmed worthless, and it will have a down-migration
when it does.

## Non-goals

- Dropping any table, policy, function or migration.
- Changing any surface's address. Every path in the registry stays where it is.
- Rebuilding what an outlet raises as a new feature. The card shows what is
  already derivable; the alert thread is not being reimplemented somewhere else.
- Making a Franchise Admin able to create, edit, close or delete an outlet. Their
  Outlets surface reads.
- Persisting which group is open across reloads.

## Docs to update before archiving

- `docs/SCREENS.md` — the navigation shape, and the seven screens that leave.
- `docs/ROLES_AND_PERMISSIONS.md` — the Franchise Admin's new Outlets surface.
- `docs/DEMO_MODE.md` — the walkthrough, and the gate table.
- `docs/ARCHITECTURE.md` — navigation is derived from the registry in two levels.
- `docs/LIMITATIONS.md` — what the deleted surfaces used to answer and no longer
  does, and the tables left standing with no reader.
- `docs/TESTING.md` — whether the phone bar earns a Playwright project.
