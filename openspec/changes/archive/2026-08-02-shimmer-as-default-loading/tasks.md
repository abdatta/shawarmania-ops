## 1. Grow the shared module

- [x] 1.1 In `src/components/ui/loading.tsx`, extract the block treatment into a `Shimmer` primitive: one `aria-hidden` animated block, `rounded-xl border border-border bg-surface-raised animate-pulse`, sized entirely by a caller-supplied `className`. No hex literals, semantic tokens only.
- [x] 1.2 Add a `LoadingRegion` wrapper owning the semantics: `role="status"`, `aria-busy="true"`, `aria-live="polite"`, an `sr-only` "Loading {label}…", a required `label`, and a `className` for the caller's layout classes plus `children`. Every placeholder in the app renders through this, so the contract is written once.
- [x] 1.3 Rewrite `LoadingList` and `LoadingBlock` on top of `LoadingRegion` + `Shimmer` with **unchanged signatures**, so the four attendance call sites do not change. Add an optional block-height prop to `LoadingList` so a stack of short figure cards need not reserve tall-card height.
- [x] 1.4 Add `LoadingTable` (a header strip plus N row strips, matching `src/components/layout/data-table.tsx`) and `LoadingFigures` (a card of N label/value row pairs, the shape cash, P&L and reports share).
- [x] 1.5 Extend `src/components/ui/loading.test.tsx` so the busy-region announcement, the reduced-motion survival, and the no-hex-literal assertions cover every exported shape, not just `LoadingList` and `LoadingBlock`. Assert `LoadingRegion` applies caller layout classes, since composition depends on it.
- [x] 1.6 Update the module's doc comment: it now explains the primitive-plus-region design and states that a surface's placeholder copies that surface's own container classes.

## 2. Convert the session boot and the overview shells

- [x] 2.1 `src/auth/real-root.tsx:55` — replace the text line with a shell silhouette (header strip plus content block), label "the app", per design D3.
- [x] 2.2 `src/features/overview/owner-home.tsx:127` — `LoadingList` matching the `space-y-3` stack of `OutletCard`s.
- [x] 2.3 `src/features/overview/admin-home.tsx:41` — placeholder shaped like the admin home's loaded layout.
- [x] 2.4 `src/features/overview/staff-home.tsx:48` — placeholder shaped like the staff home's loaded layout.

## 3. Convert the money surfaces

- [x] 3.1 `src/features/cash/daily-cash-surface.tsx:219` — `LoadingFigures` matching the `Card` of label/value `Row`s, plus the exception card's space when applicable.
- [x] 3.2 `src/features/expenses/expenses-surface.tsx:261` — placeholder matching the loaded expense list.
- [x] 3.3 `src/features/billing/billing-counter.tsx:252` — compose the two-pane `md:grid-cols-[minmax(0,1fr)_20rem]` silhouette. Build it first; the keep-or-except decision is task 9.6, taken from the built thing rather than from argument.
- [x] 3.4 `src/features/billing/shift-unlock.tsx:135` — placeholder matching the loaded biller list.

## 4. Convert the insights surfaces

- [x] 4.1 `src/features/insights/pnl-surface.tsx:143` — `LoadingFigures` matching the figure, sales and expenses cards.
- [x] 4.2 `src/features/insights/reports-surface.tsx:156` — `LoadingFigures` matching the totals, expenses and profit cards.
- [x] 4.3 `src/features/insights/comparison-surface.tsx:137` — `LoadingTable`, matching the `DataTable` column count.
- [x] 4.4 `src/features/insights/outlet-day-view.tsx:149` — placeholder matching the loaded day layout.

## 5. Convert the remaining outlet surfaces

- [x] 5.1 `src/features/inventory/inventory-surface.tsx:229` — placeholder matching the `ul space-y-2` stock list.
- [x] 5.2 `src/features/inventory/movement-ledger.tsx:115` — placeholder matching the loaded ledger layout.
- [x] 5.3 `src/features/menu/menu-surface.tsx:262` — placeholder matching the loaded menu layout.
- [x] 5.4 `src/features/outlets/outlets-surface.tsx:346` — placeholder matching the loaded outlet list.
- [x] 5.5 `src/features/alerts/alerts-surface.tsx:201` — placeholder matching the loaded alert list.
- [x] 5.6 `src/features/accounts/accounts-surface.tsx:453` — placeholder matching the loaded people list.
- [x] 5.7 Re-run the repo-wide search for the loading sentence and confirm zero remain outside `src/components/ui/loading.tsx`. This is the check that the change is not half-converted.

## 6. Move the affected test assertions

- [x] 6.1 Find every test asserting on the "Loading…" string and move the assertion to the `role="status"` busy region. Mechanical per test; no new per-surface suites, which the proposal excludes.

## 7. The two non-blocking guards

- [x] 7.1 Add a `no-restricted-syntax` entry to `eslint.config.js` matching a `JSXText` node containing `Loading`, scoped to `src/**/*.tsx`, ignoring `src/components/ui/loading.tsx`, at **`warn`** severity. Not `error`: this must never fail a build. Message names the loading module and `docs/DESIGN_SYSTEM.md`, following the explanatory style the existing architectural rules use.
- [x] 7.2 Confirm the rule warns and does not fail: `npm run lint` exits zero with the rule in place, verified by temporarily reintroducing a loading sentence.
- [x] 7.3 Add the reshape line to `AGENTS.md` under `## Hard Rules` → `### Design`: if a change alters a surface's layout, that surface's shimmer is reshaped in the same change.
- [x] 7.4 Add the same line to the `/opsx:apply` and `/opsx:archive` step definitions.

## 8. Docs

- [x] 8.1 `docs/DESIGN_SYSTEM.md:211` — replace "spinners are acceptable on manager screens" with the shimmer as the default loading language, stating that the shape belongs to the page and that a layout change reshapes its placeholder. Keep the counter's optimistic-UI sentence, which is about writes and still true.

## 9. Verification

- [x] 9.1 `npm run lint`, `format:check`, `typecheck`, `test`, `contrast`, `build`, `test:e2e` all green.
- [x] 9.2 `npm run db:start` + `db:reset`, then `test:db`, `test:rls`, `test:e2e:auth` **in that order**. No migration in this change, but CI runs them and so must this.
- [x] 9.3 `npm run db:types` and `git diff --exit-code src/data-access/database.types.ts` — the last CI step, which a change with no migration can still fail on inherited drift.
- [x] 9.4 Walk every converted surface in demo mode with the network throttled so the placeholder is actually visible, and confirm each reserves the shape that arrives. This is the baseline review the design calls for, since nothing automated will check it afterwards.
- [x] 9.5 Confirm reduced motion: with `prefers-reduced-motion` set, every placeholder still reads as a wait.
- [x] 9.6 **Take the counter decision.** Open the built counter placeholder on a throttled connection and on a fast one, and judge whether the flash is worse than a brief empty pane. Report which way it went and why. If it is an exception, it is recorded in `docs/DESIGN_SYSTEM.md` as a named exception with its reason, not left as an undocumented gap, and the `design-system` delta gains a scenario permitting it. If it is fine, say so and it stays.

## 10. PHASE GATE

- [x] 10.1 🧍 **Gate**: on a real phone with a throttled connection, every surface across all four roles waits behind a shimmer shaped like what lands on it, with no sentence and no spinner anywhere including the session boot; nothing visibly jumps when content arrives; the four attendance surfaces are unchanged; a reader with reduced motion still learns each surface is waiting; and `npm run lint` reports the new rule as a warning while exiting zero.

**Off-roadmap**: this change is not a roadmap item and is deliberately not being
added to one. It has no roadmap checkpoint and no ordering constraint against
another change; it touches only presentational loading branches, so it can land
between any two roadmap changes.
