# Design: The App Asks The Server Less

## Context

Measured from production's `edge_logs` over the 24 hours to 09:15 UTC on
2026-10-15, with read-only Management API queries:

| Source | Rows | Share of log bytes |
|---|---|---|
| API gateway, one per request (~2.8 KB) | 30,162 | ~96% |
| Postgres | 3,865 | ~2.5% |
| Everything else | ~1,300 | ~1.5% |

The counter tablet sent 41% of the requests. A six-hour breakdown by device
(04:00–10:00 UTC) placed each large path:

| Path | Who | Six hours | Cause |
|---|---|---|---|
| `menu_categories` | kitchen | 288 | re-read beside each of 294 board reads |
| `expenses` (HEAD) | one manager phone | 758 | one count per category, per list open |
| `menu_*`, `outlets` | counter | ~86 each | the whole menu reloaded on each sale notice |
| `orders`, `bills`, payments, labels | counter | 43–118 | two or three notices per sale, each a full refresh |
| aggregator tables, credential health | owner laptop and phones | ~1,200 | badges re-read on every return to the foreground |
| `change_gates`, `report_device_health`, `report_counter_device_state` | each tablet | ~1 a minute each | three separate minute calls |

The Postgres side is defaults throughout (`log_statement = ddl`,
`log_min_duration_statement = -1`, pgAudit off); `cron.log_statement` is the only
setting worth turning, and it is configuration, not code (Non-goals).

## Decisions

### D1. One gate, `fewer-requests`, over several toggle points

Each item below is small, and each is a re-read the app does not need. They
share one purpose and one measure (the month's log volume), and the owner will
judge them together over a billing cycle, so they share one gate. A gate per
item would spend five of the five independent gates allowed at once for one
decision.

Every toggle point reads `useChangeGate('fewer-requests')` from the page's
frozen snapshot and keeps the old code path as it was.

### D2. The shared freshness rules (`src/lib/freshness.ts`)

The owner asked for a generic way, so the next screen does not invent its own
timer. One module names the numbers and gives the one helper that more than one
place needs:

- `FOREGROUND_REREAD_AFTER_MS = 120_000`: a count already on screen is re-read on
  returning to the foreground only when it is older than this.
- `MENU_REREAD_ON_SALE_AFTER_MS = 120_000`: how old the counter's menu may be
  before a sale notice reloads it.
- `NOTICE_BURST_MS = 300`: notices this close together are one burst.
- `RUNNING_SYNC_CHECK_MS = 3_000`: how often a running aggregator sync is checked.
- `olderThan(at, ms, now)`: whether a read made at `at` is older than `ms`.
- `mergeBursts(run, ms)`: returns `{ notice, cancel }`; `notice()` runs `run` once,
  `ms` after the last notice of a burst.

`docs/ARCHITECTURE.md` gains a short section, *How a screen keeps its data
fresh*, which is the rule a reviewer points at: re-read on a change notice, not a
timer; merge bursts; on the foreground only when stale; never a fixed-interval
poll without single-flight; and the request budget counts it.

**Rejected: a full data-freshness layer** that every screen's reads go through
(a query cache with keys and maximum ages). It is the right end state and is
what libraries like TanStack Query provide, but moving every surface onto it is
a rewrite of the counter's data path while #74 and instant saves are still being
watched. The constants and the helper are the part every later screen needs;
the cache can follow when a screen needs it.

### D3. The kitchen reads its categories when its filter changes

Both kitchen boards (`DishKitchenBoardScreen` and the old `KitchenBoardScreen`,
since `fewer-requests` does not depend on `dish-ticks`) re-run their category
effect on `board?.filter.categoryIds`, a fresh array each read. On the on path
the dependency is a string, the mode plus the sorted ids joined, so the effect
runs on first load and when the filter really changes. The filter sheet keeps
its own read when it opens.

What the old re-read also did, by accident: a category renamed mid-shift reached
the board's filter label within 20 seconds. With the gate on it reaches it when
the filter next changes, the sheet opens, or the page reloads. The label is the
only place the kitchen shows a category's name.

Saved: about 1,800 requests a day.

### D4. The counter's menu follows the menu, and sale notices merge

`subscribeToOutletBilling` already listens on `menu_categories`, `menu_items`,
`orders` and `bills`, and calls one callback for all four. The shared channel
helper in the Supabase counter adapter now passes the table name to each
listener; the callback's type widens to `(table) => void`. The off path's
`refreshVisibleData` takes no argument and is called exactly as before.

On the on path the counter splits the notice:

- `menu_categories` or `menu_items`: reload the menu (merged with D2's burst).
- `orders` or `bills`: refresh the bills and the rail once per burst, and reload
  the menu too only when the last menu load is older than
  `MENU_REREAD_ON_SALE_AFTER_MS`.

Why a sale still reloads the menu at all: `readOutletMenu` also carries the
discounts, discount presets, service and loyalty settings, and none of
`menu_discounts`, `menu_discount_categories` or `outlets` is in the realtime
publication. Today those reach a running counter at its next sale. With the gate
on they reach it at the first sale after two minutes. The sale that triggers the
reload was already rung on the old menu in both states, so what changes is that
a second sale within two minutes of the first may also use it.

**Rejected: adding those three tables to the realtime publication.** That is a
migration that changes what Realtime sends every subscriber of an existing
table, the kind of change *Migrations only add* is wary of, for a gain the two
minutes already give.

The foreground refresh (`useOnForeground(refreshVisibleData)`) and the first
load are unchanged in both states.

Saved: the counter's menu reads fall from about one set per notice to about one
set per two minutes of trading, and merged notices remove about a third of the
bill and rail refreshes: about 2,600 requests a day.

### D5. The expense list asks for names only

`ExpenseList` calls `expenseCategories.list()`, which reads the categories and
then counts each category's expenses one request at a time, and uses only the
names. The adapter gains `names()`: one request for the names, in the same
order. The categories page keeps `list()`, because it shows the counts.

Saved: about 950 requests a day.

### D6. A badge re-reads on the foreground only when it is stale

`useSharedRead` (the delivery badges and anything else shared through it)
re-reads on mount when nothing is held, on a nudge, and on every return to the
foreground. Its store gains `readAt`, set when a read settles. On the on path a
foreground return re-reads only when `readAt` is older than
`FOREGROUND_REREAD_AFTER_MS`; a nudge and the first read are unchanged.

On a phone, returning to the app after two minutes in an apron re-reads as
before. On the owner's laptop, flicking between browser tabs no longer re-reads
every badge each time.

Saved: about half of the owner devices' aggregator reads, about 1,500 a day.

### D7. A running sync is checked every three seconds

`aggregator-sync-surface.tsx` re-reads every 700 ms while a run is under way. On
the on path it uses `RUNNING_SYNC_CHECK_MS`. A run takes tens of seconds; nobody
sees the difference between 0.7 and 3 seconds of latency on its finishing.

Saved: a few hundred a day, more on a day the owner runs syncs by hand.

### D8. A tablet's health report brings back the gate answers

A tablet with `tablet-health` on sends `report_device_health` every minute, and
`startChangeGateRefresh` separately reads `change_gates` every minute. On the on
path, and only while `tablet-health` is on, the report goes to a new function,
`report_device_health_v2`, which records the report exactly as v1 does (it calls
v1) and returns every live gate's answer as `{ key: enabled }`. The report hook
offers those answers to the running refresh, which treats them as a read: save
them, compare with what the page booted with, raise the update once.

The refresh takes an option, `minuteRead` (default `true`, which is today). With
the answers arriving on the report, the counter and kitchen roots start it with
`minuteRead: false`. Its live channel, its read on the foreground, on regaining
the connection and once at start all stay.

**The minute is still the slowest a turn can take.** If a v2 report fails, the
hook reads the gates directly with the adapter's `read()` and offers that
instead. A tablet with `tablet-health` off keeps the minute read in both states.

**Why this is safe for the way out.** Turning `fewer-requests` off reaches a
tablet by its live channel within seconds, or by the next minute report, whose
answers carry the turn. The page then reloads into the off path, where the
minute read is back.

The phone's root (`real-root.tsx`) does not report health and keeps its minute
read while visible.

Saved: one request per tablet-minute, about 1,400 a day.

**Rejected: merging the unsent-bills heartbeat into the same call.** It is sent
by the outbox's reporter, and the outbox never reads a gate (AGENTS.md).

### D9. The proof: a second request budget, with the gate on

`e2e-auth/request-budget.spec.ts` runs in both states and is not edited (an
existing test may receive only a tag). A new spec, `e2e-auth/fewer-requests.spec.ts`,
tagged `@cg-on:fewer-requests`, measures the same idle counter and kitchen minute
and one payment over the same rail, and asserts budgets set from this change's
own readings. It shares `request-budget.spec.ts`'s CI shard: both spend a
measured minute, and with gates off this one is skipped, so only the gates-on
job grows: the kitchen's idle minute loses the three category reads, the
counter's idle minute loses the gate read, and a payment loses the menu reload
and the duplicate refreshes. Each budget is one and a half times the worst of
the readings, rounded up, recorded in the test with the date and commit.

## What the estimate adds up to

| Item | Requests a day now | Saved |
|---|---|---|
| D3 kitchen categories | ~1,800 | ~1,800 |
| D4 counter menu and merged notices | ~7,000 on the counter's sale path | ~2,600 |
| D5 expense names | ~970 | ~950 |
| D6 badges on the foreground | ~3,000 | ~1,500 |
| D7 running sync | a few hundred | ~200 |
| D8 gates on the health report | ~1,800 | ~1,400 |
| CORS preflights, in proportion | ~2,500 | ~700 |
| **Total** | **~30,000** | **~9,000 (≈30%)** |

About 21,000 requests a day is about 1.5 GB of log volume a month, still over 1
GB. The remaining levers, each left out on purpose:

- **The kitchen board's 20-second re-read** (~1,800 a day). Slowing it slows a
  kitchen that missed a pulse, and its out-of-sync rule is tuned to it.
- **The unsent-bills heartbeat** (~1,800 a day). In the outbox; see D8.
- **Session revalidation** (~1,700 a day in `counter_devices`, `profiles`,
  `assignments`). Deactivation must bite within minutes.
- **Owner devices left open in background tabs**, beyond D6.

Each is a decision about freshness the owner should take, not a waste to
remove.

## Version skew

- **`change_gates` row `fewer-requests`**: inserted off by this change's
  migration. A build published before it never reads the row.
- **`report_device_health_v2`**: a new function; `report_device_health` is not
  touched, and v2 calls it, so the row a v1 report writes and a v2 report writes
  are the same. A build published before this migration calls v1 as it does
  today. A build after it calls v2 only with the gate on.
- **No other database object is touched.** D3–D7 change only when the client
  reads.

**Turning the gate off** strands nothing: the on path persists nothing new (a v2
report writes what v1 writes), so `roundTrip` is `none:`.

## RLS, money, offline

- **RLS:** `report_device_health_v2` is `security definer`, as v1 is. The device
  and outlet still come from the caller's own device session inside v1; v2 adds
  only a read of `change_gates`, which every authenticated caller can already
  read (`change_gates_select`). Execute is granted to `authenticated` only.
  The isolation of `device_health` is unchanged and already tested.
- **Money:** none.
- **Offline:** none. The outbox and its heartbeat are not touched; a counter
  resumed offline reads its menu from the resume record as before.
