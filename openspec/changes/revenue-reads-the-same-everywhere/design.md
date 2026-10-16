# Design: Revenue Reads the Same Everywhere

## The owner's words, 2026-10-15

> I'd like if we can agree upon a single definition of these and use it
> everywhere. The ledger can always remain the source of truth for breakdown.
> Also the overview doesn't need to say Delivery data incomplete or other such
> stuff, we can always include the delivery and anything else. I'd prefer if we
> can always show the comparison with last month.

The questions put back to the owner, with the answers that day:

1. *Revenue before commission, with commission as a cost?* Yes, with commission
   **under expenses, on that particular date**.
2. *Include today?* Yes. **Replace 30 days with This month on Analytics.** The
   owner was concerned that partial-month comparisons would look skewed (D3
   answers it).
3. *Compare Kalyani Cafe with the old Kalyani's September?* No. **Outlets stay
   separate.**
4. *Today's tile: counter only, or counter and delivery?* **Combined for now**;
   Analytics may split them later.

## What was measured before deciding

Every figure below was read from production on 2026-10-15 (read-only).

- **Counter revenue already agrees.** For every settled bill, the effective
  payments sum to `total_paise`. Overview and the Ledger sum payments, Analytics
  sums `total_paise`, and both group by `bills.business_date`. September and
  October matched to the paisa on every date at all three outlets.
- **The delivery basis differs.** Overview and the Ledger count each channel-day
  as `net_paise` (or gross − commission) once commission is known and as gross
  before that. Analytics counts gross.
- **Net goes negative.** Kalyani Cafe's 1 October Zomato row is gross ₹0, net
  −₹611.07: a platform charge on a day with no orders. As revenue, that is a
  negative sale.
- **Delivery records are sparse at Kalyani Cafe.** Both channels are enabled, and
  ten of fourteen October dates have no row from either. `overview_revenue`'s
  `incomplete` flag was therefore true all month, which suppressed the
  comparison and the margin.
- **Delivery for a date first arrives about sixteen hours after the day starts**
  (the September median; earliest about ten hours), then is updated as the
  platform settles.

## D1. The definitions

For one outlet, a set of business dates, and optionally a **cut** (D3):

| Figure | Definition |
|---|---|
| Counter revenue | Σ effective cash and UPI allocations of settled bills whose `business_date` is in the set. With a cut on a date, only that date's bills with `ordered_at` before the cut instant count. |
| Delivery revenue | Σ `aggregator_channel_days.revenue_paise` for the outlet and dates, all channels: the platform's stated sales, before commission. |
| **Revenue** | Counter revenue + delivery revenue. |
| Commission (per channel-day) | Where `commission_paise` is stated: `revenue_paise − coalesce(net_paise, revenue_paise − commission_paise)`. This is the Ledger's own net rule, read the other way, so a day the platform restated as a negative net shows the charge in full. Where it is not stated, nothing, and the day is counted as **waiting**. |
| Recorded expenses | Σ `effective_expenses.amount_paise` by business date: the same rows as today. |
| **Expenses** | Recorded expenses + commission. |
| **Profit** | Revenue − expenses. |

**Profit is unchanged by this change.** With every commission stated, today's
Ledger profit is `counter + Σnet − recorded`, and the new one is
`counter + Σgross − Σ(gross − net) − recorded`, the same sum. With a commission
waiting, today's ceiling adds that day's gross as its net, and the new rule adds
its gross and subtracts no commission, again the same sum. Only the period (D2)
and the presentation move. A pgTAP case pins the equality, so a later edit to
either side fails loudly.

**Money arithmetic.** Integer paise end to end. Commission is derived per
channel-day and then summed, never from monthly totals or a rate, so a rate
changed mid-month stays right on both sides (the Ledger's existing rule). A
percentage exists only at the display edge. The domain fold asserts integer
inputs as `readMonth` does.

## D2. The period is the month to date, including today

The month runs from the 1st through **today's business date**, resolved with
`app_business_date` on the server and with the outlet's own cutover on the
client. The Ledger's month view currently resolves today with a hard-coded
`'04:00'`; on the gated path it uses `outlets.business_day_cutover`, as Overview
does. Every live outlet's cutover is 04:00 today, so nothing moves in practice,
but two screens would otherwise define "today" in two places.

A past month is the whole calendar month. On the 1st, Overview shows the new
month so far. Today's "previous full month" exception goes.

## D3. A comparison is the same dates, up to the same time

The comparison window for a current window `[from, to]`:

- **Month-aligned** (Overview, Analytics' Month): the same day-of-month span in
  the previous month, with its last date clamped to that month's length. A whole
  month compares with the whole previous month.
- **Equal windows** (Analytics' 1d, 7d and custom ranges): unchanged, the
  adjacent equal-length window(s).

**The cut.** When the current window ends today, the matched last date of each
earlier window counts counter bills only up to the same time:
`cut = matchedDate's business-day start + (now − today's business-day start)`,
with each business-day start computed through the outlet's cutover. At 15:40 on
15 October, 15 September counts bills ordered before 15:40 on 15 September.

**Delivery on the cut date.** Delivery rows carry no time. The matched date's
delivery is counted only once today's delivery has arrived, meaning the current
window has at least one channel row for today. Before about 8 pm neither side
has delivery for its last date. After that, both do: today's partial import
against that date's settled figure, a bias toward last month that shrinks
overnight.

**When the cut does not apply.** If the matched date is clamped (31 October
against a 30-day September), the matched date is a different day of the month,
the earlier window counts whole, and the current window has one more day than the
earlier one. That is the same imbalance any calendar comparison has across months
of different lengths.

**What is cut, and what is not.** A comparison figure is cut: a percentage
change, a previous-period total set beside the current one, a dish's previous
units or revenue, a fitted trend across several periods. A chart point or a table
row for an earlier date is a reading of that date and stays whole. The table's
earlier-period total row says *to 15:40* where it is cut.

**Why not compare whole days and accept the dip.** The owner's concern was
exactly that a partial period reads as a fall. Without the cut, every morning
would show today's revenue down about 90% against yesterday on 1d, and the
month's change would sink every morning and recover every night.

## D4. Commission is an expense derived on read, never stored

The owner asked for commission "on that particular date's expenses". It appears
there, but derived, not written into `expenses`:

- **On the Ledger day:** an expense line per channel with a stated commission,
  labelled *Zomato commission* or *Swiggy commission* and categorised **Delivery
  commission**. It has no recorder, no edit, no withdraw, and it is not cash, so
  it never touches the drawer timeline. A channel waiting for its commission
  shows its *not known yet* as today and adds no line.
- **On the Ledger month:** a **Delivery commission** category in the breakdown,
  with one line per channel-day beneath it, sorted with the others by amount.
- **On Overview:** inside the P&L tile's expenses.
- **Not on the Expenses page** (the staff-and-manager list of recorded
  expenses). Billers see that list, and they never see delivery revenue
  (`ledger-statement`, *Biller and Employee accounts receive only the shared
  expense list*). Commission would reveal it.

**Rejected: writing commission into `expenses`.** Platforms restate a week after
it closes, so a stored copy goes stale the moment Zomato revises a day. It would
then need its own sync, its own idempotency key and its own withdrawal on
restatement, which is a second source of truth for a figure that already has one.
It would also reach the Expenses page and the billers through it. It would put
rows into a table every published build reads, which the gate could not take
back.

## D5. Overview reads two figures, not four

Today Overview makes six reads per outlet: sales, drawer, revenue, previous
revenue, expenses, tablets. On the gated path it makes four:

- `overview_today(p_outlet_id)` returns `{ cashPaise, upiPaise, deliveryPaise }`
  for the server's today, through the outlet's cutover.
- `overview_month(p_outlet_id)` returns
  `{ month, from, through, revenuePaise, counterPaise, deliveryPaise,
  commissionPaise, waitingDays, recordedExpensesPaise, hasSales,
  previous: { from, through, cutAt | null, revenuePaise, hasSales } }`.
  The revenue and P&L tiles share it, as they share a read today.
- `overview_drawer` and the tablets read, unchanged.

Both new functions take no date. The server's clock and the outlet's cutover
decide "today", so a phone with a wrong clock cannot ask for a different month,
and the cut instant comes from one clock. The client still recomputes its
display labels each minute, and a new read is triggered when the business date
the client resolves changes, as now.

Both call an internal `revenue_figures(p_outlet_id, p_from, p_through,
p_cut_at timestamptz, p_count_last_delivery boolean)`, granted to no role, which
is D1 in one place.

**Today's tile says as much as fits** (owner, 2026-10-16). Cash, UPI and
delivery share one line in the longest form the cell's real width allows: words
(*Cash ₹3,595 · UPI ₹1,823 · Delivery ₹0*); then delivery becomes a bike; then UPI
a QR code; then cash a note, in the owner's order. Only when even that does not fit,
two lines in words: the counter's tenders, then delivery. Every form is measured
hidden against the cell and re-chosen on resize. On a 375px phone the cell has
151px: the all-icon form of a ₹3,595 / ₹1,823 / ₹0 day takes 150px, the words
197px. A fixed second line, and a single line of shop and bike icons with no
Cash/UPI split, were both tried and dropped.

**Tiles.**

- **Today's revenue**: Cash · UPI · Delivery beneath in compact notation; links
  to the Ledger's day view for today, the one screen that breaks down all three.
  The day view's billing history stays one tap from the Ledger.
- **{Month} revenue**: the subtext always shows a change: `▲ 5.2% vs 1–15 Sep`.
  The tooltip and accessible name add *to 3:40 pm* when cut. With no sales in the
  earlier window it reads `No sales 1–15 Sep` and the icon stays neutral. The
  only other text a comparison can show is the read's own error (*Comparison
  unavailable*, with retry).
- **{Month} P&L · est.**: `Expenses ₹X · 12.3%` whenever revenue is above zero.
  With no sales all month it says *No sales recorded*, as today.
- The header reads *{date} · Month to date*.

**Rejected: linking Today's revenue to Billing history** (today's link). The
figure now includes delivery, which Billing history does not show. A tile should
open the page that adds up to it.

## D6. The Ledger keeps every figure and moves two

The Ledger is the breakdown, so nothing it shows today is removed:

- **Day, revenue section**: rows Cash, UPI and each channel's gross, then
  **Revenue**. Each channel keeps *Less commission* and *Received*, as today. The
  ceiling note (*Revenue received, at most*) goes: the revenue no longer depends
  on a commission.
- **Day, expenses section**: the Delivery commission lines (D4), counted in the
  day's expenses total.
- **Month**: **Revenue** (gross, channels gross) with a *Received after
  commission* row beneath for the cash-in figure. The expenses breakdown gains
  Delivery commission. **Estimated profit**, cash-basis operating estimate, as
  now. If any channel-day is waiting: one line under profit, *3 days' delivery
  commission not stated yet. Profit falls by it once stated.*
- **Discounts given** stays beside revenue, worded the same.

The fold is a new pure function in `src/domain/` beside `readMonth`
(`readMonthFigures(days, reading)`). `readMonth` and its tests are untouched, so
the off path is the code as it is. The day reading gains its commission lines in
the gated surface from the channel rows it already holds. **No new read.** The
month already loads every channel-day through `ledger_month_inputs`.

### The words the owner chose (2026-10-16, from the first demo)

Under each channel's sales the Ledger shows two smaller, indented reference rows,
**Zomato commission (expense)** and **Zomato received**, and the channel's own row
reads **Zomato (revenue)** instead of *as stated*: "just put like expense and in
brackets". The owner's first reading of an earlier draft (*Zomato commission, in
expenses* with a minus sign) was that commission was subtracted twice. The minus
sign is gone, the reference rows are smaller than the rows that add up, and the
note under Revenue says commission is shown for reference only and taken off
once, in the expenses. A month with a commission still waiting reads *(expense,
so far)* and *received (at most)*. A sentence in place of the two rows was tried
and dropped: the owner reads tiles, not sentences.

## D7. Analytics: Month, aligned windows, and a cut

**Sales only** (decided while building the demo, 2026-10-16). Items ranks dishes
and shows no figure another screen must match, and Month there would need a
second v2 function for the dish chart's series. Items keeps 1d · 7d · 30d and
its equal windows; the Month shortcut, month windows and the cut appear on Sales.

- **Shortcuts.** `1d · 7d · Month`; Month replaces 30d. The range keeps
  `from`/`to` in the address and gains `align=month`. A custom range drops it.
  Stepping with Month moves by calendar month (Oct 1–15 → Sep 1–30 → Aug 1–31),
  and the forward step stops at the current month.
- **`sales_analytics_v2(p_outlet_id, p_from, p_to, p_view, p_periods,
  p_align text default 'equal', p_cut text default null)`.** It is `sales_analytics` (as of
  `20261013000000_items_follow_their_measure`) with:
  - window `k` computed by `p_align`: `equal` reproduces today's arithmetic
    exactly; `month` shifts `from` and `to` back `k` months, clamping `to` to the
    month's length, or taking the month's last day when `to` is a month end;
  - the period index taken from window membership instead of
    `(p_to − business_date) / v_span`, because month windows differ in length;
  - a new `totals` key: one row per window with `revenue`, `orders` and
    `units`, cut on each earlier window's matched date (D3), and
    items' `previousUnits`, `previousRevenue`, `periodUnits` and
    `periodRevenue` cut the same way;
  - `days`, `hours` and `delivery` unchanged and uncut.
- **The client** sends `p_cut = 'now'` when the range ends today and null
  otherwise. It never computes the cut instant itself: the server resolves it
  from `now()` and the outlet's cutover, and reads `'now'` as no cut when the
  range does not end on the server's today (a page left open across the day's
  change). No client clock enters a figure.
- **Headline and comparisons** read `totals`. The chart reads `days`, as now.
- **Several periods.** With three or four, the fitted trend reads the cut totals
  too, so a trend never treats this partial month as a fall.

The day axis of a month-aligned chart is the day of the month. A 30-day
September plotted beside a 31-day August ends one point early. "Aligned by
elapsed day", which the spec already uses, is the same thing for windows that
start on the 1st.

**The line under Sales' headline** (owner, 2026-10-16): with the gate on it shows
what each earlier period came to, not a description of the measure. One earlier
period reads `vs ₹1,42,469 (3–9 Oct, until 8:58 am)`; several read
`vs 448 (1–16 Sept) · 435 (1–16 Aug), each until 8:38 am`; without a cut the time
goes; Current only reads the range. The dates sit in the brackets because
`(to 8:58 am)` alone read as today (owner, 2026-10-16). One helper,
`comparedLine`, writes it for every comparison chart.

**Items reads the same way** (owner, 2026-10-16: "a consistent style for any
graphs that do comparison with past"). Its range and read are unchanged (still
1d · 7d · 30d), but with the gate on its headline compares totals cut at the
same time and carries the same line. The demo showed why it matters: a 7-day
range ending at 9:20 am read −8% against whole days and +16% against the same
time. The dish chart's series gains its cut totals through a new
`sales_analytics_series_v2`. The Dishes list's per-dish change still compares
whole days; whether it should be cut too is open with the owner.

**Charts read more easily** with the gate on (owner, 2026-10-16). Axis labels
are spaced by their width, centred and kept inside the frame, so a week shows
every date without `10 Oct11 Oct` running together, and a day's hours show every
third hour instead of two anchors. A current one-day hourly chart ends one hour
after the last hour any compared day sold in, or at the ongoing hour, instead of
running on through closed hours to the cutover. *Counter +
delivery*, *Counter bills only* and the Delivery coverage chip go, and the hourly
card drops *Counter only* ("we don't have to say counter versus counter plus
delivery"). The hourly chart still counts counter bills only, because delivery
carries no order time; the About sheet keeps saying so.

## D8. One definition, held by one test

Three readers implement D1: `revenue_figures` (Overview), the domain fold over
`ledger_month_inputs` (the Ledger), and `sales_analytics_v2` (Analytics).
Three implementations is the shape that drifted. Merging them into one function
was rejected: the Ledger's month is deliberately one read of exactly what it
renders (`the-ledger-reads-fast-and-keeps-its-place`), and Analytics' payload is
bounded per view for egress. Instead:

- **pgTAP** seeds one month with bills (including one voided and one corrected),
  a stated, a waiting and a charge-only delivery day, and recorded expenses, and
  asserts `overview_month`'s revenue, commission, expenses and profit equal the
  sum of `sales_analytics_v2`'s `totals` for the same window. It also asserts the
  profit equality of D1 against `overview_revenue` and `overview_expenses`.
- **A Vitest parity test** in the DB suite that already holds the Ledger's day and
  month together folds `ledger_month_inputs` with `readMonthFigures` and asserts
  the same four figures equal `overview_month`'s, to the paisa.
- **The demo** answers all three adapters from one fixture, and a unit test
  asserts the three agree there too.

## D9. The gate, and the root-gate limit

One gate, `one-revenue` (*RV*), on every toggle point: Overview's tiles, the
Ledger's day and month, Analytics' shortcuts and comparisons. One gate rather
than one per screen, because the change is the agreement. Two of three screens
agreeing is the state this change exists to end.

It depends on nothing, and `MAX_ROOT_GATES` is 5 with five roots live on `stage`.
**Rejected: declaring it dependent on `fewer-requests`** (or any live gate) to
fit. A dependency says this change runs only with that one, which is false, and
it would switch off the figures whenever the owner pulls an unrelated gate. The
gate is declared once a root retires (task 1.1 checks). Everything before the
declaration (domain, demo, migration functions) can be built and reviewed
meanwhile.

## Version skew

- **`revenue_figures`, `overview_today`, `overview_month`, `sales_analytics_v2`**
  are new. `overview_sales`, `overview_revenue`, `overview_expenses` and
  `sales_analytics` are untouched; the off path and every published build keep
  calling them. Nothing is replaced, dropped or retyped.
- **`ledger_month_inputs` and the Ledger's day reads** are untouched. The gated
  path folds what they already return.
- **The `change_gates` row** is inserted off.
- **A build published before the migration** never calls the new functions. **A
  build published after it** with the gate off calls only the old ones.
- **Nothing is persisted on the on path**, so turning the gate off strands
  nothing. `roundTrip: 'none: every figure is read and derived; the on path
  writes nothing'`.
- **Retirement** later deletes the off path. The contract migration may drop
  `overview_sales`, `overview_revenue`, `overview_expenses` and `sales_analytics`
  once every tablet has run the new build for a week.

## RLS and authority

No table and no policy change. Every new function is `security definer` with
`search_path = ''` and starts with the authority check of the function it
replaces: `overview_assert_outlet` for the Overview pair, and `sales_analytics`'
owner-or-assigned-Franchise-Admin check (with `app_account_active()`) for v2.
`revenue_figures` is granted to no role and reachable only through them. pgTAP
proves a Franchise Admin's crafted request for another outlet is refused by each,
a Biller and an Employee are refused, and anonymous is refused.

## Offline

None. These are online reads on owner and manager phones; the counter, its outbox
and the kitchen are untouched.

## Coordination with #73

#73 (`sales-shows-what-delivery-kept`, proposed) adds a delivery section to
Analytics → Sales and planned to replace `sales_analytics` in place. It was
written before migrations only add. Whichever of the two lands second extends the
other's function under a new name rather than editing it. The two disagree on
nothing: #73 shows per day what this change counts as revenue (what customers
paid) and as commission (what the platform kept).

## Rejected alternatives

- **Revenue as what was received (net), everywhere.** A charge-only day becomes a
  negative sale (−₹611 on 1 October). Revenue would change for a week after every
  day as commission is stated, which is why the screens carry *at most* and
  *Commission pending*. It would also break Analytics' daily chart with negative
  days. Gross with commission as a cost reaches the same profit without any of
  that.
- **The month through yesterday, everywhere.** The owner wants today, and the
  Ledger's day view must show today regardless.
- **Same weekdays last month.** It answers the weekday-mix skew, but a date range
  stops reading as dates. Deferred unless same dates proves misleading in use.
- **Linking Kalyani Cafe to Kalyani.** Refused by the owner.
- **Estimating waiting commission at the last stated rate.** It invents a figure
  for at most a week on a channel the Cafe barely uses.
- **Keeping 30 days beside Month.** The owner chose to replace it. A custom range
  still gives any 30 days.
- **One server function feeding all three screens.** See D8.
- **Keeping "Delivery data incomplete" on Overview but showing the comparison
  anyway.** The qualifier fired on every date the Cafe had no delivery orders,
  which a sync cannot tell apart from a missing import. Sync health is reported
  where it can be repaired (Delivery, Needs attention).
