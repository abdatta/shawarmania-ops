# Tasks: the-ledger-reads-fast-and-keeps-its-place

Order matters: the timing test is rebuilt **first** and proved to fail against the
current adapter, so the speed claim is a measured before-and-after, not an
assertion written to pass.

## 1. Make the cost visible before changing it

- [x] 1.1 Rebuild `supabase/tests/rest/zz-ledger-month-timing.test.ts` around a
  client whose `global.fetch` wrapper delays every request by 250 ms and counts
  requests (design, *Testing the round trips*). Assert a day and a month each
  settle in under 3 × 250 ms plus local overhead, and a month makes ≤ 6 requests.
  Keep the tallies and the Overview agreement assertions.
- [x] 1.2 Run it against a freshly reset local stack **before any other task** and
  record the failing numbers (expected: ~13 round trips a day, ~600 requests a
  month) in the task note. That is the "before" half of the gate.
  *Before (2026-09-25, 250 ms a request):* Kalyani day 3,349 ms in 22 requests,
  month 4,122 ms in 332; Kanchrapara day 3,009 ms in 21, month 3,986 ms in 331 —
  both fail the 750 ms budget. **The seed carries no drawer count and is dated
  relative to the day it loads**, so a fixed August measured an empty month (8
  requests a day, no balance reads). The file now reads the seed's own recent
  dates and records an anchor and a count per outlet through
  `record_drawer_observation`, removed afterwards with the service-role key the
  phase now discovers, as the drawer-writes phase does.

## 2. Server reads (migration)

- [x] 2.1 Add a migration (`supabase/migrations/<next free timestamp>_the_ledger_reads_in_two_round_trips.sql`;
  the latest at proposal time is `20260920000000`) creating `ledger_drawer_balance_at(uuid, timestamptz)`
  per design D2 and `ledger_month_inputs(uuid, date)` per D3. Both
  `plpgsql stable security definer set search_path = ''`, both beginning with a
  raise unless `app_may_reach_drawer(p_outlet_id)` (D4); `revoke all … from public`,
  `grant execute … to authenticated`; a `comment on function` for each saying why
  it is definer-plus-assertion.
- [x] 2.2 pgTAP (`supabase/tests/58_the_ledger_reads_in_two_round_trips.sql`):
  `ledger_drawer_balance_at` reproduces the worked example (₹1,450 left, ₹3,504
  closing), nets a collection at the count once and only once, and returns null
  before the first observation; `ledger_month_inputs` returns one element per date
  (28, 30 and 31-day months), a positive-only per-bill cash/UPI sum, a null
  commission as null with a null net, expense lines in instant order with the
  note rule, and each of the three drawer states including the anchor boundary.
- [x] 2.3 **Isolation** in the same file: both functions called as a Franchise
  Admin for the other outlet, and as a Biller and an Employee at their own, are
  **refused** (`42501`), not answered empty; the owner and the assigned Franchise
  Admin are answered.
- [x] 2.4 Reset the local stack, regenerate `src/data-access/database.types.ts`,
  inspect the diff, and confirm the generated-types check is clean.

## 3. The adapter

- [x] 3.1 `LedgerStatementAdapter.getDay` / `getMonth` gain an optional
  `{ signal?: AbortSignal }`; thread `.abortSignal(signal)` through every query and
  RPC in `supabase-adapters/ledger-statement.ts`.
- [x] 3.2 Rewrite `dayFor` into the two waves of design D1, using
  `ledger_drawer_balance_at` for opening and closing and one "last observation
  before `from`" read for coverage. Delete `balanceAt`. Every figure computed from
  the same rows by the same code as before.
- [x] 3.3 Rewrite `getMonth` to call `ledger_month_inputs` concurrently with the
  mapping and spends reads, name the spends' recorders in a second wave, and pass
  the inputs to `readMonth` unchanged (D3). Keep `toMonthDayInput`.
- [x] 3.4 Throw `LedgerStatementActionError('failed')` on every `{ error }` in
  both methods (D5), except when the signal is aborted, which rethrows as an abort
  the surface can recognise. Keep the mapping's empty-result fallback.
- [x] 3.5 Adapter unit tests with a fake client: an error on *any one* of the
  day's reads rejects the whole day (parameterised over every read, so a read
  added later without a check fails the test); an aborted signal rejects as an
  abort, not as `failed`.
- [x] 3.6 Mock adapter (`data-access/mock/ledger-statement.ts`): accept the option
  and reject as an abort when the signal is already aborted. Demo readings
  unchanged.
- [x] 3.7 Parity (in the timing file, task 1.1): for both seeded outlets and
  August, `ledger_month_inputs` equals `toMonthDayInput(await getDay(d))` for every
  date, and `readMonth` over each is identical.

## 4. The surface

- [x] 4.1 `ledger-statement-surface.tsx`: one `AbortController` per read effect,
  aborted in cleanup; aborts ignored (D6).
- [x] 4.2 Readiness keyed on outlet as well as period; error cleared on any change
  of outlet, view, date or month and set only by a still-current read; `verify()`'s
  reload guarded by outlet and date and aborted by navigation (D7).
- [x] 4.3 The outlet effect keeps the chosen date and month, clamping only past the
  new outlet's today; the linked month still wins on first resolution (D8).
- [x] 4.4 Surface tests (`ledger-statement-surface.test.tsx`): switching outlet
  keeps a past date and a past month; a future selection is pulled back to the new
  today; a slow first outlet's reading never shows under the second; an error
  clears on the next step and does not reappear; a late verify reload does not
  replace the date stepped to; stepping away aborts the previous read. Each
  proved to fail before 4.1–4.3 land.
  *Proved by swapping in the pre-change surface:* six of the seven fail there.
  The seventh — a future selection pulled back to the new outlet's today —
  passes on the old surface too, because it reset every switch to today; it
  guards the new keep-your-place logic rather than proving an old defect. The
  adapter's one-failed-read cases likewise fail against the pre-change adapter
  for every read it left unchecked.
- [x] 4.5 Update the surface's doc comment where it describes loading, and the
  `getMonth` comment that promised a materialised read model if the month did not
  hold.

## 4b. The same place kept on every surface with a period (folded in 2026-09-25)

- [x] 4b.1 `carryPeriod` in `src/domain/datetime.ts`, exported from `@/domain`,
  with unit cases: nothing chosen, on the previous today, past the new today, an
  earlier date kept, a month key carried the same way.
- [x] 4b.2 Ledger: carry `businessDate` and `monthKey` through `carryPeriod`
  (today follows today), with a surface test for an outlet whose today is later.
- [x] 4b.3 Billing history (`manager-billing-history.tsx`): `chosenDay` carries
  the today it was chosen against rather than the outlet; test that a past date
  survives a switch.
- [x] 4b.4 Expenses (`outlet-expenses-surface.tsx`): the outlet effect carries the
  chosen date; test that a past date survives a switch.
- [x] 4b.5 Attendance day view (`outlet-attendance.tsx`): lift the chosen date out
  of the re-keyed `OutletAxis`; test that a past date survives a chip change and
  that the approval selection is still emptied by it.
- [x] 4b.6 Each new surface test proved to fail against the pre-change surface.

## 7. Round two: what production showed after the first deploy (2026-09-25)

- [x] 7.1 Migration: re-create `effective_bill_payments` per design D10;
  `billing_commands_outlet_received_idx` per D11; `ledger_day_takings` per D12.
- [x] 7.2 pgTAP: the rewritten view returns what the previous definition returned
  on a fixture with an uncorrected bill, a corrected one and a twice-corrected one;
  `ledger_day_takings` matches the per-bill rule and refuses a reader the drawer
  does not admit; the index exists.
- [x] 7.3 Outlets adapter cache per D9: answered at once and refreshed behind,
  replaced on write, emptied when the signed-in user changes. Unit tests for each,
  including a second user never receiving the first user's row.
- [x] 7.4 Ledger day in one wave per D12; adapter unit tests updated (one wave,
  every read still failing the whole day); the timing test's day budget tightened
  to two round trips' time.
- [x] 7.5 Drawer `getState` in three waves per D13; its tests still green, and the
  acknowledgements read now fails loudly.
- [x] 7.6 Regenerate types; full gate (`verify.yml`'s jobs, fresh stack for the
  database suites).
  *2026-09-25/26:* lint, format, types, functions, contrast, build; 1,924 unit;
  284 e2e; `test:db` on a fresh reset; all six `test:rls` phases (a Ledger day
  now 305–377 ms at 250 ms a request, one wave; a month 278–285 ms in 3);
  31 auth e2e. The migration is dated after the gold change's `20260926000000`,
  which reached production first.
- [x] 7.8 Docs: `docs/DATA_MODEL.md` (the takings function, the view's shape and
  the index) and `docs/LIMITATIONS.md` (round two's measurements and remedies).
- [x] 7.7 After the owner's deploy: remeasure on production in the owner's browser
  — tap Ledger, step a day, switch outlet, month; tap Billing history; tap Drawer.
  *Measured 2026-09-26, production, owner's Edge, on the new build:* tap Ledger
  0.56 s (was 1.6 s); a day step 0.38–0.44 s over five (was 1.1–1.3 s, and ~4 s
  before round one); an outlet switch 0.38–0.44 s with the date kept; the month
  0.40–0.76 s; Billing history settled 1.0 s (was 1.8 s; the delivery log 0.53 s,
  was 1.43 s); the Drawer 1.4 s (was 4.2 s); Expenses 0.38 s (was 0.68 s). The
  Ledger's reads now start ~70 ms after the tap, with the outlet read running
  alongside rather than ahead.

## 8. Round three: Billing history and the Drawer (2026-09-26)

- [x] 8.1 Migration: `orders_pipeline_idx` and `bills_settled_recent_idx` per D14;
  `billing_history_day_extras` per D15; `drawer_recent_cash_bills` per D16.
- [x] 8.2 pgTAP: both functions return what the reads they replace return, on a
  fixture with a corrected bill, and nothing of another outlet to a Franchise
  Admin; both indexes exist.
- [x] 8.3 Billing adapter: the manager history read runs the day extras alongside
  the bills; the counter's reads are unchanged. Tests.
- [x] 8.4 Drawer adapter: the recent and late bills come from
  `drawer_recent_cash_bills` in the second wave. Its REST suite stays green.
- [x] 8.5 Full gate; after the owner's deploy, remeasure Billing history and the
  Drawer on production.
  *Gate 2026-09-26:* lint, format, types, functions, contrast, build; 1,925 unit;
  284 e2e; `test:db` on a fresh reset (with `60_…`); all six `test:rls` phases;
  31 auth e2e.
  *Production, 2026-09-26, after 8.6 shipped (the publish step was re-run once
  for a GitHub OIDC timeout):* Billing history settled 0.39–0.65 s (1.0 s before
  round three, 2.1 s while it was wrong), all in one wave; the Drawer
  0.74–0.86 s (was 1.4 s).

- [x] 8.6 Correct round three after production showed it slower (design D17): the
  two functions filter by an id list (`20260926030000_…`), checked on production
  data as identical to the shipped ones and 14/11 ms against ~390; the extras
  request is started where it is created, pinned by a test that fails on the
  shipped adapter.

## 9. Round four: the Drawer shows each part as it arrives (2026-09-26)

- [x] 9.1 Adapter interface: `DrawerBalance`, `getBalance`, `getExceptions`; the
  arithmetic helpers take `DrawerBalance`.
- [x] 9.2 Supabase adapter per D18: recent counts in one round trip, balance and
  exceptions in two; `getState` composed from them. Its REST suite stays green.
- [x] 9.3 Mock adapter: the same three reads, from its existing state.
- [x] 9.4 Surface per D18/D19: three readings keyed to the outlet, each part and
  its placeholder independent, Count & Collect gated on the balance only, paging
  from `listObservations`'s own `hasMore`.
- [x] 9.5 Surface tests: the balance shows while the counts are still reading and
  the reverse; a failed part says so in place and leaves the others; the
  placeholders are the parts' own shapes. Existing tests moved off `getState`.
- [x] 9.7 `docs/SCREENS.md` — the Cash drawer paragraph: each part appears when
  its own reading does, behind a placeholder in its own layout.
- [x] 9.6 Browser check in both themes at phone width; full gate; after deploy,
  measure when each part appears on production.
  *Done locally 2026-09-26:* the placeholders were photographed against the real
  parts at phone width in both themes, using a throwaway build whose demo reads
  never finish (reverted before anything was committed). The balance placeholder
  matches the card's height exactly; the count rows' placeholder was reshaped to
  the closed row's three lines after that comparison. Gate: 1,929 unit, 284 e2e,
  `test:db`, all six `test:rls` phases, 31 auth e2e.
  *Production, 2026-09-26, after the 9.8 hotfix, five taps:* the recent counts
  appeared at 0.45–0.50 s (everything used to wait for ~0.8 s); the balance and
  Count & Collect at ~0.81 s in four of five, the fifth 3.35 s when three
  unrelated requests stalled together for ~2.5 s. The balance is still two
  waves; making it one is the remaining lever.

- [x] 9.8 Hotfix after round four shipped (2026-09-26): production showed "Could
  not read the recent counts". The surface asks for the first page as
  `listObservations(outletId)` with no query, and the real adapter's reader
  took the query without a default, so it threw before any request went out;
  the demo adapter had the default, so every surface test passed. Defaulted,
  and pinned by `cash-drawer.test.ts`, which calls the real adapter as the
  surface does and fails on the shipped code. **The lesson: a surface test
  over the demo adapter proves nothing about the real adapter's signature —
  a new call shape needs a test against the real adapter too.**

## 5. Docs

- [x] 5.1 `docs/LIMITATIONS.md` — rewrite *The derived ledger month is measured,
  not assumed*: the 2026-09-24 production table, why a local stack never saw it,
  and the round-trip budget with its latency-injected test.
- [x] 5.2 `docs/TESTING.md` — the timing phase and the parity check.
- [x] 5.3 `docs/SCREENS.md` — the Ledger paragraph: the period survives an outlet
  switch; a reading that could not be completed says so.
- [x] 5.5 `docs/SCREENS.md` — the outlet-switcher paragraph: every surface with a
  period keeps it across a switch, today following today.
- [x] 5.4 `docs/DATA_MODEL.md` — the two read functions beside the drawer's
  existing ones.

## 6. Gates

- [x] 6.1 `npm run format`, then `npm run lint`, `npm run format:check`,
  `npm run typecheck`, `npm run functions:typecheck`, `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
  *2026-09-25:* all green — 1,893 unit tests, 284 e2e; plus
  `npm run test:e2e:auth` (28), which `verify.yml` also runs.
  *Re-run after 4b:* 1,902 unit, 284 e2e, 28 auth e2e. The first auth run
  failed two counter-billing specs on rows an earlier run had left in the shared
  local stack; after `supabase db reset` all 28 passed, and nothing in 4b touches
  the counter.
- [x] 6.2 `npm run test:db` and `npm run test:rls` on a freshly reset stack
  (it is shared; reset again if another session touched it mid-run). Record the
  timing phase's "after" numbers beside task 1.2's "before".
  *After (250 ms a request):* Kalyani day 578 ms in 14 requests, month 269 ms
  in 3; Kanchrapara day 572 ms in 13, month 287 ms in 3 — against 3,349 /
  4,122 ms and 3,009 / 3,986 ms before. `test:db` 64 files, 2,503 assertions;
  `test:rls` all six phases green; the generated types differ from HEAD only by
  the three new functions.
- [x] 6.3 Browser check on the local build as the owner with two outlets, phone
  and desktop, light and dark: step days and months quickly, switch outlet on a
  past date and a past month, and confirm no stale figures, no stuck skeleton, no
  lingering error, zero console errors.
  *Done in demo mode on the production build* (`/demo/owner/ledger`): the
  live path is covered by the REST phase, and signing in is not something the
  agent does. Three quick steps back, a switch to Kanchrapara (22 Sept kept,
  Kanchrapara's own figures), a month two back kept across a switch the other
  way, both themes at phone width, no application console errors.
- [x] 6.4 GATE — the proposal's Gate line proved literally, clause by clause,
  naming what proved each. The production timings are taken only after the owner
  picks the deploy window (**no push while the counter trades**), in the owner's
  own browser, repeating the 2026-09-24 table. This change carries no ROADMAP.md
  row on purpose; do not run `roadmap:sync` expecting one, and do not archive
  until the owner has used it in production and calls it.
  *Proved 2026-09-26 on production:* a day step 0.38–0.44 s (< 1.5 s) and a month
  0.40–0.76 s (< 3 s), in the owner's browser; one round trip a day and at most two
  a month (timing phase and adapter tests); superseded reads aborted and failures
  never rendered as nought (surface and adapter tests, each failing on the old
  code); errors withdrawn on navigation and no cross-outlet figures (surface
  tests); the date and month kept across a switch on production and on all four
  surfaces (tests); month/day parity to the paisa (timing phase, proved to bite).
  Not archived: the owner calls that after real use.