# Proposal: Revenue Reads the Same Everywhere

> **Model**: Opus · **Wave**: F · **Roadmap**: #76 (owner request, 2026-10-15) ·
> **Depends on**: #52 (the Ledger's month P&L), #71 (Analytics), #75 (change
> gates) · **Gate**: Overview, the Ledger and Analytics give the same revenue,
> expenses and profit for the same outlet and dates, to the paisa; revenue counts
> every sale before commission, and commission is an expense on the date it
> belongs to; Overview's month runs through today and always compares with the
> same dates last month, up to the same time of day; Analytics offers **This
> month** in place of 30 days; no "Delivery data incomplete" or "Commission
> pending" appears on Overview; and with the gate off every one of those screens
> reads exactly as it does today.

## Why

On 2026-10-15 the owner compared Overview with Analytics and with the Ledger's
month view and found three different revenue figures for one outlet and one
month. All three were correct by their own rules, and the rules differ:

| | Overview (month tile) | Ledger (month view) | Analytics (Sales) |
|---|---|---|---|
| Dates | 1st → **yesterday** | 1st → **today** | Last 1, 7 or 30 days ending today, with no calendar month |
| Delivery | **After** commission | **After** commission | **Before** commission |
| Compared with | The same dates last month, unless delivery looks incomplete | Nothing | The equal window just before |

Kalyani Cafe's October, read from production that afternoon: Overview
**₹4,08,367**, the Ledger **₹4,43,997** (it includes today's ₹35,630 so far),
Analytics over 30 days **₹4,44,713** (it counts delivery's ₹278 before commission,
where the others count **−₹438** after it). Counter money agreed everywhere,
because every screen sums the same settled bills. The disagreement was only ever
the dates and the delivery basis.

Overview also said **Delivery data incomplete** and showed no comparison at all.
Both of the Cafe's channels are enabled, but ten of its fourteen October dates
have no delivery record. Overview treats a missing record as possibly missing
money, so it hid the percentage and the margin. The owner's view is that delivery
is simply included as far as it is known, and the screen says no more about it.

A reader who meets three numbers for one thing stops trusting all three. The
owner asked for **one definition, used everywhere**, with the Ledger kept as the
place where the figure is broken down.

## What changes

**One meaning for each figure**, on every screen that shows it:

- **Revenue** is everything customers paid: counter bills (cash and UPI, after
  bill discounts) plus each delivery channel's sales **before commission**, as
  the platform states them. A sale counts on its bill's business date. Delivery
  not yet imported counts as nothing and is not called out.
- **Commission** is what Swiggy and Zomato kept, from the day the platform states
  it. **It is an expense**, listed under **Delivery commission** on the date it
  belongs to. It is worked out from the delivery figures each time a screen reads
  them, and it is never typed in or stored as an expense row.
- **Expenses** are the recorded expenses plus commission.
- **Profit** is revenue less expenses. The figure equals the profit the Ledger
  shows today. Only its presentation moves: commission leaves the revenue line
  and joins the expenses.
- **The month** runs from the 1st through **today**, live. **A comparison** sets
  it against the same dates last month: 1–15 October against 1–15 September. On
  the last of those dates, last month counts only **up to the same time of day**
  as now, so a half-finished today is never set against a whole day.

**Overview**

- **Today's revenue** (was *Today's counter sales*) adds delivery imported for
  today to Cash and UPI, with the three named beneath it. It opens the Ledger's
  day view for today.
- **October revenue** includes today and **always** shows its change against the
  same dates last month. Where last month had no sales it says so (*No sales 1–15
  Sep*) instead of hiding the line. The header reads *Month to date*.
- **October P&L** includes commission in its expenses and always shows its margin.
- **No "Delivery data incomplete" and no "Commission pending."** Delivery health
  stays on the Delivery page and in Needs attention, where it can be acted on.
- On the 1st the tiles show the new month so far, compared with the previous
  month's 1st up to the same time. September in full is one tap away in the
  Ledger.

**The Ledger**, still the breakdown

- A day's and a month's **Revenue** is cash, UPI and each channel's sales before
  commission. Each channel keeps its gross, its commission and what was received,
  so nothing the Ledger shows today disappears.
- **Delivery commission** appears among the expenses: one line per channel per
  day, beside the recorded categories, counted in the expenses total and never
  in the drawer. It cannot be edited or withdrawn there; it changes only when the
  platform restates the day.
- The month's profit reads **Estimated profit** without *at most*. While a
  platform has not yet stated a day's commission, one line says how many days are
  waiting, and that profit falls by their commission once stated.
- "Today" is resolved through the outlet's own business-day change, as Overview
  does, instead of a fixed 4 am.

**Analytics**

- The date shortcuts become **1d · 7d · Month**. Month is the 1st through today,
  compared with the same dates in each earlier month, up to four months.
- Stepping back from Month moves a whole calendar month at a time. A whole past
  month compares with whole earlier months.
- **The same-time rule applies to every comparison whose range ends today**, 1d
  and 7d included: the headline's change and each dish's change set today so far
  against the matching day up to the same time. Chart points and table rows for
  earlier days stay whole days, as they are.
- Revenue keeps counting delivery before commission, as it already does, so
  Analytics' Month figure equals Overview's to the paisa.
- **Every comparison chart, on Sales and Items, says what the earlier periods
  came to** under its headline: `vs ₹1,42,469 (3–9 Oct, until 8:58 am)`. Items
  keeps its 1d · 7d · 30d, but its headline and each dish's change use the same
  time cut.
- Axis labels fit without colliding, and today's hourly chart ends an hour after
  the last sale.

## Change gate

- **`one-revenue`** (*RV*)
  - **On:** Overview, the Ledger and Analytics count revenue the same way: every
    sale before commission, commission as an expense, the month through today,
    and always a comparison with the same dates last month.
  - **Off:** Overview counts the month through yesterday with delivery after
    commission, the Ledger counts delivery after commission, and Analytics offers
    the last 30 days.

**Off is today, and nothing On saves outlives it.** The on path writes nothing:
commission is derived on read, and every new database object is a read. Turning
the gate off returns each screen to its present reading at the next reload.

**It depends on nothing.** When this was proposed, five such gates were live,
the limit. By 2026-10-16 `outside-tap-closes` had retired and `probe` had become
the gate system's own self-test, which the limit does not count, so this is the
fourth (design D9).

## Non-goals

- **Linking an outlet to the one it replaced.** Kalyani Cafe compares only with
  its own history, so until November its October tile says *No sales 1–15 Sep*.
  The owner decided this on 2026-10-15.
- **Weekly platform charges and tax deducted at source** (Swiggy advertising,
  TDS) stay out of revenue, expenses and profit, as today. #73 lists the weekly
  charges on Analytics; bringing them into profit is its own decision.
- **Estimating a commission the platform has not stated.** An unstated day
  contributes no commission until stated. The gap is at most about a week, and an
  invented rate would be a number nobody measured.
- **Comparing by weekday** ("the same weekdays last month"). Same dates is the
  rule. A month with an extra Saturday shows a slightly higher change, and the
  difference shrinks as the month goes on.
- **A comparison on the Ledger.** The Ledger is the breakdown; comparisons live
  on Overview and Analytics.
- **Splitting counter and delivery on Analytics.** Revenue stays combined; a
  split is a later change if the owner asks for it.
- **The Items page.** It keeps 1d · 7d · 30d and its equal windows (design D7).
- **The Items page's dish revenue.** It is a dish's own line total, already
  labelled *Dish revenue*, and is rightly smaller than Revenue: it leaves out
  packaging and whole-bill discounts.
- **Any change to what is recorded**: bills, payments, expenses, the drawer and
  the delivery sync are untouched. The counter and kitchen tablets are untouched.
- **The Delivery page and its alerts.** Stuck or missing delivery data is still
  reported there and in Needs attention.

## Capabilities

### New

- `business-figures`: one definition of revenue, commission, expenses and
  profit, of the month to date, and of a comparison, which every surface showing
  them obeys.

### Modified

- `outlets-overview`: today's revenue includes delivery; monthly figures run
  through today and always compare; no data-quality qualifiers.
- `ledger-statement`: revenue before commission; commission as a derived expense;
  no ceiling language on revenue.
- `profit-estimates`: unstated commission is named on the Ledger rather than
  presented as a ceiling on every surface.
- `sales-analytics`: the Month shortcut, month-aligned comparison windows, and
  the same-time rule for comparisons ending today.

## Impact

- **Database**: one migration adding the gate row, off, and six new read-only
  functions: two internal ones granted to no role (the compared windows with
  their cut, and the figures for a period), and `overview_today`,
  `overview_month`, `sales_analytics_v2` and `sales_analytics_series_v2`, each
  behind the authority check of the one it replaces. No table, column, policy or
  trigger. No existing function changes.
- **Overview**: four reads per outlet instead of six.
- **Ledger**: no new read. Commission as an expense is folded from the month and
  day inputs it already loads.
- **Analytics**: the same one read per range change, through the v2 function.
- **Counter and kitchen**: none. The request budget does not move.

## Docs To Update Before Archive

- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): **Revenue**, **Commission**,
  **Month to date** and **Comparison**, defined once. The **Cash sales** entry
  also stops saying revenue is grouped by `payment_business_date`; every revenue
  figure groups by the bill's `business_date`.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): Overview, the Ledger's day and
  month, Analytics → Sales and Items.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the new read functions and
  commission derived as an expense.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md): the demo's delivery days
  carry a stated, an unstated and a charge-only commission.
- [`docs/TESTING.md`](../../../docs/TESTING.md): the three-surface parity test.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): profit overstated by
  unstated commission for up to a week; weekly charges and TDS outside profit;
  same dates, not same weekdays.
