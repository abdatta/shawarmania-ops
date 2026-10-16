# Tasks: revenue-reads-the-same-everywhere

Read `proposal.md` and `design.md` first. The decisions (D1–D9) and the rejected
alternatives are there; do not reopen them without a reason the design did not
consider. The off path is today's code, untouched: every screen edit below is a
new branch taken only when `useChangeGate('one-revenue')` is true, and every
database object is new.

## 0. Before anything

- [x] 0.1 Branch from `origin/stage`, not `main`. Re-read the newest migration on
  `stage` and take the next free timestamp (after `20261024000000` when this was
  written).
- [x] 0.2 Count the live change gates that depend on nothing
  (`MAX_ROOT_GATES` in `scripts/check-change-gates.mjs`, 5). If five are still
  declared, sections 2–4 can proceed and section 1's declaration waits for a
  root retirement to land on `stage` (design D9). Do not make `one-revenue`
  depend on another gate to fit.

## 1. The gate, off

- [x] 1.1 Declare `one-revenue` in `src/change-gates/gates.ts`: `kind: 'change'`,
  `code: 'RV'` (re-check it is unused), `change:
  'revenue-reads-the-same-everywhere'`, no `dependsOn`, `retireBy` about eight
  weeks after it is first turned on, `roundTrip: 'none: every figure is read and
  derived; the on path writes nothing'`. A doc comment in the file's voice.
- [x] 1.2 Migration (`supabase/migrations/<timestamp>_revenue_reads_the_same_everywhere.sql`),
  first statement: insert the `change_gates` row, off, with title *One revenue*,
  `on_means` and `off_means` word for word from the proposal's Change gate
  section, `change_name`, and `change_number` 76.
- [x] 1.3 Add the gate's words to `WORDS` in `src/data-access/mock/change-gates.ts`.
- [x] 1.4 Run `npm run lint:migrations` and `npm run lint:change-gates`, and the
  change-gate suite (`vitest.change-gates.config.ts`): the row reads back off.

## 2. The definitions, pure (D1–D3)

- [x] 2.1 Failing tests first, `src/domain/revenue-figures.test.ts`:
  - `monthToDate(today)` and `comparisonWindow(from, to, align)`: 15 Oct → 1–15
    Oct against 1–15 Sep; 31 Oct against whole September, uncut; 30 Mar against
    whole February; 1 Oct against 1 Sep; a whole September against a whole
    August; `equal` windows unchanged from today's arithmetic.
  - `cutInstant(today, matchedDate, now, cutover)`: 15:40 on 15 Oct → 15:40 on 15
    Sep; 02:30 after midnight on a 04:00 cutover lands after midnight on the
    matched date; null when the matched date was clamped.
  - `readMonthFigures(days, reading)`: revenue gross; commission per channel-day;
    a ₹0 / −₹611.07 day adds ₹611.07 commission and ₹0 revenue; a waiting day
    adds gross revenue, no commission, and counts as waiting; profit equals
    `reading.profitPaise` for a settled month and for a month with waiting days
    (D1's equality); Delivery commission lines carry their date and channel and
    sort among categories by amount; non-integer input throws.
- [x] 2.2 Implement them in `src/domain/revenue-figures.ts`, exported through
  `src/domain/index.ts`. `readMonth` and `ledger-month.ts` are not edited.
- [x] 2.3 Prove the tests bite: break the per-day commission (sum monthly gross −
  net instead) and the clamp rule, and watch them fail; restore. *Done as it
  happened, 2026-10-16:* the clamp test caught a real bug first (a whole October
  against September was being cut), fixed in `monthBack`. The per-day
  commission has no wrong twin to break: with commission stated as an amount, a
  monthly gross − net equals the per-day sum by arithmetic (a waiting day adds its
  gross to both). The tests pin the figures, the charge-only day included.

## 3. The demo, and the owner's approval

- [x] 3.1 Extend the shared demo fixture so one outlet's current month carries a
  stated delivery day, a waiting day and a charge-only day, plus last month's
  same dates with bills across the cut hour, so every rule is visible.
- [x] 3.2 Typed adapter methods in `src/data-access/overview.ts`
  (`today`, `month`), `analytics.ts` (`read` gains `align` and `cut`), with the
  mock adapters answering from the fixture through the 2.x functions. A unit test
  asserts the demo's Overview month, Ledger month fold and Analytics Month totals
  are equal.
- [x] 3.3 Gated surfaces against the demo:
  - Overview (D5): Today's revenue with Cash · UPI · Delivery; month revenue
    with the always-on change, `No sales 1–15 Sep`, and the *to 3:40 pm*
    tooltip and accessible name; P&L with expenses including commission and its
    margin; header *Month to date*; the today link to the Ledger day. Reshape the
    card shimmer if the subtext moved.
  - Ledger day and month (D6): Revenue rows, the Delivery commission lines and
    category, *Received after commission*, *Estimated profit* and the waiting
    line; the ceiling words gone on this path; today resolved through the
    outlet's cutover.
  - Analytics (D7): `1d · 7d · Month`, `align=month` in the address, month
    stepping, the headline and dish changes reading `totals`, the cut legend on
    an earlier period's total.
- [x] 3.4 **STOP for the owner.** *Approved 2026-10-16, with the changes recorded in
  design (labels in brackets, the vs line, Items cut, the today line).* Capture the demo with the gate on: Overview at
  mid-month and on the 1st, the Ledger day with a commission line, the Ledger
  month with a waiting day, Analytics Sales on Month with three comparisons, and
  1d at mid-afternoon, on a phone, light and dark. Send them. Apply what the owner
  changes and record it in `design.md`. Nothing in section 4 is wired live until
  the owner approves.

## 4. The database (D5, D7, D8)

- [x] 4.1 In the same migration as 1.2: `revenue_figures` (internal, granted to
  no role), `overview_today`, `overview_month`, `sales_analytics_v2`, as design
  D5 and D7 specify. Each public function starts with the authority check of the
  function it replaces. `security definer`, `search_path = ''`. Run
  `npm run lint:migrations`.
- [x] 4.1a `sales_analytics_series_v2`: `sales_analytics_series` plus a `p_cut` flag
  and a `totals` key (each window's items and dish revenue, cut as D3), for Items'
  headline (design D7).
- [x] 4.2 pgTAP, `supabase/tests/<next>_revenue_reads_the_same_everywhere.sql`:
  - the D1 definitions on a seeded month: a voided bill, a corrected payment, a
    stated, a waiting and a charge-only delivery day, recorded expenses;
  - `overview_month`'s revenue, commission, expenses and profit equal the sum of
    `sales_analytics_v2`'s `totals` for the same window;
  - profit equals `overview_revenue` − `overview_expenses` on the same period
    (D1's equality);
  - the cut: a bill ordered before and one after the cut on the matched date; the
    matched date's delivery counted only with today's delivery present; clamped
    windows uncut; `equal` windows equal `sales_analytics`' day for day;
  - **isolation**: a Franchise Admin's crafted request for another outlet is
    refused by `overview_today`, `overview_month` and `sales_analytics_v2`; a
    Biller, an Employee and anonymous are refused; `revenue_figures` is not
    executable by `authenticated`.
- [x] 4.3 `npm run db:types`; check the diff carries only the new functions (and
  no telemetry line).
- [x] 4.4 Live adapters in `src/data-access/supabase-adapters/overview.ts` and
  `analytics.ts`, with fail-closed validation like `analyticsSnapshot`; unit
  tests for the mapping.
- [x] 4.5 The three-surface parity test (D8) in the DB suite beside the Ledger's
  existing day/month parity (`src/data-access/supabase-adapters/ledger-statement.test.ts`):
  fold `ledger_month_inputs` with `readMonthFigures` and assert revenue,
  commission, expenses and profit equal `overview_month`'s and the
  `sales_analytics_v2` totals', to the paisa.

## 5. Both ways

- [x] 5.1 Component tests for each toggle point under `describeChangeGate('one-revenue', …)`:
  off renders exactly today's tiles, words and links; on renders D5–D7.
- [x] 5.2 Browser tests: tag the existing Overview, Ledger month and Analytics
  preset tests the change contradicts `@cg-off:one-revenue` (no other edit), and
  add `@cg-on:one-revenue` tests: the three surfaces agree for one outlet and
  month; Overview shows no delivery qualifier with sparse delivery; Month steps
  by calendar month.
- [x] 5.2a Today's revenue opens Billing history again, as Today's counter
  sales did: the owner, once the gate was on in production, called the move to
  the Ledger unintended (2026-10-16). The on path's link, its browser test and
  a unit test that fails with the Ledger link; design, spec and SCREENS say so.
- [ ] 5.3 Confirm the counter and kitchen request budget
  (`e2e-auth/request-budget.spec.ts`) is unchanged, with the gate on and off.

## 6. Close

- [x] 6.1 Update `docs/GLOSSARY.md` (Revenue, Commission, Month to date,
  Comparison; the Cash sales entry's `payment_business_date` sentence),
  `docs/SCREENS.md` (Overview, Ledger day and month, Analytics),
  `docs/DATA_MODEL.md`, `docs/DEMO_MODE.md`, `docs/TESTING.md` and
  `docs/LIMITATIONS.md`, as the proposal lists.
- [ ] 6.2 Run every gate `.github/workflows/verify.yml` runs locally that can run
  here (quick and DB tiers), then push to `stage` and let Staging run the browser
  suites both ways.
- [ ] 6.3 PHASE GATE: roadmap #76's checkpoint. The owner approved the three
  screens from demo screenshots before they were wired live. With `one-revenue`
  on, Overview's month, the Ledger's month and Analytics' Month give the same
  revenue for one outlet and month to the paisa, and Overview and the Ledger the
  same expenses and profit. Revenue counts delivery before commission, and
  commission is a Delivery commission expense on its own date. The month runs
  through today, and the comparison with the same dates last month, up to the
  same time, always shows. No "Delivery data incomplete" or "Commission pending"
  appears on Overview. Analytics offers Month in place of 30 days. A manager's
  crafted request for another outlet is refused by every new read. With the gate
  off every screen reads as before. The gate was turned on in production, pulled
  once and turned back on. The four-role demo walkthrough still walks.
