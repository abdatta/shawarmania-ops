# Design: part-months-cost-what-was-agreed

Settled with the owner on 2026-10-31, one scenario at a time (Q1–Q5 below).
Read with #79's design (`fixed-costs-are-spread-over-the-month`, D3–D10), whose
decision 6, *a start date, prorated*, this reverses for the screens.

## D1. A part month's figure is a settlement

#79 already has a record that says *this month costs exactly ₹X*: a
**settlement** (`fixed_cost_settlements`), the latest unvoided one winning
(`monthCost`, `fixed_cost_month_cost`). It is what *That's all for October* and
**Drop** write. So an agreed part month needs no new table and no new rule: with
the gate on, **every part month the app creates carries a settlement**, written
by the same function that sets the start or stop date.

- The day share stays in `monthCost` and `fixed_cost_month_cost` as the
  fallback for a part month with no settlement. Changing it would mean a
  `fixed_cost_month_cost_v2` and a v2 of every function that calls it
  (`fixed_cost_months`, `record_fixed_cost_payment`, `stop_fixed_cost`,
  `fixed_costs_unpaid`) — the pay function would then disagree with every
  published build about what is owed. Rejected: the fallback is unreachable
  from the on path, and the shared case table keeps the two copies agreeing.
- The part months that exist without a settlement when the gate turns on are
  closed by **Close {Month}** (D3). In production on 2026-10-31 there is one,
  Jayanta Da's October; Garbage's October is already settled at ₹2,400.

## D2. Stopping asks for the final payment (Q3)

The owner's people do not add up a month's total at closing; they know what
they handed over last. So the Stop sheet asks for the **final payment**, on top
of what the month already has, and the month is settled at the two together:

```
already(month) = max(0, Σ payments counted on or before today
                        − Σ cost of every month before `month`)
closing(month) = already(month) + final
```

`already` is first-in-first-out (#79 D4) read from the stop month: what payments
leave for it once every earlier month is paid, including an advance paid in an
earlier month. Where an earlier month is still short, `already` is 0 and the
earlier month stays overdue; the final payment then pays the oldest month first,
as every payment does.

- **Starts empty**, whole rupees (`parseWholeRupees`: digits only, 0 allowed).
  **Nothing more** fills 0. No prefill (owner, explicit).
- **Paid now** records the final payment through `record_fixed_cost_payment`
  inside the same transaction, dated the last day (or today, if the last day is
  still ahead), counted on that day, noted *Final payment*, with no choice: once
  the month is settled at `already + final`, `final` is exactly what is owed, so
  the pay function asks nothing. **Paying later** records none.
- **Below what is paid cannot be typed**: the field is the addition, never
  negative. The old *paid ahead: Clear / Keep* choice goes with it.
- **Rejected: asking for the month's total** (the first sketch, *October came to
  ₹…*). The owner's own example was *he paid an additional ₹2,000 at closing*,
  and a total invites typing what was paid so far as the closing figure.
- **Rejected: a separate Pay after Stop**. Two steps is how the ₹2,000 at
  Jayanta Da's closing was never entered.

`stop_fixed_cost_v2(p_fixed_cost_id, p_stops_on, p_final_paise, p_payment_id,
p_is_cash)` does it in one transaction. A retried tap finds the payment's link
by `p_payment_id` and returns before settling again, so `already` is never
counted twice.

## D3. Close {Month}

A stopped cost whose stop month is a part month **with no settlement** shows
**Close {Month}** on its page where **Stop** was. It opens the same sheet with
the last day already set, and saves through `stop_fixed_cost_v2` with that day.
This is how Jayanta Da closes on the new build: final ₹2,000, Paid now.

## D4. Starting mid-month asks what that month comes to

Add, when the start is not the 1st, asks **{Month} comes to (₹)**, empty,
required, whole rupees, with *From {next month}, ₹X a month* beneath. Edit asks
the same when the start date is changed to a day that is not the 1st.
`create_fixed_cost_v2` and `update_fixed_cost_v2` take `p_first_month_paise`
and write the settlement for the start month in the same transaction.

A start month asks for a total, not an addition: nothing has been paid yet.

## D5. On screen

- **The list**: no *· 28 days*. A stopped cost (last day before today) reads
  *Salary · Stopped 28 Oct*; one stopping later this month, *Stops 31 Oct*.
- **Done** = stopped, and nothing left this month or overdue. A done row is
  greyed (`opacity-60`), its ring is the red cross (`XCircle`, `text-danger`),
  and it has no **Pay**. Owed money keeps the amber ring (Q4).
- **Placement** (Q4, Q5): a stopped cost stays in the list, in its place, while
  its stop month is the current month or while it owes. After that it leaves
  the list for **Stopped · N · Show** at the foot, one line, which shows the
  old Stopped table when tapped.
- **A cost's months**: a part month with a settlement reads *· closing* (the
  stop month) or *· first month* (the start month) and offers **Change**, which
  asks *{Month} comes to (₹)*, empty, and settles the month at it. A whole
  month keeps *· settled* and **Undo**. *N of M days* goes.
- **Tiles**: *This month* and *Left to pay* add the agreed figures. *Per day*
  is unchanged (D6).

## D6. Pro-rata P&L (Q1, Q2)

Unchanged code. `readProRata` already spreads each month's cost over the days it
runs: from the start day, to the stop day. With the figure agreed, that is
exactly the owner's answer: the dates decide **when** the figure is charged,
never **how much**. A stopped month is charged in full by its last day (Q2 A); a
mid-month start builds up from its first day (Q2 A). Pro-rata still builds up
day by day through the month (Q1). `dailySpreadPaise` likewise.

## Money

All in integer paise; the rupee fields accept whole rupees only and convert with
`rupeesToPaise`. `already` and `closing` are sums and differences of paise, no
division. The SQL and TypeScript copies of `already` are held together by cases
in `src/domain/fixed-costs.test.ts` and `supabase/tests/` (the same figures).

## RLS and authority

No policy changes. The three functions are `security invoker`, call
`fixed_costs_assert_outlet` first, and insert through the tables' own policies
(owner, or the outlet's manager), like every #79 write. `record_fixed_cost_payment`
is called as the same caller. Granted to `authenticated`, revoked from `public`
and `anon`.

## Offline

None. The Fixed page is online-only and never queued (#79).

## Version skew

- **New objects only**: `create_fixed_cost_v2`, `update_fixed_cost_v2`,
  `stop_fixed_cost_v2`. Every #79 function, table, trigger and policy is
  untouched, so every published build keeps calling what it calls.
- **What the new path saves** is a settlement, a stop date and a payment (an
  expense with its link) — rows every published build already reads. A build
  from before this change shows a closed month at its agreed figure with
  *settled* and **Undo**, and the final payment as a payment.
- **Turning the gate off** returns the screens to today's: the Stopped section,
  day counts on unsettled months, the old Stop sheet. Months closed while it was
  on keep their agreed figures. Nothing is queued, so nothing is stranded:
  `roundTrip: 'none: …'`.

## Rejected

- **Folding into #79.** #79 is live with `pro-rata-pnl` on and waits only for
  its archive. This reverses a decision on a page already live, so it needs its
  own switch and its own release, and folding it in would hold #79's archive
  hostage to this change's pull.
- **Spreading every cost over the whole calendar month in Pro-rata P&L**, so no
  date affects it. Charges a salary before somebody joined, and keeps charging a
  closed month after they left (owner chose Q2 A).
- **Hiding stopped costs entirely after their month** (Q5 B). Leaves no way to
  open a stopped cost's page to correct a payment.
