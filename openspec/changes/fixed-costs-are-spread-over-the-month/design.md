# Design: Fixed Costs Are Spread Over the Month

## The owners' words, 2026-10-19

> The PNL that we show today forgets that we will have to pay salaries and rent
> and a lot of fixed costs at the end of the month, or it could be during the
> month also. Because of this, the PNL looks artificially inflated.

> A separate page or separate section about the fixed costs that we will have in
> a month, pre-entered and carried over, assuming it is ongoing … these would be
> considered as estimates … we will be spreading this over the month for P&L
> calculation … when the actual payment occurs, the owner can select that fixed
> cost item and record an actual payment.

> The monthly salary of the biller is 10,000, but he asked for two months'
> salary … next month he'll only get 5,000. Spill usually gets resolved in the
> next month, but can also be more than a month.

> The moment we've paid it, that directly goes into the P&L … let's not define
> this accrual P&L and spread P&L for past dates. It's only a current moment
> value … Any past month should entirely rely on the expenses that have been put
> and not promised.

The decisions of that conversation, in the order they were taken. Each is the
owner's unless it says otherwise; this file records them because the
conversation does not survive it.

1. **Who reads it.** The owner and the outlet's manager: the rule non-cash
   expenses already follow.
2. **No link to team accounts.** Not everyone paid has an account, and not
   every account is paid.
3. **Advances that span months, in the first version.**
4. **The drawer.** Salaries are paid by the owner or manager, never from the
   drawer; rent and electricity never; garbage perhaps. Keep the **Paid with**
   choice the owner's expense form has, cash meaning the drawer.
5. **Categories**: Salary, Rent, Utility, Other. A fixed cost is a name, a
   category, a monthly amount, a start date and a note.
6. **A start date, prorated.** Joining on the 20th costs the days from the 20th.
7. **Paying a different amount offers three choices up front**: keep the rest
   pending, drop it just this month, or make the paid amount the new monthly
   amount; and for more than owed, paid ahead, extra just this month, or the new
   monthly amount.
8. **Once paid, only the remaining balance is spread.** A payment enters P&L at
   once.
9. **Pro-rata P&L is a current-moment figure.** Past days and months read P&L
   from recorded expenses alone.
10. **Salaries go out on the 31st or on the 1st or 2nd.** A payment for last
    month counts in last month by default, switchable, and the day it was paid
    is still recorded. A month that ends unpaid raises an alert on Overview.
11. **The names.** *P&L* for the ordinary figure; **Pro-rata P&L** for the new
    one (D8).
12. **The expense row** reads *Nayan (Salary)* with a **Fixed** chip like the
    Cash chip, and the chip cannot be faked by typing.
13. **The demo first.** The owner approves the screens from the demo before
    anything is wired live.

## What was measured before deciding

Production, read-only, 2026-10-19:

- **Kalyani Cafe, 1–18 October**: settled counter bills ₹6,65,911 (1,340 bills);
  delivery ₹278 gross, about −₹438 after commission; recorded expenses
  ₹4,76,105.
- **Fifteen placeholder rows dated 19 October**, recorded 05:21–05:37 IST,
  totalling ₹3,22,700, **all `is_cash = false`**, so the drawer is untouched.
  Eleven carry a person's name as their category (*Nayan Salary*, *Santu
  Salary* …); the others are *Rent*, *Bonus workers*, *Part Time workers* and
  *Garbage*.
- **Earlier months record fixed costs on the day paid**: Kanchrapara's September
  has six *Salary* rows totalling ₹86,000; Kalyani's has *Rent* ₹27,500.
- **One cash salary advance has left the drawer**: Kanchrapara's *Salary
  Advance*, ₹2,500, in August.
- **`expense_guard` makes `business_date` immutable** and refuses a future one,
  while letting an owner or manager insert an earlier one. A payment can count in
  last month; changing the month it counts in later means withdrawing it and
  paying again.

## D1. Salary amounts enter the app; payroll stays out

`staff-as-accounts` (#21) removed `salary_paise` from the roster by the owner's
decision of 2026-07-28, and `docs/PROJECT_OVERVIEW.md` says **no salary is
stored anywhere**. The owners now ask for exactly that, as a cost.

The line is drawn where the earlier decision drew its reason: payroll is scope
creep. This stores **what a person costs a month and what was paid**, and
nothing a payroll needs: no attendance-derived pay, no deductions, no statutory
figures, no payslip. A salary is a fixed cost like rent, of category *Salary*,
with a typed name. It is deliberately not a column on the person's account,
for decision 2 and because that column is the doorway to payroll.

## D2. The model: four tables, nothing scheduled

| Table | One row is | Columns, beyond `id`, `outlet_id`, `created_by`, `created_at` |
|---|---|---|
| `fixed_costs` | a fixed cost | `name`, `category` (`salary` · `rent` · `utility` · `other`), `note`, `starts_on` (date), `stops_on` (date, null while ongoing), `updated_at` |
| `fixed_cost_amounts` | its monthly amount from a month on | `fixed_cost_id`, `from_month` (a 1st), `amount_paise` |
| `fixed_cost_settlements` | one month settled at a figure | `fixed_cost_id`, `month` (a 1st), `amount_paise`, `voided_at`, `voided_by` |
| `fixed_cost_payments` | a payment's link to its expense | `fixed_cost_id`, `expense_id` (unique), `paid_on` (date) |

- **Every child carries `outlet_id`** with a composite foreign key
  `(fixed_cost_id, outlet_id)` to `fixed_costs (id, outlet_id)`, so each policy
  is one membership test on its own row and no child can name another outlet's
  fixed cost. A trigger on `fixed_cost_payments` refuses an expense of another
  outlet.
- **Nothing is deleted.** A fixed cost stops; a settlement is voided, with who
  and when; an amount is superseded by a later row for the same or a later
  month (latest `created_at` wins for one `from_month`); a payment is corrected
  or withdrawn through its expense row, as any expense is.
- **No month is materialised.** A month's cost is derived on read (D3). There is
  no job on the 1st to fail, the rule `counter_shifts.expires_at` follows too.
  *Carried over* means the derivation keeps applying the amount until the fixed
  cost stops.
- **Money is `bigint` paise.** `amount_paise >= 0` on amounts and settlements.

## D3. What a month costs

For a fixed cost and a calendar month M:

1. **Active days**: the dates of M from `starts_on` through `stops_on`,
   inclusive. None, and M costs nothing and is not shown.
2. **Prorated amount**: the monthly amount in effect for M (the latest
   `from_month <= M`) × active days ÷ days in M, rounded down to the paisa. A
   whole month is the amount exactly. Joining on the 20th of a 30-day month is
   11/30.
3. **Cost**: the latest unvoided settlement for M if there is one, otherwise the
   prorated amount.

So **Drop**, **Extra just this month** and a cleared balance on **Stop** are
each a settlement; **New monthly amount** is a settlement for M and an amount
from the next month; **Edit** is an amount from a chosen month.

The derivation is written once in SQL (`fixed_cost_month_cost(id, month)`,
granted to no role) and once in `src/domain/fixed-costs.ts` for the mock adapter
and the pay sheet's preview. A shared case table,
`src/domain/fixed-cost-cases.json`, read by a Vitest suite and a pgTAP file,
holds them to each other, as `lint:totals` holds the bill identity.

## D4. The balance, and which month a payment paid

```
balance(through month N) = Σ cost(M), for every month M from starts_on through N
                         − Σ amount of the fixed cost's effective payments
                             whose expense counts in N or earlier
```

| Reads | When |
|---|---|
| **To pay ₹X** | balance > 0 |
| **All clear** | balance = 0 |
| **Paid ahead ₹X** | balance < 0, shown as its magnitude |

The list and a fixed cost's page show the balance through the **current month in
full**: a month's salary is owed by its end, so on the 18th *To pay* is the month
less what is paid.

A payment counts while its expense is effective: withdrawn on the Expenses page
it leaves the balance; its amount corrected there, the balance follows. There is
no second copy of the amount.

**Coverage** is derived for display, first in first out: effective payments in
order of the date they count in, then `created_at`, fill the oldest month's cost
first, then run into later months. It gives *October paid · November ₹5,000 of
₹10,000 paid*, and *Paid ahead to mid-December* for an advance. **No payment
stores a month.**

**A month is unpaid** once it has ended and coverage leaves part of its cost
uncovered. That is the attention count (D7).

**Rejected: the larger of the monthly amount and what was paid, as a month's
cost.** It reads overtime correctly and reads every advance as a cost: ₹15,000
paid against ₹10,000 would make October cost ₹15,000. The balance keeps what a
month costs apart from what has been paid; the two meet only at the pay sheet's
choice. **Rejected: the payer picks a month.** It makes a three-month advance a
split and every later settlement a reallocation; FIFO gives the same display with
nothing to choose.

## D5. Paying

**Pay** opens a sheet on the fixed cost's page:

- **Amount**, on the on-screen pad (keys marked `data-keypad-key`).
- **Paid on**: today unless changed, never in the future.
- **Counts in**: shown only when an earlier month still has a balance and the
  payment is not cash. It defaults to **the last day of the latest such month**
  ("31 October") and switches to the day paid.
- **Paid with**: starts unchosen and must be chosen, as the owner's expense form
  since #65. **Cash forces Counts in to the day paid**, because the drawer's
  expected cash depends on when money left it.
- **Note**, optional.

**What is owed**, for the sheet, is the balance through the month the payment
counts in. If the amount differs, three choices appear before Save:

| Paid less: the rest | Paid more: the excess |
|---|---|
| **Keep ₹X pending** (default). Nothing more is recorded. | **₹X paid ahead** (default for Salary and Rent). Nothing more is recorded; the balance goes below zero. |
| **Drop ₹X, just this month**: a settlement of that month at what it now has covered. | **₹X extra, just this month** (default for Utility and Other): a settlement of that month at its cost plus the excess. |
| **₹Y is the new monthly amount**: the same settlement, and an amount of ₹Y from the next month. | **₹Y is the new monthly amount**: the same settlement, and an amount of ₹Y from the next month. |

*That month* is the last month the payment touches by coverage. The
new-monthly-amount choice is hidden where that month is prorated. Paying exactly
what is owed asks nothing.

One write, `record_fixed_cost_payment(p_id, p_fixed_cost_id, p_amount_paise,
p_paid_on, p_counts_in, p_is_cash, p_note, p_choice)`:

- **`security invoker`**, so the expense is inserted under the caller's own
  `expenses_insert` policy, `expense_guard` and category capture, exactly as the
  Expenses form inserts one. It first checks that the caller is the owner or the
  fixed cost's outlet's manager, which the expense policy alone would not
  require: a Biller may insert a cash expense.
- Inserts the expense with `id = p_id` (client-generated: a retried tap finds the
  link for `p_id` and returns it unchanged), `business_date = p_counts_in`,
  `category` the category's word (*Salary*, *Rent*, *Utility*, *Other*),
  `description` the fixed cost's name and the note after it, and, for cash,
  `is_cash` and `occurred_at` as the form sets them. Then the link with
  `paid_on`, then whatever the choice records. One transaction.
- `p_choice` is checked against the sheet's arithmetic again in SQL: a
  settlement the server computes differently is refused, not stored.

**Correcting a payment** is done on its expense: amount and note in place, as
today. **Moving the month it counts in** is withdrawing it and paying again,
because `expense_guard` keeps `business_date` immutable.

**Drop** also stands on its own: an unpaid month's row on the fixed cost's page
has **Drop**, a settlement at what the month has covered, for a balance that will
never be paid. **Undo** on a settled month voids the settlement.

**Stop** asks for the last date. If the balance through that month is then below
zero, it offers **Clear ₹X** (a settlement of the last month at its cost plus the
excess) or **Keep it**. P&L is unaffected either way: the advance entered P&L
when it was paid.

## D6. Pro-rata P&L, in integer paise

For the current month C, read at the outlet's business date T:

```
spread(f)  = floor(cost(f, C) × active days of C up to T ÷ active days of C)
covered(f) = what coverage (D4) puts against C: payments counted in C and
             advances counted earlier, never a payment that paid an earlier month
unpaid(f)  = max(0, spread(f) − covered(f))

P&L          = revenue − recorded expenses − commission        (#76, unchanged)
Pro-rata P&L = P&L − Σ unpaid(f)
```

Today counts as a whole day: today's rent is owed today. The floor is per fixed
cost before summing, and spread is cost exactly on the last active day.

- **A payment enters P&L at once** and, by raising `covered`, stops that much
  spreading (decision 8). ₹10,000 paid in full on the 20th charges ₹10,000 from
  that moment, not 20/30 of it.
- **An advance paid last month** lowers this month's `unpaid` and was in last
  month's P&L. Nothing counts twice.
- **A balance owed from an earlier month** is not in Pro-rata P&L. It is that
  month's cost, and the payment that clears it counts in that month by default
  (D5); until then it is under Needs attention (D7). Counting it here as well
  would charge it twice the moment it is paid and back-dated.
- **A past month has no Pro-rata P&L** (decision 9). It reads P&L from recorded
  expenses, which hold every fixed-cost payment on the date it counts in.

Kalyani Cafe's 18 October, had the placeholders been fixed costs instead: P&L
₹1,89,368; unpaid ₹3,22,700 × 18/31 = ₹1,87,374; Pro-rata P&L **₹1,994**. A case
in the shared table.

**Covered** = `max(0, revenue − expenses that are not fixed-cost payments −
commission)` ÷ the month's fixed costs in full, capped at 100%: how much of what
this month will cost in fixed costs its trading has earned so far. **Still to
pay** = Σ max(0, cost(f, C) − covered(f)).

**A month with no active fixed cost** shows P&L alone: no Pro-rata P&L, no
covered bar, no fixed costs group.

## D7. Unpaid months need attention

A new attention source, `fixed-costs-unpaid`, on the Fixed costs navigation
entry: the number of fixed costs with an unpaid month that has ended (D4). It
appears in **Needs attention** on Overview as *Fixed costs: 3 unpaid from
October* (or *from September and October*), and as the entry's badge. It is a
count of things waiting on the reader, which is what `attention-badges` allows a
badge to be. It reads one function, `fixed_costs_unpaid()`, which counts across
the outlets the reader may see, owner and manager only. It refreshes with the
other sources and never on the counter, which holds no such entry.

## D8. The words

| Considered | Verdict |
|---|---|
| *Estimated P&L* | Taken: #76's tile reads *P&L · est.*, the Ledger *Estimated profit*. |
| *Cash P&L* | **Refused by the owner**: *cash* means the drawer on every screen. |
| *Accrual P&L* | Correct, and a word the managers do not use (owner). |
| *Paid P&L* | **Refused by the owner**: a P&L has revenue in it; *paid* describes only half. |
| *P&L after dues* | **Refused by the owner**: reads as all the dues, not the share owed so far. |
| *Amortized*, *Normalized*, *Adjusted* | Wrong meaning, misleading, and vague. |
| *Spread P&L* | The runner-up. |
| **P&L · Pro-rata P&L** | **Chosen.** *Pro-rata* is the word an Indian salary already uses for a part month, and the screen always says how far through the month it is: *Pro-rata P&L · 18 of 31 days*. |

Each figure carries its basis in one short line, as `profit-estimates` requires:
*Costs counted on the date recorded* under P&L, *This month's fixed costs
charged to today* under Pro-rata P&L. Verbs: **Add**, **Pay**, **Edit**,
**Drop**, **Undo**, **Stop**. Balance states: **To pay**, **All clear**,
**Paid ahead**. Categories: **Salary**, **Rent**, **Utility**, **Other**.

## D9. Screens

All four are built in the demo first and approved by the owner before any is
wired live (decision 13). These are the starting shapes, in the owner's
conventions; the demo round decides.

**Fixed costs** (`ledger/fixed-costs`, Finances, between Expenses and the
Ledger), owner and manager, with the outlet picker Expenses has. A list in Team's
shape: name, category, this month's cost, and the balance in a Status column
drawn like Team's (plain words, no dots). A total row: this month's fixed costs
and what is still to pay. **Add** opens the five fields. Stopped fixed costs sit
under a quiet *Stopped* label at the foot.

**A fixed cost's page**: the name heads it. Tiles: *Monthly amount* (with
**Edit**, which asks from which month), *This month*, *Balance*. Then **Months**,
newest first, each with its cost, *prorated* or *settled* where either applies,
and its coverage, with **Drop** or **Undo** inside its tile. Then **Payments**,
newest first: *₹20,000 · paid 2 Nov · counted in October*, each opening its
expense. **Pay** on the right of the Payments label. **Stop** red-outlined and
centred at the foot.

**The pay sheet**: amount pad, Paid on, Counts in (when it applies), Paid with,
note, then the three choices as one group of buttons with the default chosen,
each saying its effect in a few words. The figures under them update as the
amount is typed.

**The Fixed chip**, on the Expenses page (owner and manager) and the Ledger's
month lines: the row reads the fixed cost's own name and category, *Nayan
(Salary)*, or *Rent* where they are one word, from the link, not from the row's
text, with **Fixed** beside it drawn like **Cash**, and *paid 2 Nov* where the
payment counts in another day. The Expenses page reads the links for the day it
shows with one more request, made only for the owner and a manager. The counter
and staff never read links (RLS), and their rows read as today.

**Overview's P&L tile** (with `one-revenue` and this gate on): *{Month}
Pro-rata P&L*, the figure, and *18 of 31 days · P&L ₹1.89L* beneath it in compact
notation; the margin moves to the tooltip. An outlet with no fixed cost this
month keeps #76's tile. The shimmer is reshaped to the new subtext in the same
change.

**The Ledger's current month**: the block in the proposal's sketch, then a
*Fixed costs* group, each fixed cost with its cost this month, what is paid and
what is still owed, linking to its page. The category breakdown keeps every
expense, fixed-cost payments included, so it still adds up to recorded
expenses. **A past month is unchanged**, apart from the Fixed chip on its lines.

## D10. The gate

One gate, `pro-rata-pnl` (*PR*), `dependsOn: ['one-revenue']`, on three toggle
points: Overview's P&L tile, the Ledger's month (its P&L block and Fixed chips),
and the Expenses page's Fixed chip. It counts toward no root-gate limit.
`retireBy` about eight weeks after it is first turned on.

**The Fixed costs page and its attention source are not behind it.** They are a
new surface, held by the surface registry (`hidden` → `demo` → `live`), and they
change no existing figure: a payment is an expense row that every figure already
reads. The owners can set up October's fixed costs and record payments before
turning the gate, and pull it without losing anything.

**Round trip, tested** (`@cg-round-trip:pro-rata-pnl`): with the gate on, add a
fixed cost and pay part of it; turn the gate off; the Ledger's month and Overview
read as before, the payment among recorded expenses with no chip; turn it on; the
chip returns and Pro-rata P&L charges only the unpaid share.

## Version skew

- **The four tables** are new. No published build reads them.
- **`create_fixed_cost`, `record_fixed_cost_payment`, `settle_fixed_cost_month`,
  `fixed_cost_month_cost`, `fixed_costs_month`, `fixed_cost_payment_marks`,
  `fixed_costs_unpaid`** are new.
- **`overview_month_v2`** is new: `overview_month`'s object with a `fixedCosts`
  member added. `overview_month` is untouched, and #76's path and every published
  build keep calling it.
- **`expenses`, `effective_expenses`, their policies and triggers** are
  untouched. A payment is a row the existing policy admits, written as the
  Expenses form writes one, so a build published before this change reads it as
  an ordinary expense; the drawer, the Ledger and Overview count it correctly.
- **The `change_gates` row** is inserted off.
- **Turning the gate off** leaves every fixed cost, amount, settlement and link in
  place and unread by any figure; payments count as P&L counts them. Proved by
  the round-trip test.
- **Reverting the build** leaves the four tables unread and the payments as
  ordinary expenses. The revert is clean in the AGENTS.md sense.

## RLS and authority

Each of the four tables: RLS on; **select, insert, update** for
`app_account_active() and (app_is_owner() or outlet_id in (select
app_outlets_for('franchise_admin')))`; **no delete** policy, and a no-delete
trigger as `expenses` has. No branch for a counter shift, a Biller or an
Employee. Triggers limit updates to `name`, `category`, `note` and `stops_on` on
a fixed cost and to `voided_at` / `voided_by` on a settlement; amounts and links
are insert-only.

`create_fixed_cost` (a fixed cost and its first amount, one transaction) and
`settle_fixed_cost_month` are `security invoker`. `record_fixed_cost_payment` is
`security invoker` with its own authority check (D5). The reads
(`fixed_costs_month`, `fixed_cost_payment_marks`, `overview_month_v2`,
`fixed_costs_unpaid`) are `security definer` with `search_path = ''`, and the
three that take an outlet begin with `overview_assert_outlet`, the check
`overview_month` makes, so they admit exactly its readers. `fixed_costs_unpaid`
filters by the same membership. `fixed_cost_month_cost` is granted to no role.

pgTAP and `test:rls` prove, for every table and every read: another outlet's
Franchise Admin is refused by a crafted request; a Biller, an Employee and a
counter-shift session read nothing and write nothing; anonymous is refused; a
deactivated owner is refused; a link to another outlet's expense is refused; and
a Biller calling the pay function is refused before any expense is written.

**What staff see**: a fixed-cost payment made in cash is a cash expense, so a
Biller and the counter read its row, *Salary · Nayan*, as they read cash advances
today, without the chip. They never read the fixed cost, its amount or its
balance. Salaries are not paid from the drawer (decision 4).

## Offline

None. These are online reads and writes on owner and manager phones. The counter,
its outbox and the kitchen are untouched; a payment is never queued.

## Demo

The demo outlet gains fixed costs that exercise each rule: a shop's rent; three
salaries, one paid half in a mid-month advance, one paid a month ahead, one who
joined on the 20th; electricity settled higher last month; and garbage. Last
month ends with one salary unpaid, so Needs attention shows it, and the Ledger's
current month carries both P&Ls. The demo's trading days are filled out enough
that Pro-rata P&L reads as a shop that trades, which also closes the gap
`openspec/todos/the-demo-month-reads-as-a-loss.md` records for the Ledger's month.

## Release

The fifteen 19 October placeholder rows must not stand beside fixed costs covering
the same month, or October's costs are charged as pro-rata and also kept in P&L
as expenses. At release the owners add the fixed costs (each starting 1 October)
and **withdraw the fifteen rows on the Expenses page**, then record real payments
as they are made. Withdrawing is the owners' act, not a migration's: migrations
change no existing rows (tasks §11).

## Rejected alternatives

- **Daily expense rows written by a job** (₹10,400 a day). Fills the Expenses page
  with rows nobody spent, needs a scheduled writer, and turns a changed amount
  into a rewrite of past rows.
- **Entering the month's fixed costs on the 1st**, as the owners did on the 19th.
  Moves the cliff to the start of the month.
- **Pro-rata P&L kept for past days and months.** The owner chose a
  current-moment figure (decision 9). A history of it would need every past day's
  view of which payments existed then, for a number nobody asked to look back at.
- **Fixed-cost payments outside `expenses`.** A cash payment would be invisible to
  the drawer, and every expense surface would need a second source.
- **A flag column on `expenses` for the chip.** The link already carries it, can
  be written only by the pay function, and leaves the table every build reads
  untouched.
- **Linking salaries to team accounts**: decision 2 and D1.
- **A projected month-end P&L** ("if the month continues like this"). Offered as
  an option; the owners chose the spread, which needs no guess about sales to
  come.
- **The larger of amount and paid, and choosing a month per payment**: D4.
- **Taking next month's amount from this month's payment automatically.** An
  overtime month would become everyone's new salary. The amount changes only by
  Edit or by choosing *new monthly amount*.
