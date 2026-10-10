# Design

## The owner's words, 2026-10-10

The request arrived in three passes, and each settled something:

1. *"In the Delivery page I would like to include a chart/graph to show what zomato/swiggy has charged each day, with clear colors for those which are settled, those which are daily etc. and also separate commission and original amounts. Make sure it looks pretty and not cluttered or confusing."* — placed then above the Delivery page's run list.
2. Moved to **Analytics → Sales**, "now that it is built". Delivery Orders and AOV were asked about and **dropped**: the database stores one figure per day per channel, never how many orders made it up.
3. *"Add a heading text above the new delivery card (the card itself will have its own header for Zomato Revenue/Swiggy Revenue etc.) so that it acts as a separator clearly demarking that the below is only revenue and only day level binning."* And: *"a column bar chart … separate colors for what was the commission and what was the total … for days which does not have the latest commission value maybe we can also somehow mark it on a different color outline border shade … I really like filled bars more than shaded … the proposal should include that it should first show me how the ui would look before building it."*

## Sketch

```
  ─────────────────────────────────────────────
  Delivery revenue · by day
  Zomato and Swiggy only. One bar per day; the
  measure, grouping and comparison above don't apply.
  ─────────────────────────────────────────────
  ┌ Zomato revenue ─────────────────────────────┐
  │ [Customers paid ₹12,400] [Kept ₹3,710] [You get ₹8,690] │
  │                                              │
  │       ▆        ▇                ▅            │  ▆ kept (top)
  │   ▅   █    ▃   █   ▆            █   ╏▄╏      │  █ you get (bottom)
  │ ──█───█────█───█───█────────────█───╏█╏───── │  ╏ outline = not final
  │                         ▀ (charge, red)      │  ▀ below zero
  │  1   2    3   4   5   6   7   8   9   10     │
  │ • Final  • Not final  • Cut not known  • Charge │
  └──────────────────────────────────────────────┘
  ┌ Swiggy revenue ────────────────────────────── ┐
  │  …same…                                       │
  │  Weekly charges                               │
  │  Ads · 20–26 Sep · −₹578.20                   │
  └───────────────────────────────────────────────┘
```

The sketch fixes the arrangement, not the look. **Tasks 1–3 render it against demo data and stop for the owner's approval** in both themes on a phone and a portrait tablet; colours, heading wording, legend wording and the long-range behaviour are settled there, and recorded in this file, before any database or live work starts.

## Where it sits and what it follows

The section goes **below every existing Sales card**, after the hourly card, behind its own heading. It is shown whatever the page's Measure (Revenue/Orders/AOV) and Group by (Hour/Day/Week) say, and it ignores the period comparison: it draws the **current period only**, by **business date**, one column per day. It follows the page's outlet and date range, so a 1-day range is one column and a 30-day range thirty.

The heading is the owner's separator. Every Sales card above it changes with the Measure and Group-by controls; this section never does, and without a heading a reader would expect it to.

**One card per channel** that has at least one day recorded in the range, Zomato first. An outlet with no delivery figures in the range shows the heading and one line saying so, rather than empty cards; an outlet with no channel at all and nothing recorded shows nothing.

## Encoding

A recorded day is one `aggregator_channel_days` row. Its column:

| Row | Column |
|---|---|
| commission known, net ≥ 0 | stacked from zero: **you get** (net) at the bottom, **kept** (commission) on top; total height = what customers paid |
| commission known, net < 0 | (a charge with no or too little sales) a column **below zero** to the net, in the **charge** colour; any sales above zero as usual |
| commission null | one column of what customers paid, in the **cut not known** fill |
| `settlement_state = 'provisional'` | the same fills, plus the **not final** outline |
| `settlement_state = 'disputed'` | as provisional, plus a small red dot above the column |
| no row for the day | no column; inspection says *No figures recorded*, never zero |

Colours are **solid fills only**; the owner rejected hatch and striping. Four new semantic series tokens (`--chart-delivery-net`, `--chart-delivery-kept`, `--chart-delivery-unknown`, `--chart-delivery-charge`) and one outline token (`--chart-delivery-provisional`) are defined in the brand token layer for both themes and read by the component; no hex literal in a component. They join the contrast validator. The legend shows only the entries present in the card's range, so a fully settled week carries no "not final" key.

The y-axis is per card (Zomato and Swiggy differ by an order of magnitude) and always includes zero, so a charge column has room below it.

## Inspection

Pointer, touch and keyboard inspection behave as on every other Sales chart (nearest column; arrows, Home, End; the focus ring only when reached by keyboard). The readout names the date, **Customers paid**, **Kept by Zomato/Swiggy** and **You get**, and the status in words: *Final*, *Not final yet*, *Cut not known yet*, *Disputed* or *No figures recorded*. Rupee figures follow the page's card rule (whole from ₹100, two paise digits below).

## Weekly charges

Charges stated for a week rather than a day — `aggregator_cycle_deductions` rows, today only Swiggy `advertising` — are listed under that channel's columns as `Kind · week range · amount`, when the week overlaps the range. They are not spread across columns: the platforms state them per week, and dividing them by seven would invent daily figures. **Hyperpure** bills collected through a Zomato payout are excluded: they are stock bought, not a platform charge, and already sit in Expenses.

## Data

`sales_analytics` (view `sales`) already returns `delivery: [{date, channel, revenue, provisional}]` from `aggregator_channel_days` for the read's whole span. It is replaced once more with the **same signature** (as `20261013000000_items_follow_their_measure.sql` did), each delivery entry gaining `commission` (integer paise or null) and `state` (`settled`/`provisional`/`disputed`); `provisional` stays for the existing Revenue disclosure. The sales view gains `deliveryCharges: [{channel, kind, periodStart, periodEnd, amount}]` for deductions overlapping the current window. The items view returns neither.

- **No extra read.** The section is built from the snapshot the page already loads; it adds rows bounded by 92 days × 2 channels plus a handful of weekly charges, and nothing on measure, grouping or chart/table switches.
- **Money.** Display only. *You get* is the row's stored `net_paise`, which a check constraint holds equal to `revenue_paise − commission_paise`; *Kept* is `commission_paise`. Card tiles sum integer paise. Nothing is computed into storage.
- **RLS.** No table or policy changes. The RPC is `security definer` behind the existing owner/manager authority check, which now also covers the deductions it reads; its pgTAP proves a manager's crafted request for another outlet returns nothing of that outlet's.
- **Offline.** None; Analytics is online-only.
- **Demo.** The demo's delivery history gains commission and state on every day, with at least one charge-only day, one cut-unknown day, one disputed day, a not-final run at the end, and one weekly ads charge, so every encoding is visible in the demo and in the approval screenshots.

## Rejected

- **The Delivery page** (the owner's first placement). It reads sync health and repairs sign-ins; the figures are read in Analytics.
- **Following the page's Measure and Group by.** Delivery has no order counts, so Orders and AOV would be counter-only anyway, and weekly bars would hide the single charge-only day the feature exists to show. The owner asked for day-only, revenue-only, behind a heading.
- **Delivery Orders/AOV.** Dropped by the owner; it needs order counts stored by the ingest and a sync-repo change.
- **Hatched or striped bars for figures that are not final.** The owner prefers filled bars; an outline carries the state.
- **One card with a Zomato | Swiggy switch.** The owner described the card header naming the channel; two short cards show both without a tap. To be re-checked at the mockup.
- **Comparing earlier periods here.** Two series per day already; a comparison would double it.
- **A separate RPC for the section.** It would be a second request for rows the snapshot already scans.
- **Spreading weekly charges across days.** It would invent daily figures the platforms never stated.
