# Proposal: Retire The Manual Ledger

> **Model**: Opus · **Wave**: E · **Depends on**: #11 · **Gate**: August 2026 is
> readable from the real reports with every recorder, corrector, void and
> recorded-from-away marker intact; the notebook, the day-close code and the
> handover flag are gone; and no row of that period was deleted to achieve it.

**This change replaces roadmap #12 `daily-cash-live`'s inherited obligation, and
is the second release of the pair begun by #11 `cash-is-counted-not-closed`.**
It exists as its own change because everything in it touches production data
that cannot be recovered by hiding a surface, while everything in #11 reverts by
opening a different tab. The split is the safety property, not bookkeeping.

## Why

`manual-ledger-stopgap` (#36) shipped two owner-only tables in August 2026
because the counter was trading with no live record of what it sold, spent or
held in the drawer. Those rows are the only record of that period. The
capability has said since the day it landed that it is designed to be dropped,
and its spec makes the carry-over a requirement rather than an intention:
dropping the tables without carrying the rows does not satisfy the removal.

#11 gives those rows somewhere to land. This change lands them, and then removes
everything the old model left behind.

There is a second reason to do this rather than leave the notebook standing.
After #11 there are two ledger surfaces in the product, one of which is a form
that can still be typed into. Two writable records of the same trading day is
exactly the condition #36 was careful to avoid, and it is tolerable only for the
short overlap #11 asks for.

## What Changes

### Pre-tablet history is carried across, not retyped

Every `manual_ledger_days` row becomes a **legacy drawer observation** whose
counted instant is explicitly imprecise: the exact time was never captured, and
the carried row says so rather than inventing a plausible one. Every
`manual_ledger_expenses` row becomes a live expense.

Both sides already share an outlet, an explicit `business_date`, integer paise
and a free-text category snapshot, so no translation table is needed. What must
survive is everything the notebook grew after #36: the account that recorded a
row, the account that last corrected it, whether it was voided and by whom and
why, the withdrawal's actor and reason, and whether it was recorded from away.

Aggregator figures are untouched: they already live in `aggregator_channel_days`
and were never in the notebook's day row.

### The expense record is promoted, and the unused one is dropped

`public.expenses` was created in #7 and never filled. `manual_ledger_expenses`
carries the real rows and outgrew it: free-text categories, void with attribution
and reason, a last-corrector, and the recorded-from-away marker. The stopgap is
the better table.

So `manual_ledger_expenses` is renamed to `expenses`, and the empty original is
dropped. This is a rename of the table that already holds the data, not a
migration of rows into a weaker schema.

### The dead day-close code is removed

`daily_cash_records`, `cash_withdrawals`, `close_business_day()` and
`billing_assert_day_ready()` are dropped. The first has never held a production
row; `cash_withdrawals` was only ever written by the day-close path and so should
be empty too; `close_business_day()` computed its cash expenses from the empty
`public.expenses` table, so it was already wrong; and the readiness assertion has
exactly one caller, which is that function. Drawer cash out is
`drawer_cash_out`'s job from #11 onward.

### The handover flag is dropped and its todo is closed

`outlets.billing_live_from` exists to decide whether the manual ledger form asks
for typed Cash and UPI. With that form gone, the column has no reader.
`openspec/todos/ledger-handover-per-outlet.md` describes an operational act that
this change makes unnecessary rather than performs, and closes on that basis.

### The notebook leaves

The manual ledger's route, surface, adapters and mock fixtures are removed, and
its rows are retained read-only under an archive name so that the only record of
that period is not deleted in the act of retiring the thing that held it.

## Capabilities

### Modified Capabilities

- **`ledger-statement`** — the derived reading covers every date the business has
  traded, including dates before an outlet's tablet existed, by reading carried
  legacy observations rather than a second source.
- **`outlet-expenses`** — the promoted table is the expense record, carrying the
  void, attribution and recorded-from-away semantics the notebook grew.
- **`cash-drawer`** — a legacy observation is a first-class observation with an
  explicitly imprecise instant, and the interval rules state what that means.
- **`profit-estimates`** — the month computes from the live records with no
  notebook in the chain.

### Removed Capabilities

- **`manual-ledger`** — the stopgap, discharged. Its removal requirement is
  satisfied here and nowhere else.

## Impact

- **Renamed**: `manual_ledger_expenses` to `expenses`, with its policies,
  indexes, triggers and generated types following.
- **Dropped**: the unused `public.expenses`, `daily_cash_records`,
  `cash_withdrawals`, `close_business_day()`, `billing_assert_day_ready()`,
  `counter_shift_closed_day_guard()` and its trigger, and
  `outlets.billing_live_from`.
- **Archived, not deleted**: `manual_ledger_days` retained read-only under an
  archive name.
- **Removed surfaces**: the manual Ledger route and its navigation absence
  becomes an absence of the route itself.
- **This change is not revertable by hiding a surface**, which is why it is
  separate and why its first task is a dump.

## Non-goals

- **No deletion of August's rows.** Retiring the stopgap means removing the
  surface and the write path. The rows are archived, and the cost of keeping
  roughly sixty of them forever is nil against the cost of being wrong.
- **No change to the drawer model.** Everything about observations, collections,
  spends, adjustments and exceptions is settled in #11.
- **No new reporting.** The month gains no figure; it changes where it reads
  from.
- **No day-level billing seal.** `billing_assert_day_ready()` is dropped rather
  than re-homed. If one is ever wanted it is its own change with its own
  justification.
- **No inventory.** Shelved; see `openspec/todos/inventory-is-shelved.md`.

## Docs to update before archiving

`docs/DATA_MODEL.md` (the manual-ledger section goes; the expense table's real
name and shape arrive), `docs/SCREENS.md` (the Ledger entry describing a
temporary surface), `docs/LIMITATIONS.md` (the stopgap section and its stated
exit, now discharged), `docs/ROLES_AND_PERMISSIONS.md` (the manual-ledger rows
of the capability matrix), `docs/OPERATIONS.md` (steps 8 and 12 of bringing an
outlet's counter online, neither of which survives), `docs/DEMO_MODE.md` (the
retired gate), `docs/TESTING.md` (the carry-over rehearsal and its assertions).
