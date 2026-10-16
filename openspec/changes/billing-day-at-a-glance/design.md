# Design: The Billing Day at a Glance

Every layout and word here was chosen by the owner on 2026-10-16 from sketches
drawn in the conversation; the rejected variants are recorded so a later session
does not offer them again.

## D1. The in-progress amount on Overview

**What it is.** The sum of `orders.total_paise` over the outlet's orders with
`status = 'open'` and `business_date` equal to the outlet's current business
date, as the server resolves it (`app_business_date(now(), cutover)`, the same
today `overview_today` uses). Integer paise summed in SQL, `bigint`, formatted
only at the display edge.

**What it is not.** Paid orders still being cooked (`status = 'paid'`,
`prepared_at` null) are already revenue, so they are left out; counting them
again would double them. Cancelled orders are nobody's sale. An open order from
an earlier business date is not today's sale in progress and is left out too
(production had none on 2026-10-16).

**How it reads.** `₹35,630 · ₹1,240`: the headline, a `·`, then the amount in
`font-bold text-content-muted` at the tender figures' `0.8125rem`, exactly as
`SupportingMoney` draws Cash · UPI · Delivery beneath, but **exact rupees** —
`formatPaise` with the paise trimmed, never the compact `1.2k` [owner]. No label
or icon; the exact figure is in the title [owner]. Absent at zero, so a quiet
card does not read `· ₹0`.

**On a phone it does not always fit.** The owner suggested half the headline's
size and the tenders' weight and colour. A 375px phone gives the headline 109px
beside its 40px icon, and the demo's `₹5,418 · ₹1,495` already takes 110px at the
tenders' size; a production day of `₹35,630 · ₹1,240` takes about 121px. So the
tile measures each form against its cell, hidden, as the tender line beneath it
does, and draws the first that fits: the tenders' size beside the icon, then half
the headline's (`0.6875rem`) beside it, then the same two without the icon. The
icon is decoration; both figures are the point. Measured in the browser at 375px
(half size, icon kept) and 320px (no icon).

**Where it comes from.** `overview_today_v2` returns `overview_today`'s three
figures plus `openPaise`, so the card still makes one today read. The adapter's
`today()` calls the v2 function; `OverviewToday` gains `openPaise`.

**Rejected.** A separate `overview_open` read: one more request per outlet per
Overview, for a figure that changes on the same clock as the rest of the tile.
Counting paid-but-cooking orders: double counting. Shortening to `1.2k`:
refused by the owner. A label or icon: refused by the owner.

**The link.** Tapping the tile opens Billing history for today. That correction
belongs to #76, whose on path moved it to the Ledger, and lands in #76's folder
and code (owner, 2026-10-16), not as part of this change.

## D2. Open orders follow the day

The tab lists `listManagerOpenOrders(outletId)`'s orders whose `businessDate`
equals the bar's day. The filter is applied on the manager's screen, not in
`readOrders`, because `readOrders` is the counter's read too and this change does
not touch what the counter runs. The pipeline is a handful of rows, so reading
it whole and keeping one day costs nothing measurable.

The tab's count on the dish path comes from `countManagerOpenOrders(outletId,
businessDate)`: the optional date adds `business_date = ?` to the manager-only
count. Off the dish path the count is the filtered list's length.

Above the list: **Yet to be paid ₹1,240** — the listed orders with
`status = 'open'`, their `totalPaise` summed. Paid-but-cooking orders are listed
(under *Preparing*, as today) but not in the figure, for D1's reason. It is a
header drawn like *Preparing* and *Unpaid Prepared Orders* beneath it, with the
figure on the right, not a card. *Yet to be paid* rather than *Unpaid*, which
reads as money that may never come, a giveaway or a discount (owner,
2026-10-16); the other screens keep their words for now.

**Rejected.** Today also showing earlier days' leftovers: the owner chose a
strict date rule. A filter on Open orders: not asked for.

## D3. The Stats tab

### The figures

One read, `billing_day_stats(p_outlet_id, p_business_date)`, over the orders and
bills whose `business_date` is the chosen day.

| Group | Figure | Definition |
|---|---|---|
| Counter | **Placed** | orders of the day, any status |
| | **Updated** | of those, orders with at least one accepted `revise_order` command (distinct orders, not edits: one order edited five times counts once) |
| | **Cancelled** | of those, `status = 'cancelled'` |
| | **Paid** | of those, `status = 'paid'` |
| Kitchen | **Seen** | of those, orders with a `kitchen_acknowledgements` row |
| | **Ready** | of those, orders with an effective `kitchen_readies` row (`undoes` null and not itself undone) |
| | **Avg to ready** | mean of *last effective ready − ordered_at*, over Ready orders |
| | **Avg handover** | mean of *prepared_at − last effective ready*, over Ready orders the counter marked prepared (`prepared_source = 'counter'`) at or after that ready |
| Bills | **Bills cancelled** | bills of the day, `status = 'void'`, `void_kind` `manager_void` or null (legacy voids read as a manager's) |
| | **Cancelled after paid** | `void_kind = 'cancelled_after_paid'` |
| | **Payment undone** | `void_kind = 'counter_unpay'` |
| | **Payment changed** | bills of the day with a `bill_payment_corrections` row (distinct bills) |

"Last effective ready" is the latest of an order's live readies across its
kitchens, so an order split between two kitchens is ready when the second
finishes. Orders the 4 am day change finished (`prepared_source = 'day_change'`)
and orders no kitchen marked ready stay out of both averages: one forgotten order
would otherwise read as hours. An average with nothing to average is null and
reads **—**. Times read `6m 40s`, `45s`, or `1h 05m`.

Words are the kitchen's own: **Seen** and **Ready** are what its chips say on the
Orders tab (*sent, seen, ready, served*), so nothing gains a second name.

Production on 2026-10-16: 427 orders were updated at least once since 10 Oct, so
Updated is a working number; the bill figures are small (1 manager cancel, 5
cancelled after paid, 4 payments undone and 11 corrections across all 3,302
bills) and will mostly read 0, which is the right answer.

### The sync chip

The diagnostics read is unchanged (`listDeliveryDiagnostics`, the newest 100
commands): it is a reading of **now**, not of the chosen day, and the chip says
so by ignoring the date. *In sync · 2 min ago* (the newest command's
`receivedAt`), in a success outline; with problems, *2 sync problems* in a danger
outline with each problem listed beneath it exactly as today (action, order,
when, and whether a resend can help). The grouped action counts and the **Show
technical details** disclosure are removed [owner]. With no commands at all:
*No tablet activity yet*.

The tab keeps its count, `Stats (1)`, with the parenthesised number in
`text-danger`, so a refusal is never behind a quiet tab and the number cannot be
read as a count of stats.

### The look

Three cards stacked, Counter then Kitchen then Bills, each a header row (an
accent icon and the group's name) over a 2 × 2 grid split by hairlines, the
number (`text-xl font-black`) over a muted caption. This is the Overview card's
divided grid, chosen to look unlike the bordered Cash / UPI / Total / AOV tiles
above the tabs [owner]. A shimmer of the same three cards holds the space while
the read lands. On a wide screen the cards stay one below the other [owner].

**Rejected layouts.** A: a 4 × 2 tile grid like the payment cards — too like the
tiles above. B: the order's journey left to right with exceptions beneath — the
owner preferred groups. C as first drawn, two groups side by side — the owner
asked for them stacked. *Bills cancelled* under Kitchen — it is not the
kitchen's, so the third group exists. *Status & stats* as the tab name — wraps on
a phone beside `Bills (12/140)` and `Open orders (4)`.

## D4. The Bills filter

### Controls

One **Filter** button (`SlidersHorizontal`), right-aligned above the list on the
Bills tab only, opening a `FormSheet` titled **Show bills** — the kitchen's
pattern, one button rather than three, because three would crowd a phone row
and the kitchen already teaches this one. The button's label is the summary of
what is in force; **Clear** beside it resets everything.

Choices apply as they are tapped; the sheet's one button is **Done**. (The
kitchen's sheet saves to the tablet's record and needs Save and Cancel; this one
saves nothing.)

### Sort

| Sort | Key | Order words |
|---|---|---|
| Paid time (default) | `paidAt` | Newest first (default) · Oldest first |
| Order time | `orderedAt` | Newest first · Oldest first |
| Amount | `totalPaise` | Highest first · Lowest first |
| Wait | `paidAt − orderedAt` | Longest first · Shortest first |

Every key exists on every bill, cancelled ones included, so no combination of a
sort and a filter leaves bills with nothing to sort by. *Cancel time* was
dropped for that reason: with Paid ticked it would sort on a time none of the
bills have. *Items* was dropped by the owner. Ties break by bill number in the
same direction, so equal bills never swap between renders.

### Filters

Within a group, choices widen (OR); across groups, they narrow (AND). No choice
in a group means the group does not filter.

| Group | Choices | A bill matches when |
|---|---|---|
| Bill | Paid · Cancelled · Cancelled after paid · Payment undone | settled; void with `voidKind` `manager_void` or null; `cancelled_after_paid`; `counter_unpay` |
| Paid with | Cash · UPI · Split | `paymentMethod` is `cash`, `upi`, `mixed` |
| Customer | **All** · With number · Without · Gold (one choice) | any; a phone on the bill; no phone (a name alone counts as without); `customerTier = 'gold'` |
| Service | Dine-in · Takeaway | `serviceType` |
| Only bills that | Had a discount · Payment changed · Receipt failed | any whole-bill discount; `paymentRevision > 0`; `receiptDelivery.state = 'failed'` |
| Tablet | each billing tablet's name | `tillLabel` (shown only on a day with two or more) |

**Customer is single-choice** because its options overlap (Gold ⊂ With number)
and contradict (Without + Gold). As a single choice nothing can be both, and
*All* is the explicit default. *With details* was rejected as unclear [owner];
a name alone is not useful for finding a customer, so it counts as Without
[owner]. Production has 1,927 name-only bills against 733 with a number.

**Tablet** is the word the app already shows (*another tablet*, the Tablets
page, the bill's *on Till 1* line reads the tablet's own name); *Till* is an
internal word and was refused [owner]. A group with one option filters nothing,
so it is hidden on a one-tablet day.

**Every combination is a real question**, and checked as such: Bill × Paid with
(cancelled cash bills), Bill × Customer (cancelled bills with a number), Paid
with × Only bills that (UPI bills whose payment was changed), and so on. None
contradicts by construction. A combination that finds nothing reads *No bills
match* with a **Clear** button.

### What the filter does not touch

Cash, UPI, Total and AOV above the tabs read the whole day whatever is chosen.
The tab reads `Bills (12/140)` — shown of the day's — while a filter hides some,
and `Bills (140)` otherwise.

The choice lives in component state: it survives a change of day or outlet
(the reader is asking the same question of another day) and is cleared on
leaving the page. Nothing is written to browser storage.

## D5. Authority, tenancy and money

Both functions are `security definer` with `search_path = ''`, and both refuse
first:

- `overview_today_v2` calls `overview_assert_outlet`, exactly as
  `overview_today` does.
- `billing_day_stats` answers whoever `orders_select` lets read the outlet's
  orders — the owner, and that outlet's franchise admins — with the same guard as
  `manager_kitchen_marks_v2` (`app_device_ok`, `app_account_active`, owner or
  `app_outlets_for('franchise_admin')`), and refuses a null date.

A manager's crafted request for another outlet raises `42501` from both; pgTAP
proves it. No RLS policy changes. Money: one `sum(total_paise)` in `bigint`; the
stats are counts and whole seconds. No offline semantics: nothing here is
queued.

## D6. Version skew

- `overview_today_v2` and `billing_day_stats` are new. No published build calls
  them; every published build keeps calling `overview_today`, unchanged.
- After a revert the old build calls `overview_today` and the old diagnostics
  panel; the new functions sit unused until the contract migration of whatever
  change retires them. Nothing was written, so nothing is stranded.
- The Overview change sits on #76's on path (`OneRevenueCard`); with
  `one-revenue` off the old card reads `overview.sales` as before and shows no
  amount.

## D7. Demo

The demo answers both reads from its own store: `today()` adds the open, unpaid
orders of `store.today`; the stats are folded from `store.orders`,
`store.bills`, the billing commands, the dish workflow's readies and the demo
kitchen's acknowledgements, with the same definitions as D3. Demo mode writes
nothing new.
