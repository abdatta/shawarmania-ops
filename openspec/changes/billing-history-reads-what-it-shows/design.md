# Design: Billing History Reads What It Shows

Settled with the owner in one conversation on 2026-10-18, starting from their
question whether recent deploys had slowed Billing history. `[owner]` marks
their calls. The page's words, controls and figures are #78's
(`billing-day-at-a-glance`, not yet archived) and do not change; only where each
is worked out and when it is read.

## What the page does today, measured

From production's edge logs, 18 October, the owner's US connection:

```
open Billing history / change day                       one round trip, six requests
 ├─ outlet                     answered from memory, refreshed behind
 ├─ billing_history_day_extras the day's effective payments and till labels
 ├─ bills                      EVERY bill, ten nested tables, ~2.2 KB each
 ├─ billing_commands           the newest 100, with their result json
 ├─ assignments                the outlet's billers
 └─ orders (HEAD)              the day's open-order count

Stats tab   → billing_day_stats
Orders tab  → orders + manager_kitchen_marks_v2, THEN billing_event_device_labels
open a bill → nothing (already held)
cancel      → void command, re-read that bill (two round trips),
              then all six again, the list replaced by its shimmer
```

The full bill read is the cost and grows with the day: 17 bills 197 ms, 46 bills
264 ms, 78–90 bills 288–608 ms from India; 85–125 bills 767–1,513 ms from the US.
Server time only — the phone then downloads up to 289 KB (128 bills, 17
October) and draws every row. Requests from the US carry roughly 250 ms more than
the same request from India on every call, which is the Cloudflare edge's
distance to the Mumbai origin, not the database.

## D1. The list is a page of slim rows, sorted and filtered by the server

**`billing_history_bills(p_outlet_id uuid, p_business_date date, p_filter jsonb,
p_limit integer, p_after jsonb) returns jsonb`**, `language sql`, `stable`,
**`security invoker`**, `search_path = ''`, granted to `authenticated`.

It returns `{ rows: [...], matching: n }`:

- **`rows`**: up to `p_limit` (capped at 100; the page asks for 30) bills of the
  outlet-day that match `p_filter`, in the filter's order, after the `p_after`
  cursor. Each row is what `ManagerBillSummary` prints and what a detail needs
  from the list, nothing else: `id`, `bill_number`, `status`, `void_kind`,
  `paid_at`, `ordered_at`, `total_paise`, `tender` (`cash`, `upi` or `mixed`),
  `payments` (the effective allocation, `[{method, amount_paise}]`),
  `payment_revision`, `biller_name`, `till_label`, `entry_source`,
  `recorded_after_shift_end`, and `cursor` (see below).
- **`matching`**: how many bills of the outlet-day match the filter, for
  `Bills (shown/total)`. A day is at most a few hundred rows on the outlet-date
  index, so counting them with the page costs nothing a second request would not.

No customer phone or name is in a row: the folded card never showed them, and
the spec keeps the phone out of summaries.

**The filter, server side.** `p_filter` carries #78's `BillFilter` as it is:
`sort`, `descending`, `kinds`, `tenders`, `customer`, `services`, `traits`,
`tablets`. Each group means exactly what `bill-filter.ts` means today — within a
group any choice will do, across groups all must hold, an empty group does not
filter; `without` counts a bill with a name and no phone; a legacy void with no
kind reads as `cancelled`. Per bill:

| Filter or sort | Worked out from |
|---|---|
| kind | `status`, `void_kind` |
| tender | the bill's `effective_bill_payments`: one method, or `mixed` |
| customer | `customer_phone` trimmed non-empty; `customer_tier = 'gold'` |
| service | `service_type` |
| had a discount | a `bill_discounts` row exists (bill-level discounts, as `bill.discounts` today) |
| payment changed | the effective allocation's revision above zero |
| receipt failed | its `bill_receipt_deliveries` state is `failed` |
| tablet | the till label below |
| wait | `paid_at − ordered_at` |

**Till labels** come from the existing `billing_event_device_labels('bill',
ids)`, as `billing_history_day_extras` already gets them: `counter_device_history`
is not readable by managers directly, and that security-definer function is the
one place that resolves a bill's tablet at its payment instant with the reader's
authority checked. Billing history is the only caller of this list, so the bound
of 1,000 ids that function enforces is far above a day.

**Paging is by cursor, not offset.** The list is newest first by default, and on
today new bills are paid while the owner scrolls: with an offset, every new bill
pushes a row from page one onto page two and the owner sees it twice. Each row
carries `cursor = {k, n}` — its sort key (epoch milliseconds for the times and
the wait, paise for the amount) and its bill number — and the next page asks for
rows strictly after it in the same direction, ties broken by bill number in that
direction, as `applyBillFilter` breaks them today.

**Authority.** `security invoker`, so `bills_select` decides what the caller sees
— the owner, that outlet's franchise admins — exactly as the bills read does
today. A franchise admin naming another outlet gets no rows. The labels go
through the definer function, which applies the same rule itself.

## D2. One read of the day in numbers

**`billing_day_numbers(p_outlet_id uuid, p_business_date date) returns jsonb`**,
`plpgsql`, `stable`, **`security definer`**, `search_path = ''`, granted to
`authenticated`. It refuses anyone but the owner and that outlet's franchise
admins with `42501`, with `billing_day_stats`'s exact guard (device ok, account
active, owner or franchise admin of the outlet), and a null day as
`invalid_parameter_value`.

| Key | What | From |
|---|---|---|
| `cashPaise`, `upiPaise` | the day's counter takings by tender | `revenue_figures(outlet, day, day)` — #76's definition |
| `settledBills` | settled bills, AOV's divisor | `bills` |
| `bills` | every bill of the day, the `Bills (n)` total | `bills` |
| `stats` | #78's twelve figures | `billing_day_stats(outlet, day)` called as it is |
| `refusals` | the day's sync problems | `billing_commands`, below |
| `newestCommandAt` | the chip's *In sync · N min ago* | the outlet's newest command, any day |
| `openOrders`, `unpaidPaise` | the day's open-order count and unpaid total | `orders`, the pipeline predicate the count uses today |
| `tablets` | the day's till labels, for the Filter sheet's Tablet group | `billing_event_device_labels` over the day's bills |

**Money.** Every figure is integer paise summed in `bigint`. AOV stays the
client's `averageBillPaise(cash + upi, settledBills)`, rounding once as today.
`revenue_figures` floors each tender's day total at zero and counts `settled`
bills only; the phone summed every non-void bill's payments. They differ only on
a day where corrections leave a tender negative, and there the agreed figure is
the right one — Overview and the Ledger already show it.

**Sync refusals by day** [owner: "100 is such a random number"]. A refusal is a
command whose `result_category` is not routine (`accepted`, `replay`, `applied`,
`corrected`, `discarded` — the set `manager-sync-status.tsx` uses today). It
belongs to the outlet business day of its `received_at` through the outlet's
cutover (`app_business_date`), because `billing_commands.business_date` is null
for commands that are not about a bill or an order. Each refusal returns what the
chip lists — `id`, `command_type`, `result_category`, `received_at` and the order
number the result names (`result->'orderNumber'` when it is a number, as
`refusedOrderNumber` reads it) — and never the payload or a customer detail.
Production has eleven refusals ever, none since 12 September, so this is usually
an empty list. `newestCommandAt` ignores the day: the chip speaks for now (#78,
D3), and on a past day it still says whether the tablets are syncing now.

**Why one read and not several.** Everything in it is a number or a short list
about the same outlet-day, needed the moment the page opens (the strip and the
tab counts) or the moment Stats is chosen. The owner refused one function for the
list *and* its counts [owner: "a very one-time use case"]; this keeps the list as
its own reusable read and gathers only the figures.

## D3. A bill's details are read once and kept

Opening a bill shows what the row holds at once — number, state, total, tender
split, time, biller, tablet — and reads the rest with **one request**: the
existing `bills` select by id (lines, discounts, public link, receipt, order,
names, reviews). Its effective payments and till label are already in the row,
so the second round trip `readBills` makes for them today is not made. The
detail's dish lines and the facts the row lacks show the detail's own loading
state for that moment.

The result is kept **in memory, keyed by bill id, for the life of the page**
[owner: collapsing and re-expanding, or opening another and coming back, "should
not again load it. That's annoying"]. It is never written to browser storage. A
cancellation replaces the entry with the bill the void returns (D4). Leaving the
page drops it.

The adapter gains `readManagerBillDetail(row)`, which merges the row with the
read; `getBill`, which the customer card uses, keeps its current shape.

## D4. A cancellation changes its row, not the page

`voidBill` already returns the bill as it now is. The page puts it in place of
its row and its detail entry, keeps it expanded where it was, and re-reads
**only** `billing_day_numbers`, quietly, because the strip, AOV and Stats' Bills
figures moved. No shimmer, no list re-read, no lost place. A cancelled row stays
where it is even if the filter in force would now leave it out; the next filter
change or page read places it, which is less jarring than a row vanishing under
the owner's finger.

Cancelling an order on Open orders removes it from that list, and re-reads the
day's numbers and the Bills rows already shown, quietly: a paid order the kitchen
had not finished becomes a bill cancelled after payment, and the Bills list must
show it so.

`reviewAttribution` returns the reviewed bill too and is patched the same way.

## D5. Open orders: one round trip

`listManagerOpenOrders(outletId, businessDate)` becomes a manager-only read of
its own: the `orders` select the tab uses today, scoped to the outlet **and the
day** and the pipeline predicate, with **no till-label read** — the Orders card
(`DishOpenOrderSummary`) never shows one — and no outbox overlay, which only a
counter tablet has. It runs alongside `manager_kitchen_marks_v2`, so the tab
waits one round trip. The counter's `readOrders` is not touched.

Only today's orders are open in production (12 on 18 October, read that day), so
the day scope changes nothing yet; it is the tab's own rule (#78, D2) asked of the
server instead of the phone.

## D6. Coming back to the page

On `visibilitychange` to visible, when the page's last read is more than two
minutes old — the rule `the-app-asks-the-server-less` gave the delivery badges —
the page re-reads `billing_day_numbers` and as many rows as it already shows (one
`billing_history_bills` call with `p_limit` at the shown count, up to 100, and
the rest by cursor), quietly, keeping the filter, the expanded bill and the
scroll position. The Orders tab, when it is the one open, re-reads itself the
same way. Under two minutes nothing is read.

## D7. Loading states

- The strip and the tab counts show their shimmers until `billing_day_numbers`
  lands, as the strip does today until the bills land.
- The list shows `BillingHistoryShimmer` on the first page and on a filter or
  sort change [owner: sub-second accepted], and a short row of shimmer at its foot
  while the next page loads. The next page is asked for when a sentinel ten rows
  from the end scrolls into view.
- Stats renders from what `billing_day_numbers` returned and has no shimmer of
  its own after the first load.

## D8. Requests, before and after

| Moment | Today | After |
|---|---|---|
| Open the page | 6, heavy bills read | 4 together: outlet, a page of rows, the day's numbers, billers |
| Change the day | 5 | 2 (rows, numbers) |
| Change a filter or sort | 0 | 1 (rows) |
| Scroll past 30 | 0 | 1 per 30 bills |
| Choose Stats | 1 | 0 |
| Choose Orders | 3, two round trips | 2, one round trip |
| Open a bill | 0 | 1, first time only |
| Cancel a bill | void + 2 + 6, shimmer | void + 1 (the void's own re-read) + 1 |

## D9. Rejected alternatives

- **Read the whole day slim and keep filtering on the phone.** It was the first
  recommendation: a day is bounded, slim rows are about 25 KB, and filtering
  stays instant. The owner chose the server [owner]: a sub-second filter change is
  acceptable, the figures belong on the server anyway (D2), and days are already
  doubling.
- **A `security invoker` view instead of the list function.** A view cannot carry
  the till label — managers cannot read `counter_device_history`, and calling the
  definer function per row from a view repeats its guard per bill — nor sort by
  the wait without exposing a computed column every reader of the view would
  carry. A function with the filter as an argument says what it is for.
- **Offset paging.** New bills arriving at the top while the owner scrolls would
  repeat rows (D1).
- **One function for the list and its counts.** Refused by the owner as
  single-purpose [owner]; the list stays its own read so a later caller (the
  customer card, a search) can use it.
- **The sync problems from the last six hours.** Another arbitrary window, and
  meaningless on a past day; every other figure on the page is the chosen day's.
- **Keeping the last hundred commands and raising the hundred.** Any count is a
  time window that shrinks as sales grow.
- **Prefetching the details of the visible rows.** It reads most of what this
  change stops reading, for bills the owner mostly never opens.
- **Folding the kitchen ticks into the orders read.** It would need a function of
  its own; two requests sent together cost one round trip.
- **Dropping the billers from the page's first read** and reading them with a
  bill rung after its shift ended. A small, parallel request; not worth the
  special case [owner: "let's not over engineer"].

## D10. Authority, tenancy, offline

- **RLS**: no policy is added or changed. The list reads under `bills_select` as
  the caller; the day's numbers check the caller with `billing_day_stats`'s guard
  and read as definer; the labels go through the existing definer function. A
  franchise admin's crafted request for another outlet gets no rows from the list
  and `42501` from the numbers, and pgTAP proves both.
- **Money**: integer paise throughout (D2). No arithmetic moves to the client
  except AOV's single division, which is there today.
- **Offline**: none. Billing history is an online owner and manager screen; the
  outbox and the counter's overlay are untouched (D5).

## D11. Version skew

- **`billing_history_bills`, `billing_day_numbers`**: new names, so every
  published build is unaffected by their arrival; the migration is published
  before the build that calls them, as always.
- **`billing_history_day_extras`, `billing_day_stats`, `billing_event_device_labels`,
  `revenue_figures`**: unchanged. The old build keeps calling the first two; the
  new functions call the last three as they are.
- **`bills`, `orders`, `billing_commands`, `assignments`**: no change. The old
  build's reads of them work exactly as before.
- **A revert** returns the old page, which never calls the new functions; nothing
  the new page did is persisted anywhere. There is no gate, so no round-trip test.

## D12. Demo

The demo adapter implements `listManagerBillRows`, `readDayNumbers`,
`readManagerBillDetail` and the day-scoped `listManagerOpenOrders` from its store
with the same definitions: rows through `applyBillFilter` (which stays, now the
demo's and the tests' reference for what the server must return), the cursor
applied after it, the figures folded as `readDayStats` folds them today, cash and
UPI as `revenue_figures` defines them. The four-role demo walkthrough still
walks.

## D13. Risks, measured

Task 1.1, 2026-10-18, over the production pooler as the owner (`set local role
authenticated` with the owner's claims), Kalyani Cafe's busiest day (17 October,
128 bills), median of five, less the 286 ms this machine's round trip to Mumbai
adds to every statement:

| Read | Server | Returned |
|---|---|---|
| today's `bills` read with its ten embeds, the whole day | ~108 ms | 321 KB |
| `billing_history_day_extras` | ~40 ms | 31 KB |
| D1's draft: 30 rows with payments, tender, labels and `matching` | ~52 ms | 14 KB |
| `billing_day_stats` | ~3 ms | 0.2 KB |
| the day's refusals and the newest command | ~3 ms | 0.1 KB |
| today's last-100 `billing_commands` read | ~4 ms | 33 KB |

- **`billing_day_numbers` is not slower than its parts.** The Stats figures cost
  about 3 ms, so they stay in the day's read and the Stats tab reads nothing. The
  300–500 ms the edge logs show for `billing_day_stats` is the round trip and the
  gateway, not the query.
- **One trap, found by the measurement.** The first draft filtered
  `effective_bill_payments` with `bill_id in (select id from day)` and took
  ~1,100 ms: the view does not push that predicate down, so it scanned every bill
  in the database three times under `bills_select`. Written as `bill_id =
  any(array(select id from day))` — as `billing_history_day_extras` already does —
  it took the ~52 ms above. Every read of that view in the new functions takes the
  array form, and a comment says why.
- **What the edge saw is mostly not the database.** Today's full read is ~108 ms
  of query and 321 KB, against 290–1,500 ms at the edge: the rest is PostgREST
  building ten embeds into JSON, the gateway, and the transfer. The page the owner
  waits on shrinks from ~350 KB across two reads to ~14 KB.
