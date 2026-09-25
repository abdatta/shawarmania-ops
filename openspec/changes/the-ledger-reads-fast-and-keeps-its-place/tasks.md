# Tasks: the-ledger-reads-fast-and-keeps-its-place

Order matters: the timing test is rebuilt **first** and proved to fail against the
current adapter, so the speed claim is a measured before-and-after, not an
assertion written to pass.

## 1. Make the cost visible before changing it

- [ ] 1.1 Rebuild `supabase/tests/rest/zz-ledger-month-timing.test.ts` around a
  client whose `global.fetch` wrapper delays every request by 250 ms and counts
  requests (design, *Testing the round trips*). Assert a day and a month each
  settle in under 3 × 250 ms plus local overhead, and a month makes ≤ 6 requests.
  Keep the tallies and the Overview agreement assertions.
- [ ] 1.2 Run it against a freshly reset local stack **before any other task** and
  record the failing numbers (expected: ~13 round trips a day, ~600 requests a
  month) in the task note. That is the "before" half of the gate.

## 2. Server reads (migration)

- [ ] 2.1 Add a migration (`supabase/migrations/<next free timestamp>_the_ledger_reads_in_two_round_trips.sql`;
  the latest at proposal time is `20260920000000`) creating `ledger_drawer_balance_at(uuid, timestamptz)`
  per design D2 and `ledger_month_inputs(uuid, date)` per D3. Both
  `plpgsql stable security definer set search_path = ''`, both beginning with a
  raise unless `app_may_reach_drawer(p_outlet_id)` (D4); `revoke all … from public`,
  `grant execute … to authenticated`; a `comment on function` for each saying why
  it is definer-plus-assertion.
- [ ] 2.2 pgTAP (`supabase/tests/58_the_ledger_reads_in_two_round_trips.sql`):
  `ledger_drawer_balance_at` reproduces the worked example (₹1,450 left, ₹3,504
  closing), nets a collection at the count once and only once, and returns null
  before the first observation; `ledger_month_inputs` returns one element per date
  (28, 30 and 31-day months), a positive-only per-bill cash/UPI sum, a null
  commission as null with a null net, expense lines in instant order with the
  note rule, and each of the three drawer states including the anchor boundary.
- [ ] 2.3 **Isolation** in the same file: both functions called as a Franchise
  Admin for the other outlet, and as a Biller and an Employee at their own, are
  **refused** (`42501`), not answered empty; the owner and the assigned Franchise
  Admin are answered.
- [ ] 2.4 Reset the local stack, regenerate `src/data-access/database.types.ts`,
  inspect the diff, and confirm the generated-types check is clean.

## 3. The adapter

- [ ] 3.1 `LedgerStatementAdapter.getDay` / `getMonth` gain an optional
  `{ signal?: AbortSignal }`; thread `.abortSignal(signal)` through every query and
  RPC in `supabase-adapters/ledger-statement.ts`.
- [ ] 3.2 Rewrite `dayFor` into the two waves of design D1, using
  `ledger_drawer_balance_at` for opening and closing and one "last observation
  before `from`" read for coverage. Delete `balanceAt`. Every figure computed from
  the same rows by the same code as before.
- [ ] 3.3 Rewrite `getMonth` to call `ledger_month_inputs` concurrently with the
  mapping and spends reads, name the spends' recorders in a second wave, and pass
  the inputs to `readMonth` unchanged (D3). Keep `toMonthDayInput`.
- [ ] 3.4 Throw `LedgerStatementActionError('failed')` on every `{ error }` in
  both methods (D5), except when the signal is aborted, which rethrows as an abort
  the surface can recognise. Keep the mapping's empty-result fallback.
- [ ] 3.5 Adapter unit tests with a fake client: an error on *any one* of the
  day's reads rejects the whole day (parameterised over every read, so a read
  added later without a check fails the test); an aborted signal rejects as an
  abort, not as `failed`.
- [ ] 3.6 Mock adapter (`data-access/mock/ledger-statement.ts`): accept the option
  and reject as an abort when the signal is already aborted. Demo readings
  unchanged.
- [ ] 3.7 Parity (in the timing file, task 1.1): for both seeded outlets and
  August, `ledger_month_inputs` equals `toMonthDayInput(await getDay(d))` for every
  date, and `readMonth` over each is identical.

## 4. The surface

- [ ] 4.1 `ledger-statement-surface.tsx`: one `AbortController` per read effect,
  aborted in cleanup; aborts ignored (D6).
- [ ] 4.2 Readiness keyed on outlet as well as period; error cleared on any change
  of outlet, view, date or month and set only by a still-current read; `verify()`'s
  reload guarded by outlet and date and aborted by navigation (D7).
- [ ] 4.3 The outlet effect keeps the chosen date and month, clamping only past the
  new outlet's today; the linked month still wins on first resolution (D8).
- [ ] 4.4 Surface tests (`ledger-statement-surface.test.tsx`): switching outlet
  keeps a past date and a past month; a future selection is pulled back to the new
  today; a slow first outlet's reading never shows under the second; an error
  clears on the next step and does not reappear; a late verify reload does not
  replace the date stepped to; stepping away aborts the previous read. Each
  proved to fail before 4.1–4.3 land.
- [ ] 4.5 Update the surface's doc comment where it describes loading, and the
  `getMonth` comment that promised a materialised read model if the month did not
  hold.

## 5. Docs

- [ ] 5.1 `docs/LIMITATIONS.md` — rewrite *The derived ledger month is measured,
  not assumed*: the 2026-09-24 production table, why a local stack never saw it,
  and the round-trip budget with its latency-injected test.
- [ ] 5.2 `docs/TESTING.md` — the timing phase and the parity check.
- [ ] 5.3 `docs/SCREENS.md` — the Ledger paragraph: the period survives an outlet
  switch; a reading that could not be completed says so.
- [ ] 5.4 `docs/DATA_MODEL.md` — the two read functions beside the drawer's
  existing ones.

## 6. Gates

- [ ] 6.1 `npm run format`, then `npm run lint`, `npm run format:check`,
  `npm run typecheck`, `npm run functions:typecheck`, `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [ ] 6.2 `npm run test:db` and `npm run test:rls` on a freshly reset stack
  (it is shared; reset again if another session touched it mid-run). Record the
  timing phase's "after" numbers beside task 1.2's "before".
- [ ] 6.3 Browser check on the local build as the owner with two outlets, phone
  and desktop, light and dark: step days and months quickly, switch outlet on a
  past date and a past month, and confirm no stale figures, no stuck skeleton, no
  lingering error, zero console errors.
- [ ] 6.4 GATE — the proposal's Gate line proved literally, clause by clause,
  naming what proved each. The production timings are taken only after the owner
  picks the deploy window (**no push while the counter trades**), in the owner's
  own browser, repeating the 2026-09-24 table. This change carries no ROADMAP.md
  row on purpose; do not run `roadmap:sync` expecting one, and do not archive
  until the owner has used it in production and calls it.
