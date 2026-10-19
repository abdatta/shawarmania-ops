# Proposal: Fixed Costs Are Spread Over the Month

> **Model**: Opus · **Wave**: F · **Roadmap**: #79 (owners' request, 2026-10-19) ·
> **Depends on**: #76 (one definition of revenue, expenses and profit), #52 (the
> Ledger's month P&L) · **Gate**: the owner approved the Fixed costs page, the
> pay sheet, Overview's P&L tile and the Ledger's month from the demo before any
> of it was wired live; an outlet's fixed costs are set up once and carry over
> every month, prorated from a start date and to a stop date; paying one records
> an ordinary expense marked **Fixed** by something no typed expense can carry,
> asks what to do with any difference, and keeps when it was paid apart from the
> month it counts in; a month that ends with a fixed cost unpaid is named under
> Needs attention until it is paid or dropped; Overview and the Ledger's current
> month show **Pro-rata P&L**, which charges the unpaid share of this month's
> fixed costs up to today, beside **P&L**; every past month reads P&L from
> recorded expenses alone; only the owner and the outlet's manager read any of
> it; and with the gate off every figure reads exactly as it does today.

## Why

The P&L subtracts a cost on the day it is paid. Rent and salaries are paid at
the end of the month, or partly in the middle, so for most of a month the P&L
counts the food bought and none of the people or the shop, and then drops in a
day.

The owners noticed on 2026-10-19. Kalyani Cafe's October, read from production
(read-only) that morning:

| 1–18 October | |
|---|---|
| Counter sales | ₹6,65,911 |
| Expenses recorded | ₹4,76,105 |
| **What Overview called profit** | **about ₹1,89,000** |

To correct the picture, one owner entered the month's fixed costs as expenses
dated 19 October, before any of them were paid: rent ₹1,00,000, eleven salaries
totalling ₹1,69,500, a ₹35,000 bonus, part-time wages ₹15,800 and garbage
₹2,400, which is **₹3,22,700**. Read the day after, the month swings from about
+₹1.9 lakh to about −₹1.3 lakh. Neither number is the shop's month.

Spread across October's 31 days those costs are about **₹10,400 a day**.
Charged for 18 days, 1–18 October comes out at about **₹2,000**: roughly break
even. That is the figure the owners were trying to see, and the app has nowhere
to keep the costs that would produce it.

The same entries show the second need. People are paid advances in the middle
of a month and the rest later, sometimes a month or two ahead ("he asked for two
months' salary"), and salaries go out on the 31st or on the 1st or 2nd of the
next month. Today none of that is tracked anywhere but in someone's head.

## What changes

### A Fixed costs page

Under **Finances**, beside Expenses and the Ledger, for the owner and the
outlet's manager. A list in the same shape as Team, one row per fixed cost, each
opening its own page.

- **Adding one** asks for a **name** (*Nayan*, *Kalyani shop*), a **category**
  (**Salary**, **Rent**, **Utility** or **Other**), the **monthly amount**, a
  **start date** (the 1st of this month unless changed) and an optional
  **note**. A salary is a typed name, **not** linked to a team account: not
  everyone paid has one, and not every account is paid.
- **It carries over.** Every month from its start, it costs its monthly amount
  without anyone entering anything.
- **A part month is prorated by calendar days.** Someone starting on the 20th
  of a 30-day month costs 11/30 of the amount that month (the 20th to the 30th),
  and the whole amount from the next month.
- **Stop** ends it from a date, for someone who leaves or a cost that ends. The
  last month is prorated to that date, and nothing carries over after it.
  Nothing is ever deleted.
- **Edit** changes the monthly amount from a chosen month on. Earlier months
  keep theirs.

### Paying

**Pay** on a fixed cost asks for the amount, **Paid on** (today unless changed),
**Paid with**, and a note. If the amount differs from what is owed, the same
sheet shows three choices before it saves:

| Paid ₹8,000 of ₹10,000 | Paid ₹12,000 of ₹10,000 |
|---|---|
| **Keep ₹2,000 pending** (preselected) | **₹2,000 paid ahead** (preselected for Salary and Rent) |
| **Drop ₹2,000, just this month** | **₹2,000 extra, just this month** (preselected for Utility and Other) |
| **₹8,000 is the new monthly amount** | **₹12,000 is the new monthly amount** |

- *Keep pending* leaves it owed, shown on the row and, once the month is over,
  under Needs attention.
- *Drop* settles the month at what was paid. *Extra* settles it at what was
  paid. Either way the next month is back to the monthly amount.
- *Paid ahead* means the next month owes less. An advance can cover any number of
  months: ₹30,000 paid against ₹10,000 a month clears three.
- *New monthly amount* settles this month at what was paid and changes the
  amount from next month on. It is not offered in a prorated month, where the
  amount paid is not anyone's monthly figure.

Paying exactly what is owed asks nothing.

**A payment pays off the oldest month still owed.** Nobody picks a month. The
fixed cost's page says *October paid · November ₹5,000 of ₹10,000 paid*.

### A payment is an expense, marked Fixed

The payment is an ordinary expense row, through the same fields the owner's
Expenses form has. **Paid with** cash takes it from the drawer's expected cash,
as every cash expense does; any other method leaves the drawer alone. On the
Expenses page and in the Ledger it reads **Nayan (Salary)** with a **Fixed**
chip beside it, drawn like the Cash chip: **Rent** alone where the name and
category are the same word. The chip comes from the payment's link to its fixed
cost, which only Pay creates. Typing *[fixed]* into an ordinary expense produces
those words and no chip. Correcting or withdrawing the expense on the Expenses
page corrects the fixed cost's balance.

### A month it counts in, and the day it was paid

Salaries go out on the 31st or on the 1st or 2nd of the next month. A payment
that pays off an earlier month's balance **counts in that month**: paid on 2
November for October, it lands on **31 October** by default, with a switch to
count it on the day paid instead. The record keeps both, and the entry time is
kept as for every expense: the expense row on 31 October reads *Nayan (Salary)
· Fixed · paid 2 Nov*, and the fixed cost's page *₹20,000 · paid 2 Nov ·
counted in October*.

A payment from the drawer always counts on the day paid, because the drawer's
expected cash depends on when money left it. An advance counts on the day paid,
in the month it was paid.

### Unpaid fixed costs need attention

Once a month is over, every fixed cost with a balance still owed for it is named
under **Needs attention** on Overview, and the Fixed costs entry carries a badge
with the count: *Fixed costs: 3 unpaid from October*. It opens the list, where
each one is a tap from Pay. It clears when the balance is paid, or dropped.

### Pro-rata P&L, for now only

- **P&L** stays what it is today: revenue less every expense recorded, fixed-cost
  payments included, on the date each counts in. **Every past month reads P&L
  only**, from what was paid and nothing promised.
- **Pro-rata P&L** is the current month's P&L **as of now**, less the part of
  this month's fixed costs that is owed so far and not yet paid. For each fixed
  cost, the share owed so far is this month's cost × days so far ÷ days in the
  month; once paid, the payment is in P&L and stops being spread. It always
  shows how far through the month it is: *Pro-rata P&L · 18 of 31 days*.
- A balance owed from an earlier month is not in it. It belongs to that month,
  and lands there when paid; until then it is under Needs attention.
- When every fixed cost of the month is paid, the two figures are equal.

**The Ledger's current month** reads:

```
Revenue                                ₹6,65,500
Expenses                              −₹4,76,100
P&L                                    ₹1,89,400

Fixed costs owed so far, unpaid       −₹1,87,400
Pro-rata P&L · 18 of 31 days             ₹2,000

Fixed costs this month   ₹3,22,700
Covered                  59%     ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░
Still to pay             ₹3,22,700
```

followed by each fixed cost with its month's cost, what is paid and what is
owed, linking to its page. A past month reads P&L only, as today.

**Overview's P&L tile** leads with Pro-rata P&L and shows P&L on a smaller line
beneath it. An outlet with no fixed cost this month shows P&L alone, as today.

## Change gate

- **`pro-rata-pnl`** (*PR*), depends on **`one-revenue`**
  - **On:** Overview and the Ledger's current month show Pro-rata P&L, which
    charges the unpaid share of this month's fixed costs up to today, beside P&L.
  - **Off:** Overview and the Ledger show one P&L that counts every cost on the
    date it was recorded.

**It depends on `one-revenue`** because it is built on that change's revenue,
expenses and month to date, and means nothing on the older ones. A dependent
gate counts toward no root-gate limit.

**Off is today, and what On saved outlives it.** The Fixed costs page and its
Needs attention line are a new surface, held back by the surface registry rather
than this gate, so fixed costs can be set up and paid before the gate is turned.
Its payments are ordinary expense rows that the off path already reads, on the
dates they count in. Its fixed costs, month changes and links are new tables no
off-path code reads. A browser test proves the round trip (design D10).

## Non-goals

- **Payroll.** No payslips, no salary from attendance, no deductions for absence,
  no PF, ESI or TDS. A salary here is a monthly cost and what was paid against
  it. The 2026-07-28 decision to keep payroll out stands; this reverses only the
  part of it that kept salary amounts out (design D1).
- **Linking a salary to a team account.** Refused by the owner, 2026-10-19.
- **Pro-rata P&L for any past day or month.** It is a figure for now. A past
  month is P&L from recorded expenses (owner, 2026-10-19).
- **Splitting one payment across several fixed costs**, or **recording money
  given back**. A returned advance is a negative drawer movement if it was cash,
  as today.
- **Loans repaid on a schedule.** An advance is paid ahead and worked off by the
  months that follow.
- **Fixed costs on the counter, the kitchen or a staff screen.** A payment made
  in cash from the drawer is seen by staff as any cash expense is seen today
  (owner, 2026-10-01); nothing else is.
- **A daily sales target** ("you need ₹X a day"). For the owner to ask for after
  using the covered bar.
- **Pro-rata P&L on Analytics** or on the Ledger's day view.
- **Rewriting the placeholder expenses** entered on 19 October. They are real
  rows; the owners withdraw them on the Expenses page when the fixed costs
  replace them (tasks §11).
- **The consumption basis.** Still withdrawn, for the reason `profit-estimates`
  records.

## Capabilities

### New

- `fixed-costs`: an outlet's fixed costs, carried over and prorated; paying one,
  the three choices, and the month a payment counts in; the unpaid-month
  attention; who reads and writes them.

### Modified

- `profit-estimates`: the current month offers Pro-rata P&L beside P&L, named
  wherever it appears; past months offer P&L alone.
- `ledger-statement`: the current month reads both, the covered bar and the
  month's fixed costs; a fixed-cost payment carries its chip and paid-on date.
- `outlets-overview`: the P&L tile leads with Pro-rata P&L where the month has a
  fixed cost.
- `outlet-expenses`: a fixed-cost payment reads as its name and category with a
  Fixed chip that no typed expense can carry.

## Impact

- **Database**: four new outlet-scoped tables (fixed costs, monthly amounts,
  month changes, payment links), each with its policy and isolation test; three
  new write functions (add, pay, change a month) and two reads (an outlet's
  fixed costs for a month, and `overview_month_v2`); the gate's `change_gates`
  row, off. No existing table, view, policy or function changes.
- **Overview**: the same reads per outlet, the month read becoming its v2; one
  attention read for owners and managers.
- **Ledger and Expenses**: one more read alongside the existing one, so a month
  still settles in two round trips.
- **Counter and kitchen**: none. The request budget does not move.

## Docs To Update Before Archive

- [`docs/PROJECT_OVERVIEW.md`](../../../docs/PROJECT_OVERVIEW.md): *It does not do
  payroll* stays, and stops saying no salary is stored anywhere.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): *Payroll is out of
  scope* rewritten to match; one payment pays one fixed cost; no money given
  back; Pro-rata P&L is a figure for now.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the four tables, the
  balance, the month a payment counts in, and the read functions.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): Fixed costs, a fixed cost's
  page and the pay sheet; Overview's P&L tile and Needs attention; the Ledger's
  current month; the Fixed chip on Expenses.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md):
  fixed costs in the capability matrix.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md): salary
  amounts, who reads them, and the one route by which staff see a payment.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): **Fixed cost**, **Paid
  ahead**, **Counts in**, **Pro-rata P&L**.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md): the demo outlet's fixed
  costs.
