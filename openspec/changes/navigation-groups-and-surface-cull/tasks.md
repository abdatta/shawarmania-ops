## 0. Before Anything

**There is no leftover code.** A working sketch of sections 2–3 was built and
approved on 2026-08-31 and then deleted from the working tree on the owner's
instruction, so this change is a rebuild from `design.md` rather than a tidy-up.
Nothing in `src/` currently knows what a navigation group is.

- [x] 0.1 Read `design.md` end to end before writing code — in particular its **Geometry** section, which carries every measurement the sketch had, and its rejected alternatives, which are two visual approaches already tried and turned down by the owner. Rediscovering either wastes a session.
- [x] 0.2 Look at the six reference screenshots and their notes at `C:/Users/iamro/Code/shawarmania-ops-nav-sketch/` if that folder still exists. It is outside the repository and outside git, so it may be gone; `design.md` is sufficient without it, and its absence is not a blocker.

## 1. Cull The Demonstration Surfaces

- [x] 1.1 Delete the gate entries `owner-comparison`, `owner-pnl`, `admin-pnl`, `owner-reports`, `owner-alerts`, `admin-alerts` and `admin-inventory` from `src/gates/registry.ts`, and their route entries plus the `inventory/:itemId` movement-ledger route from `src/routes/surfaces.tsx`. Keep `owner-outlet-view` at `outlet/:outletId` — it is the `Open` button on every outlet card.
- [x] 1.2 Delete `src/features/alerts/`, `src/features/inventory/`, and the comparison, P&L and reports surfaces in `src/features/insights/` with their tests. Keep `outlet-day-view.tsx`; keep `period.ts` and `profit-figure.tsx` only if the day view still uses them, and delete them if it does not.
- [x] 1.3 Remove the `Compare outlets`, `Profit and loss` and `Reports` buttons and the open-alert chip from `src/features/overview/owner-home.tsx` (~lines 149, 156, 163, 269–273) and the low-stock chip wherever it is raised, then update `owner-home.test.tsx` to assert their absence rather than deleting the assertions.
- [x] 1.4 Remove the mock adapters, fixtures and demo seed rows that existed only for these screens, and confirm nothing in `src/data-access/` still compiles against a deleted surface.
- [x] 1.5 Leave every migration untouched. `inventory_movements`, `outlet_alerts`, `alert_responses`, their policies, their grants and their isolation tests all stay, and `npm run test:rls` must still cover them.
- [x] 1.6 Record in `docs/LIMITATIONS.md` what these screens used to answer, that the tables survive with no reader, and that retiring them is a later change with a down-migration.

## 2. Groups In The Registry

- [x] 2.1 Add `NavGroupId`, `NavGroup` and a `NAV_GROUPS` record to `src/gates/registry.ts` for `finances` and `setup`, each with label, icon and order. Finances takes `Coins` and Setup takes `Settings2`; `Wallet` is Expenses's and `Banknote` is the Drawer's, so neither can label the group that contains them.
- [x] 2.2 Add `group?: NavGroupId` to the `nav` block and assign every entry: Finances takes Billing, Drawer, Expenses, Ledger; Setup takes Outlets, People, Delivery, Menu, Tablets; Overview, Attendance and My attendance stay top-level. Do this for the owner's and the manager's entries alike, so label dedup cannot produce a grouped and an ungrouped copy of one door.
- [x] 2.3 Restore navigation to `admin-devices` inside Setup, so a Franchise Admin reaches Tablets while the owner reaches it through Setup too.
- [x] 2.4 Add `navTree(items)` returning top-level nodes that are either a surface or a group with sorted children, with groups and ungrouped surfaces sorted against each other on one scale, and a group appearing only when at least one child is visible in this session and mode.
- [x] 2.5 Re-set `nav.order` so it is unique **per sibling set** rather than per role, and rewrite the uniqueness test in `src/gates/registry.test.ts` to assert that — a collision inside one group is still a defect, a repeat across two groups is not.
- [x] 2.6 Add a test that entries sharing a navigation label agree on their group, so a senior role's placement cannot silently win over a junior role's different one.
- [x] 2.7 Decide `src/shell/counter-shell.tsx`: either route it through `navTree`, or assert in the registry that a Biller entry never carries a group. A silent swallow is not acceptable either way.

## 3. Two-Level Navigation In The Shell

- [x] 3.1 Draw the rail from `navTree`: group rows identical in height, weight, casing and lit colour to Overview and Attendance, with a chevron as the only difference, children indented under a hairline, sections open by default and collapsible.
- [x] 3.2 Draw the phone bar from `navTree`: four tabs, and a group tab that opens a rounded card above the bar inside the bar's own block, with a tail positioned by tab index pointing at the tab that opened it.
- [x] 3.3 Build the card's entries as bar tabs one size smaller — 56px tall, icon 18px, 11px label, against the bar's 64px and 20px — icon over label and the same lit colour. Not pills and not a segmented control: both were tried and rejected, because the second row must read as navigation rather than as a filter.
- [x] 3.4 Draw the card as `rounded-2xl` with a one-pixel border, `bg-surface-raised` and a soft shadow, **inside the bar's own block** so no page content shows through the gap between card and bar, and hide its scrollbar so it does not cut the bottom edge.
- [x] 3.5 Draw the tail as a 12px square rotated 45° with only its bottom and right borders, positioned at `((index + 0.5) / count) * 100%` of the bar width, so it needs no measurement and stays correct when the card scrolls sideways.
- [x] 3.6 Seed the open group from the address, re-seed it only when the reader crosses into or out of a group, and refuse to close a group the reader is standing inside.
- [x] 3.7 Reserve the taller bottom padding whether or not a group is open, so opening one shifts nothing.
- [x] 3.8 Light a group tab whenever the reader is inside it, open or shut, and keep lighting only the most specific entry among its children.
- [x] 3.9 Verify the group control carries an accessible name and an accurate `aria-expanded`, and that a shut group's children are genuinely absent from the page rather than hidden.

## 4. Waiting Work Survives Being Folded Away

- [x] 4.1 Badge a collapsed group with the sum of its children's attention counts, and show nothing when that sum is zero.
- [x] 4.2 Show each child's own count and no sum once the group is open, so no waiting item is counted twice on screen.
- [x] 4.3 Add a test that Delivery's waiting work is readable from a shut Setup — the regression this rule exists to prevent.
- [x] 4.4 Decide whether attention reads are hoisted into one shared read per source, or left as one hook instance per badge with a todo naming the duplication. Either way, confirm counts are still read on render and on return to the foreground and never polled.

## 5. Outlets For Managers, And The Outlet Card

- [x] 5.1 Add a Franchise Admin Outlets surface, read-only, scoped to the outlets their live assignments name, reaching the same card the owner reads.
- [x] 5.2 Prove in the isolation suite that a Franchise Admin reads only their assigned outlets from this surface, with a hand-crafted request, and that every create, edit, close and delete is refused by the database rather than by the UI.
- [x] 5.3 Put what the outlet is raising on its card as text on the card. The Alerts surface is deleted in this change, so this is not a link — settle the wording before building it.
- [x] 5.4 Put the state of the tablet standing at that counter on the card, and a Tablets button that opens the tablet administration for **that** outlet.
- [x] 5.5 Resolve the scope blocker for 5.4: either seed `src/features/outlet-scope.tsx` from the URL, or give Tablets a per-outlet address. Say which and why in the change folder, because the sketch's shared-page link is explicitly not the answer.
- [x] 5.6 Confirm the owner's Outlets surface keeps every write it has, and that the manager's shares the component without sharing the actions.

## 6. Roadmap And Docs

**The roadmap surgery already happened, when this change was proposed.** The
board would otherwise have carried a withdrawn plan and its replacement at the
same time, contradicting itself for however long the two sessions are apart. It
is recorded here as prose rather than as ticked boxes, so the status reconciler
does not read it as implementation having started:

- Roadmap `#13 owner-console-live` is withdrawn — row removed,
  `openspec/changes/owner-console-live/` deleted, and the reasoning preserved in
  `openspec/todos/owner-console-was-withdrawn.md` along with what the plan
  contained and what rebuilding it would cost.
- `#14 outlet-onboarding` is rewired from `#13` to `#51`, and the Wave E
  narrative, the Wave D sentence, the model-assignment paragraph, the Mermaid
  dependency graph and the two deferred-work items that named `#13` are all
  reconciled with it.
- `openspec/todos/outlet-alerts-was-withdrawn.md` is seeded, and
  `openspec/todos/inventory-is-shelved.md` is superseded where it says shelving
  is "not a deletion" — it is one now, and that note's own reasoning is what made
  it one.
- `openspec/todos/navigation-outgrows-a-flat-list.md` is closed, recording how
  each of its four stated difficulties was answered.

- [x] 6.1 Verify the four items above still hold when implementation starts, and that nothing added since references `#13`, `openspec/changes/owner-console-live/`, or a spec this change removes.
- [x] 6.2 Update `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/DEMO_MODE.md`, `docs/ARCHITECTURE.md`, `docs/LIMITATIONS.md` and `docs/TESTING.md`.
- [x] 6.3 Run `npm run roadmap:sync` so the board's status cells derive from the folders rather than being hand-stamped.

## 7. Verification And Phase Gate

- [x] 7.1 Add unit tests for `navTree` grouping and ordering, the group-sum badge, the open-group seeding rules, and the refusal to close a group from inside it.
- [x] 7.2 Repair the e2e specs the cull and the restructure touch: `e2e/shell.spec.ts`, `e2e/operations.spec.ts`, `e2e/expenses-and-ledger-reach.spec.ts`, `e2e/owner-console.spec.ts`, `e2e/demo-screens.spec.ts`, `e2e/attendance.spec.ts` and `e2e-auth/auth.spec.ts`.
- [x] 7.3 Decide the phone coverage question: add a phone project to `playwright.config.ts` and walk the two-level bar there, or record in `docs/TESTING.md` that it is covered by unit tests only and why.
- [x] 7.4 Walk all four roles in demo mode and confirm no route resolves to a deleted screen and no button points at one.
- [x] 7.5 Put a badge on the corner of a tab's icon rather than after its label, on both rows, so a count never makes one tab wider than its neighbours; on a rail row it sits at the end.
- [x] 7.6 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then inspect the phone bar, the open card and the rail in light and dark.
- [x] 7.7 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth` — the isolation suite must still pass for the tables this change deliberately left standing.
- [x] 7.8 PHASE GATE — the owner's phone shows four navigation entries and every surface they reach is one they still use; tapping a group opens its children in a card anchored to the tab that opened it; a shut Setup still shows that Delivery is waiting, and opening it replaces that sum with the parts; a Franchise Admin reads their own outlets and generates a tablet setup code from the outlet it stands in, while the database refuses them every outlet write; seven surfaces are gone from the codebase with `inventory_movements`, `outlet_alerts` and `alert_responses` untouched and still covered by the isolation suite; and the four-role demo walkthrough still walks.
