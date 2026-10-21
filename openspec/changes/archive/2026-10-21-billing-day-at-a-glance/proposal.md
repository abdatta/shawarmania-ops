# Proposal: The Billing Day at a Glance

> **Model**: Opus · **Wave**: F · **Roadmap**: #78 (owner request, 2026-10-16;
> every layout chosen by the owner from sketches the same day) · **Depends on**:
> #76 `revenue-reads-the-same-everywhere` (the Overview card this adds to), #74
> `each-dish-is-ticked-off` (the kitchen's acknowledgements and readies it
> counts) · **Gate**: Overview's Today's revenue carries a smaller `· ₹X` beside
> it, the total of today's unpaid open orders, and tapping the tile opens Billing
> history; the Open orders tab lists only the selected day's orders and names
> their unpaid total; the Stats tab (was Status) shows Counter, Kitchen and Bills
> figures for the whole selected day, matching a hand count against that day's
> rows, with a sync chip that always speaks for now; the Bills tab's Filter sheet
> sorts and narrows the day's bills, every combination producing a sensible list,
> while Cash, UPI, Total and AOV still read the whole day; a manager's crafted
> request for another outlet is refused by both new reads; and the four-role demo
> walkthrough still walks.

## Why

On 2026-10-16 the owner listed what Billing history and Overview leave them
guessing about:

- **How much sale is in progress.** Today's revenue counts what was paid.
  Orders still open — rung, being cooked, not yet paid — are invisible until
  they settle, so mid-rush the tile under-reads what the counter is doing.
- **Tapping Today's revenue went to the Ledger.** #76 moved it there; the owner
  wants Billing back, and that fix lands in #76 itself (its on path, before it
  archives), not here.
- **Open orders ignored the date.** The tab listed every open order whatever day
  the bar showed, so stepping back to yesterday still showed today's orders.
- **Status was the last 100 commands, not the day.** Its counts covered whatever
  the newest hundred tablet commands happened to be — a few hours on a busy day,
  several days on a quiet one — and its technical details were never read.
- **The Bills tab had no way to find anything.** A day is 100–200 bills; finding
  the cancelled ones, the large ones, or the ones with a customer's number meant
  scrolling.

## What changes

**Overview — Today's revenue** (the #76 card, `one-revenue` on)

- Beside the headline, after a `·`, the **total of today's open, unpaid orders**:
  `₹35,630 · ₹1,240`. Smaller than the headline, in the size, weight and colour
  of the Cash · UPI · Delivery figures beneath, dropping to half the headline's
  size and then losing the tile's icon only where a phone's cell cannot hold it.
  Exact rupees, never shortened to `1.2k`.
  No label, icon or explanation [owner]. Shown only when it is above zero.
- It does not join the revenue figure and is not called revenue anywhere. Paid
  orders still being cooked are already in revenue and are not counted again.
- It arrives in the same read as the rest of the tile (`overview_today_v2`), so
  the card makes no extra request.

**Billing history — Open orders**

- The tab follows the day bar: it lists the selected business day's open orders
  and nothing else. A past day shows only orders of that day that are still open,
  which is usually none. The tab's count is that day's.
- Above the list, the day's **unpaid total** — the open, unpaid orders' totals
  summed, the same figure Overview shows for today.

**Billing history — Stats** (was *Status*)

- Renamed **Stats**. A sync problem still puts its count on the tab, `Stats (1)`,
  and the count turns red so it reads as a warning, not a number of stats.
- At the top, a **sync chip** that ignores the date and speaks for now: *In sync ·
  2 min ago*, or *2 sync problems* in red with the problems listed beneath it, as
  today. The **Show technical details** disclosure is gone [owner].
- Three groups, one below the other, each one card split into a 2 × 2 grid by
  hairlines, number over caption — the Overview card's look, deliberately unlike
  the Cash / UPI / Total / AOV tiles above the tabs [owner]:
  - **Counter**: Placed · Updated · Cancelled · Paid
  - **Kitchen**: Seen · Ready · Avg to ready · Avg handover
  - **Bills**: Bills cancelled · Cancelled after paid · Payment undone · Payment
    changed
- Every figure is the **whole selected day**, from one read
  (`billing_day_stats`), never the last hundred commands.

**Billing history — Bills**

- One **Filter** button above the list, like the kitchen's, opening a sheet.
  Its label names what is in force (*Cancelled · Amount, highest*); **Clear**
  sits beside it while anything is chosen. The tab reads `Bills (12/140)` while
  a filter hides some.
- **Sort by**: Paid time · Order time · Amount · Wait. **Order** speaks the
  sort's language: Newest / Oldest first, Highest / Lowest first, Longest /
  Shortest first. The default is today's list: paid time, newest first.
- **Filters**: Bill (Paid · Cancelled · Cancelled after paid · Payment undone),
  Paid with (Cash · UPI · Split), Customer (All · With number · Without · Gold),
  Service (Dine-in · Takeaway), Only bills that (Had a discount · Payment
  changed · Receipt failed), and Tablet (each billing tablet by name, only on a
  day two or more took bills).
- Cash, UPI, Total and AOV never change with a filter: they are the day's.
- Kept while the day or outlet changes; cleared on leaving the page. Nothing is
  read again: the day's bills are already in hand.

## Change gate

**No gate:** a revert is enough (AGENTS.md → *A revert is enough*), and both
conditions hold.

1. **The revert is clean.** The change writes nothing: the migration adds two
   read-only functions no published build calls, and the screens keep the
   filter in memory only, with no browser storage. After a revert every row,
   outbox item and stored value is exactly what the old build expects.
2. **It cannot reach the live counter or kitchen.** Billing history and
   Overview are owner and manager screens; no counter or kitchen screen renders
   them. No shared component is changed — the sheet is the shared `FormSheet`
   used as it is — and the billing adapter's counter reads (`readOrders`, the
   outbox, polling) are untouched: the Open orders date filter is applied on the
   manager's own list, and the count adds an optional date only the manager
   passes. The new reads run when an owner or manager opens a tab or Overview, a
   handful a day, against indexed rows of one outlet-day.

## Non-goals

- **Counting the in-progress amount as revenue**, or explaining it on screen
  [owner: "people will get it"].
- **A stat for every command type.** Twelve figures, chosen with the owner.
  Tablet sign-offs, corrections and points stay out.
- **Saving a filter** across visits or devices, or offering one on Open orders.
- **Searching bills by number or name.** The filter narrows by kind; search is a
  separate idea if it is ever asked for.
- **Bills rung after a shift ended** as a filter: production has none in 3,302
  bills (read 2026-10-16), so it would never match.
- **Sorting by item count**: dropped by the owner.
- **The old Overview card** (`one-revenue` off) keeps its tile and link as they
  are.
- **The counter's own screens**, the kitchen, the outbox and the request budget:
  untouched.

## Capabilities

### Modified

- `counter-billing`: Billing history's Bills tab sorts and filters; Open orders
  follows the selected day and names its unpaid total; Stats replaces the sync
  diagnostics' grouped counts and technical details with the day's figures and a
  sync chip.
- `outlets-overview`: Today's revenue names the unpaid open orders beside it.

## Impact

- **Database**: one migration adding `overview_today_v2` and
  `billing_day_stats`, read-only, each refusing a caller who may not read that
  outlet's orders. No table, column, policy, trigger or changed function.
- **Overview**: the card's today read becomes `overview_today_v2`; same count of
  reads.
- **Billing history**: one new read when Stats is opened or its day changes; the
  open-order count gains the day.
- **Counter and kitchen**: none.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md): Billing history (Bills filter,
  Open orders by day, Stats) and Overview's Today's revenue.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): **Avg to ready**, **Avg
  handover**, **Payment undone**, **Payment changed**, defined once.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the two new read
  functions.
