# Tasks: Restore The Month's P&L

## 0. Before writing code

- [ ] 0.1 Read `design.md` end to end. Its D1 carries the exact ceiling
      arithmetic and D3 the treatment of dates with no bills; both are the places
      an otherwise-correct implementation goes wrong quietly. D3 also records a
      boundary design the owner rejected — do not rediscover it.
- [ ] 0.2 Read the deleted screen and its arithmetic, which are the design
      reference the owner asked to have back:
      `git show 6c228b6^:src/features/manual-ledger/ledger-month.tsx` and
      `git show 6c228b6^:src/features/manual-ledger/ledger.ts` (`readMonth`).
- [ ] 0.3 Confirm `#51 navigation-groups-and-surface-cull` has archived. This
      change re-adds a spec that #51 removes; applying it first makes two deltas
      disagree about one file (`design.md` D5).

## 1. The month reading carries what the day reads already produce

- [ ] 1.1 Widen `LedgerStatementMonth` in `src/data-access/adapters.ts` with a
      revenue section (cash, UPI, per-channel gross/commission/net/asOfAt, the
      revenue total, and the undetermined-day **count**), an expense section
      grouped by category, and the profit figure's inputs. Money is integer paise
      throughout.
- [ ] 1.2 Accumulate channels into a **map keyed by `channel`**, not two named
      fields (`design.md` D2). Render order is stable; a third channel needs no
      change here.
- [ ] 1.3 Implement the ceiling arithmetic exactly as `design.md` D1 states:
      `net += day.netPaise ?? day.grossPaise`, and commission **derived** as
      `gross - net`. Do not accumulate commission independently.
- [ ] 1.4 Count a day as undetermined when **any** of its channels is, and carry
      the count, not a boolean.
- [ ] 1.5 Carry each channel's `asOfAt` as the latest of its days, comparing the
      ISO-8601 strings lexicographically rather than constructing a `Date`.
- [ ] 1.6 Add `category` to the expense row shape as its own field, leaving
      `label` untouched (`design.md` D6). `effective_expenses` already exposes
      the column; no migration and no view change.
- [ ] 1.7 Do all of the above in **both** adapters —
      `src/data-access/supabase-adapters/ledger-statement.ts` and
      `src/data-access/mock/ledger-statement.ts` — from the day readings each
      already builds. **Add no new per-day query.**
- [ ] 1.8 Reduce the drawer half of the month reading to the counted / carried /
      not-tracked-yet tallies. The thirty-one-row array stops being returned.

## 2. Dates with no bills

- [ ] 2.1 Derive the unbilled dates from the thirty-one day readings the month
      already sums — a date whose cash, UPI and every channel gross are nought.
      **Issue no new query**; the earlier draft's `min(business_date)` read is
      deleted, not deferred (`design.md` D3).
- [ ] 2.2 Carry both the **count** and the **dates themselves** on the month
      reading. The surface names them; a count alone cannot.
- [ ] 2.3 Mirror it in the mock adapter, and seed the demo outlets so both a
      partly-unbilled month and a wholly-unbilled one are reachable in a demo.
- [ ] 2.4 Claim no cause. The reading says no sales were recorded for those dates
      and never why — before-billing, a closure and a broken tablet are
      indistinguishable to the app.
- [ ] 2.5 Expenses and the drawer tallies are reported for every period,
      including one with no billed date at all.

## 3. The surface

- [ ] 3.1 Rebuild `MonthReading` in
      `src/features/cash/ledger-statement-surface.tsx` as three cards in the
      deleted screen's order: **Sales breakdown**, **Expenses breakdown**,
      **Estimated profit**. Reuse its wording where the wording still holds.
- [ ] 3.2 Sales breakdown: Cash, UPI, then a block per channel with gross,
      `Less <channel> commission`, and the net. While any day is undetermined the
      labels take their *"so far"* and *"received at most"* forms and the total
      reads *"Revenue received, at most"*.
- [ ] 3.3 Carry the sentence naming how many days are still waiting and why they
      settle by themselves. It is what stops a ceiling being read as final.
- [ ] 3.4 Expenses breakdown grouped by category, every line beneath its category
      with its business date, its note, and a marker where it was not cash. Keep
      the **Manage categories** link — `ledger/categories` is still live
      (`src/routes/surfaces.tsx`) — and keep `relative="path"` on it, without
      which `..` pops both route segments and resolves to nothing.
- [ ] 3.5 Estimated profit with `cash basis operating estimate` named beneath the
      figure, plus the two standing warnings: it accounts for no equipment, and
      stock is not valued so no consumption-basis figure is offered.
- [ ] 3.6 Replace the thirty-one-row drawer list with the single line from
      `design.md` D4 — *"28 of 31 days counted, 3 carried"* — routing to the day
      view. A month wholly before the anchor says the drawer was not tracked yet
      rather than reporting nought counted.
- [ ] 3.7 Leave the **Cash out, not in operating costs** card exactly as it is,
      still outside the profit figure.
- [ ] 3.8 Render the unbilled-dates note from `design.md` D3: *"N dates had no
      sales"*, with the exact dates behind a `Why` modal
      (`src/components/ui/why.tsx`) — the chip is the button and nothing reflows.
      Place it so it qualifies **the profit figure as well as the revenue total**.
- [ ] 3.9 Where no date in the month carries a bill, state that there are no
      recorded sales for it and render **no profit figure**, with the expenses
      still listed. **A withheld figure and a ceiling must not look alike.**
- [ ] 3.10 Drop the two lines `design.md` D7 retires: *"N days recorded"* becomes
      **days with sales**, and the *"Nothing is recorded for this month"* empty
      state goes, being unreachable.
- [ ] 3.11 Update `LoadingFigures` to reserve the new shape — three cards land,
      not two.
- [ ] 3.12 No role branch. The Franchise Admin reads the same component
      (`src/gates/registry.ts`), scoped by their assignments as every other
      outlet-scoped surface is.

## 4. Tests

- [ ] 4.1 Arithmetic, as unit tests over the accumulation: a mid-month rate
      change nets each half at its own rate; an undetermined day contributes its
      gross; `gross - net` equals the commission shown; a fully settled month
      states no ceiling. Prove each fails against the wrong implementation before
      accepting it.
- [ ] 4.2 The undetermined-day **count**, not just the flag: one waiting day and
      three waiting days produce different sentences.
- [ ] 4.3 Surface tests in `src/features/cash/ledger-statement-surface.test.tsx`
      for the three cards, the ceiling wording, the category grouping, the
      one-line drawer summary, and the absence of the thirty-one rows.
- [ ] 4.4 **A partly-unbilled month gets its own test**, seeded with the first
      eleven dates carrying no bills. That is August 2026 at both outlets, and
      therefore the first month anyone opens: the note says eleven, the modal
      names all eleven dates, and the profit figure is qualified rather than only
      the revenue total (`design.md` D3).
- [ ] 4.5 A month with no billed date offers no profit figure at all, still lists
      its expenses, and is distinguishable in the DOM from a ceiling.
- [ ] 4.6 No rendered string asserts a **cause** for an unbilled date. Assert the
      absence, the way #11 asserts that no nearby instant is proposed.
- [ ] 4.7 Integer paise: a non-integer input throws rather than rounding.
- [ ] 4.8 Extend `e2e/expenses-and-ledger-reach.spec.ts` so the month view is
      reached and its profit figure asserted for both the owner and the Franchise
      Admin.
- [ ] 4.9 Confirm `supabase/tests/rest/zz-ledger-month-timing.test.ts` still
      passes and still measures a real month. The reads are unchanged, so #11's
      answer to its open question 3 should hold — assert it rather than assume it.

## 5. Spec, index and docs

- [ ] 5.1 The two deltas in `specs/` are written. Re-add `profit-estimates` to
      `openspec/specs/README.md` when it merges, or `lint:specs` fails on a
      capability with no index link.
- [ ] 5.2 `docs/SCREENS.md` — the Ledger section describes the day in detail and
      the month barely at all. Add the month: three cards, the ceiling, the
      before-billing sentence, and the one-line drawer summary.
- [ ] 5.3 `docs/GLOSSARY.md` — cash-basis operating estimate, and ceiling, if
      #51 removed either.
- [ ] 5.4 `docs/LIMITATIONS.md` — the app produces no consumption-basis figure and
      no export; revenue for a date with no bills is not recoverable, because the
      archived notebook rows are deliberately unreachable; and the reading does
      not say **why** such a date is empty, which is a stated bound rather than a
      gap to close.
- [ ] 5.5 Update `openspec/todos/owner-console-was-withdrawn.md`: its trigger
      fired, and the P&L half of it is answered here. The comparison and the
      period reports remain withdrawn.
- [ ] 5.6 Add the ROADMAP row (#52, wave E, depends on #51) and run
      `npm run roadmap:sync`. Never hand-stamp a status cell.

## 6. Verification

Against `.github/workflows/verify.yml` read rather than remembered.

- [ ] 6.1 `npm run lint`, `npm run format:check`, `npm run typecheck`,
      `npm run functions:typecheck`, `npm test`, `npm run contrast`,
      `npm run build`, `npm run test:e2e`.
- [ ] 6.2 The Docker job: `npm run db:start && npm run db:reset`, then
      `npm run test:db && npm run test:rls && npm run test:e2e:auth`, then
      `npm run db:types` and a clean `git diff --exit-code` on
      `src/data-access/database.types.ts`. No migration is added, so the diff
      must be empty — a non-empty one means something touched the schema.
- [ ] 6.3 **A UI change**: run the app and look at it, phone and tablet
      viewports, both themes.
- [ ] 6.4 **Verify the ceiling path as the normal rendering**, not the edge
      (`design.md` Risk). Swiggy's payouts query is broken pending a push, so
      recent months genuinely read *"at most"*. Seed a settled month to see the
      determined path at all.
- [ ] 6.5 Read a real month at both outlets against production data, and check the
      revenue total against the bills the counter actually rang.
- [ ] 6.6 The four-role demo walkthrough still walks.
