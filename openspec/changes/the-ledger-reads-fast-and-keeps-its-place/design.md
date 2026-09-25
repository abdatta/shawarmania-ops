# Design: the-ledger-reads-fast-and-keeps-its-place

## Context

Measured on production on 2026-09-24 (proposal, *Why*): one request costs ~300 ms
regardless of its work, a day makes 13 sequential round trips (4–5 s) and a month
fires ~600 requests (15–16.5 s, p95 1.8 s, slowest 9 s). The per-request waterfall
of one day step, as recorded that day:

```
wave 1   0 →  370 ms   bills, effective_expenses, aggregator_channel_days,
                       drawer_observations ×2, drawer_cash_out, verifications
         373 → 1109    effective_bill_payments          (needs bill ids)
        1112 → 1405    profiles                         (needs every recorder id)
        1408 → 1703    drawer_observation_adjustments   (needs observation ids)
        1706 → 2070    drawer_observations  last confirmed
        2075 → 2406    drawer_observations  previous to the covering count
        2408 → 3012    balanceAt(opening): observation → own cash out → 3 RPCs
        3015 → 3931    balanceAt(closing): the same again, after the opening
```

Everything below the first wave is sequential only because it is written with
one `await` after another in `supabase-adapters/ledger-statement.ts`. Most of it
depends on nothing but the first wave, or on nothing at all.

## Decisions

### D1. A day is two waves

**Wave 1**, all at once:

- the seven existing reads (bills, expenses, channel days, the day's
  observations, the day's cash out, the anchor, verifications);
- **the last observation before `from`** (one row). This single read replaces two
  of today's sequential lookups: the observation "previous to the covering count"
  is by definition the last one before the day starts, because the covering count
  is the day's first observation. (`observationCoversDays` is computed from it
  exactly as now.)
- **the last confirmed instant** — today it waits on the anchor only to decide
  whether to run; it is one row and simply runs, its result ignored before the
  anchor;
- **the drawer balance at `from` and at `to`** through the new server read (D2),
  one request each, concurrently.

**Wave 2**, all at once, from wave 1's rows: the payment allocations for the day's
bills, the names for every recorder id, and the adjustments for the day's
observations. Skipped individually when there is nothing to ask for, exactly as
now.

Two sequential round trips, ~600–700 ms on the 2026-09-24 connection, against
4–5 s. The figures are unchanged, because every value is computed from the same
rows by the same code; only the scheduling moves.

### D2. The drawer balance at an instant is one server read

`ledger_drawer_balance_at(p_outlet_id uuid, p_at timestamptz) returns bigint`
(null before any observation). Its body is `balanceAt` as it stands in the
adapter: the last observation at or before `p_at`, its own cash out netted by
`nextOpeningPaise`'s rule (`counted_total − own cash out`), plus
`drawer_cash_receipts_paise`, minus `drawer_cash_expenses_paise`, minus
`drawer_cash_out_paise` excluding that observation's own movements. It is the same
arithmetic `overview_drawer` already runs server-side against `now()`; this is
that function with the instant as a parameter.

**Money arithmetic, called out:** integer paise throughout (`bigint`), no
division, no rounding. The one rule that must survive the move is that the
observation's *own* cash out is subtracted from the counted total and then
excluded from the interval's cash out, so it is not taken twice. A pgTAP case
pins the worked example (₹1,450 left, ₹3,504 closing) and a collection at the
count.

### D3. A month is one server read of exactly what the month uses

`ledger_month_inputs(p_outlet_id uuid, p_month date) returns jsonb` — an array of
one object per date of the month, each shaped as `MonthDayInput` in
`src/domain/ledger-month.ts`:

- `cashPaise` / `upiPaise` — from `effective_bill_payments` over **settled** bills
  of that `business_date`, summed per bill and a bill's total counted only where
  positive, which is what the adapter does today;
- `discountPaise` — `bills.discount_paise` over the same settled bills;
- `channels` — each `aggregator_channel_days` row: gross = `revenue_paise`,
  commission as stored (null stays null), net null whenever commission is null
  and otherwise `coalesce(net_paise, revenue_paise − commission_paise)`,
  `asOfAt = coalesce(as_of_at, updated_at)`;
- `expenses` — every `effective_expenses` row, in instant order
  (`coalesce(occurred_at, created_at)`), with `category = coalesce(category,
  'Expense')`, `note` null where `coalesce(description, category, 'Expense')`
  equals that category and that label otherwise, `isCash = coalesce(is_cash,
  false)`, `amountPaise = coalesce(amount_paise, 0)`;
- `drawerState` — `not-tracked-yet` where there is no anchor or the date's upper
  bound is at or before it, `counted` where an observation falls in
  `[from, to)`, `carried` otherwise.

Date bounds use **the same 04:00 +05:30 constant** as the day reader
(`dayBounds`). Only `drawerState` uses them; every other field keys on the
explicit `business_date` column, as the non-negotiable requires.

The adapter's `getMonth` then runs, concurrently with this call, the two reads it
already makes (the outlet's channel mapping and the month's spends), names the
spends' recorders in a second wave, and hands the inputs to `readMonth`
unchanged. Two sequential round trips; three requests plus one.

`toMonthDayInput` stays — the mock adapter and the parity test use it.

### D4. Both functions follow Overview's shape for tenancy

`language plpgsql stable security definer set search_path = ''`, beginning with an
assertion that **raises** unless `app_may_reach_drawer(p_outlet_id)` — the
predicate every drawer and `ledger_day_verifications` policy already uses, so the
reach is exactly the drawer's: the owner anywhere, a Franchise Admin at their live
assignments, nobody else. `revoke all … from public`, `grant execute … to
authenticated`.

**RLS, called out:** these are security-definer, so RLS does not filter inside
them; the assertion is the boundary. A definer function that forgot it would read
any outlet. That is why the isolation tests (tasks) call both functions as a
Franchise Admin for **the other outlet**, as a Biller and as an Employee at their
own, and assert each is **refused** — not answered with an empty month, which is
indistinguishable from a quiet one.

Security invoker was considered (below) and rejected for that reason.

### D5. A reading either completes or throws

Every `{ error }` a read returns is thrown as a `LedgerStatementActionError`
(`failed`), in both waves, in the balance reads and in `getMonth`'s extra reads.
There is no read on the ledger whose failure may be rendered, because every one of
them feeds a figure, a section or a word on the page.

The one deliberate empty that stays is the channel mapping: RLS returns a Franchise
Admin **no rows and no error**, and the month's existing fallback to every known
channel is written for exactly that. An *error* on that read now throws.

### D6. Reads are cancelled when the reader moves on

`getDay` and `getMonth` take an optional `{ signal?: AbortSignal }` and pass it to
every request via supabase-js's `.abortSignal(signal)` (and to `rpc(...)`
likewise). The surface creates an `AbortController` per effect and aborts it in
the effect's cleanup, which runs on a date, month, view or outlet change. An
aborted read's rejection is recognised and ignored — it is not an error the reader
caused or needs to see.

The mock adapter accepts the option and rejects with an abort when the signal is
already aborted, so the surface's tests exercise the same path.

### D7. The surface keys every reading on outlet and period, and every error on its reading

- `dayReady` requires `day.outletId === outletId` as well as the date;
  `monthReady` likewise. The reading types already carry `outletId`.
- `error` is cleared whenever outlet, view, date or month changes, before the new
  read starts. It is set only by a read still current when it fails.
- `verify()`'s reload is guarded the same way: it publishes only if outlet and
  date are still what they were when it started, and it passes a signal that the
  next navigation aborts.

### D8. The period survives an outlet switch, on every surface that has one

One rule, one function: `carryPeriod(chosen, previousToday, nextToday)` in
`src/domain/datetime.ts`. It returns the new outlet's today when nothing was
chosen, when the choice *was* the previous outlet's today, or when the choice lies
past the new today; otherwise the choice. It compares ISO strings, so the same
function carries a date or a month key.

- **Ledger.** The outlet effect remembers the today it last resolved and carries
  both `businessDate` and `monthKey` through `carryPeriod`. A linked month still
  wins when the link is new.
- **Billing history.** `chosenDay` stops carrying the outlet it was picked at —
  that is what made a switch fall back to today — and carries the today it was
  picked against instead. The date is derived, with no effect, as it already was.
- **Expenses.** The outlet effect carries the previous context's `businessDate`
  through `carryPeriod` rather than overwriting it with the new today.
- **Attendance, day view.** `OutletAxis` is re-keyed on the outlet set on purpose:
  that remount is what empties a half-built approval selection, and it stays. The
  date is lifted out of it — the parent holds the reader's choice and the today
  it was made against, and the remounted axis opens on `carryPeriod` of that.
- **Attendance, person view** already keeps its month, and is unchanged.

Drawer, Menu, Delivery and Tablets have an outlet picker and no period, and are
untouched.

**Why "on today follows today".** Two outlets' todays differ only while their
cutovers straddle the moment, but in that window a reader on Kalyani's today who
switches to Kanchrapara means Kanchrapara's today. Keeping the literal date would
open them on a day that is already over there, or refused as future.

## Round two (2026-09-25)

Measured on production after round one shipped; the proposal carries the table.

### D9. Outlet rows are remembered for the signed-in person, and refreshed behind

`createSupabaseOutletsAdapter` keeps the rows it has read — from `listOutlets` or
`getOutlet` — and answers `getOutlet` from them at once, **refreshing in the
background on every call** so a cutover edited elsewhere reaches the next read.
A write through the adapter (create, update, location, delete) replaces or drops
the row immediately.

**Keyed on the signed-in user, not on the adapter.** The adapter set is built
once per app session (`real-root.tsx`) and outlives a sign-out; a cache that did
too would answer the next person on a shared phone with the last person's
outlets. The key is the session's user id, read locally from supabase-js without
a request, and a different id empties the cache.

What is cached is an outlet's own row — name, cutover, address — never a figure,
and RLS decided what reached it. `listOutlets` is not answered from the cache:
the picker's list is where a newly created outlet or a lost assignment must show,
and it is one parallel request that costs nothing a reader waits on.

**Only answers that are safe to be a request stale.** A cutover edited on another
device reaches the next `getOutlet` after the background refresh lands, and a
full reload always reads fresh. The cutover field's own copy already says a new
cutover applies to the next day resolved.

### D10. The payment view looks corrections up per bill

`effective_bill_payments` is re-created with the same columns, the same
`security_invoker = true`, and the same meaning. The difference is the shape:
the "latest correction per bill" was a CTE referenced twice and therefore
materialised over **every** correction, whose policy then asked `bills` about
every bill the reader can see (2,127 on production). Now the uncorrected branch
is `NOT EXISTS` per payment row and the corrected branch a `DISTINCT ON`
subquery, both of which accept the caller's `bill_id` filter. Measured on
production data as the owner: identical rows over all 2,238 payments and over the
16 corrected ones; 131 ms → 4 ms for one day's forty bills.

**RLS, called out:** no policy changes and the view still runs as the caller, so
exactly the same rows are visible to exactly the same people. The existing
isolation cases for the view keep proving it.

### D11. The delivery log is indexed for the question it asks

`create index billing_commands_outlet_received_idx on billing_commands
(outlet_id, received_at desc)`. The read is "the last hundred at an outlet"; the
only outlet index was `(outlet_id, business_date, watermark)`, so every command
the outlet ever made was read, filtered by policy and sorted. Index only.

### D12. A Ledger day is one wave

The payment split moves into the first wave through
`ledger_day_takings(outlet, date)` — cash and UPI totals and bill counts, summed
per bill exactly as `perBill` does, security definer with `ledger_assert_reach`.
Names and adjustments move into the first wave as embeds (`profiles!recorded_by`
and the like, `drawer_observation_adjustments` under the day's observations),
which PostgREST resolves in the same request; the expenses view embeds through
its foreign key too (probed). The second wave goes; `namesFor` stays for the
month's spends.

### D13. The Drawer is three waves

After the page of observations, everything the Drawer reads depends only on
those rows: names, the five interval readers, the page's and the since-count's
movements, adjustments, the nearby bills, the acknowledgements, the late bills.
They go out together. The cash split for the nearby and the late bills becomes
one read, not two, alongside the acknowledgers' names. The arithmetic and the
records are unchanged. The acknowledgements read, which ignored its error, now
throws like the rest.

## Round three (2026-09-26)

### D14. Partial indexes for the reads that return almost nothing

`orders_pipeline_idx on orders (outlet_id, ordered_at desc) where status = 'open'
or (status = 'paid' and prepared_at is null)` — the manager's open-orders read
asks exactly that predicate, and today it matches nothing, so the read touches
nothing. `bills_settled_recent_idx on bills (outlet_id, paid_at desc) where
status = 'settled'` — the Drawer's "last forty settled" walks it newest first and
stops at forty; its "synced late" read, also ordered by `paid_at` and limited to
forty, walks the same index. Checked locally with RLS applied: the planner uses
both, with the policy evaluated only on the rows the index yields.

### D15. Billing history's day extras arrive with the bills

`billing_history_day_extras(outlet, date) returns jsonb` —
`{ payments: [effective_bill_payments rows], labels: [{ event_id, label }] }` for
the bills of that outlet and business date. **Security invoker**: it reads
`effective_bill_payments` and `bills` as the caller, so RLS decides exactly as it
does for the reads it replaces, and the till labels come from
`billing_event_device_labels`, which keeps its own checks. The adapter's manager
history path runs it alongside the bills read and hands its answer to the same
`billView`; the counter's paths are untouched.

### D16. The Drawer's recent bills arrive with their cash

`drawer_recent_cash_bills(outlet, late_after) returns jsonb` —
`{ nearby: [{id, bill_number, paid_at, cash_paise}], late: [{…, synced_at}] }`,
the same two queries the adapter made (forty each, newest first) with each bill's
cash summed from `effective_bill_payments`. Security invoker, for the same
reason. It depends on the page of observations only for `late_after`, so it runs
in the Drawer's second wave, and the third wave goes.

## Rejected alternatives

- **A materialised read model or a stored day row.** The remedy the #11 comment
  named for a slow month. Rejected because the measurement says the cost is round
  trips, not database work (each request is ~300 ms whether it sums a month or
  reads one row), so moving the computation server-side captures the whole gain
  without a table that must be refreshed and can be stale. The spec forbids a
  stored day row in any case.
- **The whole day as one server function.** Would reach one round trip rather than
  two, but moves the timeline, names, adjustments, coverage and verification
  logic — the day's most intricate code — into SQL, where the day's existing unit
  tests cannot reach it. Two waves is 600 ms; the last 300 ms is not worth
  splitting the day's logic across two languages.
- **Keep thirty-one `getDay` calls but parallelise each day.** Would take a month
  from ~600 requests to ~600 requests in two waves: still queued, still mostly
  discarded.
- **A month function that also returns the channel mapping.** Security definer
  would give a Franchise Admin the owner-only mapping and silently change which
  channels their month names — a policy change folded into a performance change.
- **Security invoker for the new functions.** RLS would then filter rather than
  refuse: a Franchise Admin asking for another outlet would receive an
  all-nought month, and "empty" and "not yours" would look identical. Overview
  chose definer-plus-assertion for the same reason.
- **Debouncing the stepper instead of cancelling.** Delays every deliberate tap to
  save the rapid ones. Cancelling costs the deliberate tap nothing.
- **Caching readings by outlet and period.** A cache is a second place a figure
  can be stale, on the one surface whose whole claim is that it cannot disagree
  with its sources; two round trips make it unnecessary.
- **Security definer for the round-three functions.** They answer exactly
  what the caller could already read row by row; invoker makes RLS decide that,
  with no assertion to keep in step with the policies.
- **Adding `business_date` to the payments view.** Every reader of the view
  would pay for the join, and the till labels would still wait on bill ids.
- **Caching the outlet list for the picker too.** The list is where a new outlet
  or a lost assignment has to appear, and it is not on anyone's critical path.
- **An outlet cache keyed on the adapter instance.** It outlives a sign-out.
- **Fixing the correction policy instead of the view.** The policy is correct and
  the cost came from the view's shape; a policy edit is a tenancy change with
  nothing to gain here.
- **Caching the day's figures.** A figure is exactly what must never be stale.
- **A separate change for the other three surfaces.** Offered on 2026-09-25 and
  declined by the owner: the rule is one rule, the Ledger change had not shipped,
  and landing it on one screen first would leave the app disagreeing with itself
  for a release.
- **Keeping Attendance's day in the axis and dropping the remount.** The remount
  is what guarantees a half-built approval selection never reaches another
  outlet; losing that to keep a date would trade a guarantee for a convenience.
- **Following each outlet's own cutover in the month read.** Correct in principle,
  but the day reader uses the 04:00 constant, and a month that bounded dates
  differently from its own days could disagree with them. Listed as a non-goal.

## Testing the round trips, not the milliseconds

The existing `zz-ledger-month-timing.test.ts` asserts a 20 s ceiling on a local
stack where a round trip is free, so it passed at 300 ms while production took
16 s. It is rebuilt around what actually costs:

- The adapter is created over a client whose `global.fetch` wrapper **delays every
  request by a fixed 250 ms** and counts requests. A day must settle in under
  3 × 250 ms plus the stack's own work, and a month likewise; the old code takes
  13 × 250 ms and would fail. The request count for a month is asserted to be
  constant (≤ 6) rather than proportional to its dates.
- **Parity:** for both seeded outlets and August, `ledger_month_inputs` must equal
  `toMonthDayInput(await getDay(d))` for every date, field by field, and the
  month reading built from each must be identical. This is what keeps D3 honest as
  either side changes.
- The Overview agreement assertions in that file stay.

## Risks

- **Two definitions of the day's month inputs** (SQL and TS). Mitigated by the
  parity test, which fails on the first paisa of difference and runs in
  `test:rls`, which gates a release.
- **supabase-js abort semantics.** An aborted `fetch` surfaces as an error object
  with an abort name/message rather than a thrown `AbortError`; the adapter checks
  the signal before converting an error, so an abort is never reported as a
  failed read.
