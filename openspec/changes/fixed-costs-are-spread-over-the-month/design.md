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
9. **P&L (Pro-rata) is a current-moment figure.** Past days and months read P&L
   from recorded expenses alone.
10. **Salaries go out on the 31st or on the 1st or 2nd.** A payment for last
    month counts in last month by default, switchable, and the day it was paid
    is still recorded. A month that ends unpaid raises an alert on Overview.
11. **The names.** *P&L* for the ordinary figure; **P&L (Pro-rata)** for the new
    one, with no day count beside it (D8).
12. **The expense row** reads *Nayan (Salary)* with a **Fixed** chip like the
    Cash chip, and the chip cannot be faked by typing.
13. **The demo first.** The owner approves the screens from the demo before
    anything is wired live.
14. **Both views, P&L (Pro-rata) leading.** Asked why the whole month's fixed
    costs are not taken off from day 1, the owner kept the pro-rata figure as the
    headline and added the full-dues view as a finish line beside Covered: P&L
    (Pro-rata) answers "are we making money at this pace"; *Short of covering
    October* answers "how far are we from covering the month" (forked session,
    2026-10-19, "yes pls pass it on").
15. **One Expenses entry, Daily | Fixed.** Merged rather than a separate Fixed
    costs entry: both tell one money-out story (is rent an expense or a fixed
    cost?), the Finances bar is at five entries
    (`openspec/todos/navigation-outgrows-a-flat-list.md`), and Expenses is thin
    for owners today. Tabs rather than one scroll, because Daily is one day under
    its date stepper and Fixed is the month and what is owed; on one scroll the
    stepper would read as controlling both. After Pay, *Recorded on 31 Oct ·
    View* (forked session, 2026-10-19, "send it").

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

- **Amount**, typed as the Expenses form takes one (mirroring that form, not a new pad).
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

## D6. P&L (Pro-rata), in integer paise

For the current month C, read at the outlet's business date T:

```
spread(f)  = floor(cost(f, C) × active days of C up to T ÷ active days of C)
covered(f) = what coverage (D4) puts against C: payments counted in C and
             advances counted earlier, never a payment that paid an earlier month
unpaid(f)  = max(0, spread(f) − covered(f))

P&L          = revenue − recorded expenses − commission        (#76, unchanged)
P&L (Pro-rata) = P&L − Σ unpaid(f)
```

Today counts as a whole day: today's rent is owed today. The floor is per fixed
cost before summing, and spread is cost exactly on the last active day.

- **A payment enters P&L at once** and, by raising `covered`, stops that much
  spreading (decision 8). ₹10,000 paid in full on the 20th charges ₹10,000 from
  that moment, not 20/30 of it.
- **An advance paid last month** lowers this month's `unpaid` and was in last
  month's P&L. Nothing counts twice.
- **A balance owed from an earlier month** is not in P&L (Pro-rata). It is that
  month's cost, and the payment that clears it counts in that month by default
  (D5); until then it is under Needs attention (D7). Counting it here as well
  would charge it twice the moment it is paid and back-dated.
- **A past month has no P&L (Pro-rata)** (decision 9). It reads P&L from recorded
  expenses, which hold every fixed-cost payment on the date it counts in.

Kalyani Cafe's 18 October, had the placeholders been fixed costs instead: P&L
₹1,89,368; unpaid ₹3,22,700 × 18/31 = ₹1,87,374; P&L (Pro-rata) **₹1,994**. A case
in the shared table.

**Covered** = `max(0, revenue − expenses that are not fixed-cost payments −
commission)` ÷ the month's fixed costs in full, capped at 100%: how much of what
this month will cost in fixed costs its trading has earned so far. **Still to
pay** = Σ max(0, cost(f, C) − covered(f)).

**Short of covering {Month}** = `max(0, the month's fixed costs in full −
max(0, P&L + fixed-cost payments counted this month through today))`: the
uncovered part of the quantity Covered measures, in integer paise
(`shortOfCoveringPaise`). Kalyani Cafe's 18 October: ₹3,22,700 − ₹1,89,368 =
**₹1,33,332**. It disappears once Covered reaches 100%, which the owner's
less-text convention prefers to a line saying *Covered*.

**A month with no active fixed cost** shows P&L alone: no P&L (Pro-rata), no
covered bar, no fixed costs group.

## D7. Unpaid months need attention

A new attention source, `fixed-costs-unpaid`, on the Expenses navigation
entry, opening the Fixed tab: the number of fixed costs with an unpaid month that has ended (D4). It
appears in **Needs attention** on Overview as *Fixed costs: 3 unpaid from
October* (or *from September and October*), and as the entry's badge. It is a
count of things waiting on the reader, which is what `attention-badges` allows a
badge to be. It reads one function, `fixed_costs_unpaid()`, which counts across
the outlets the reader may see, owner and manager only. It refreshes with the
other sources and never on the counter, which holds no such entry. Where the
Fixed tab is not shown (staff, or the live app before the owner approves it) it
asks the server nothing and badges nothing. An attention may now name the path
Needs attention opens (`Attention.path`), so this one lands on the tab rather
than on Daily.

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
| **P&L · P&L (Pro-rata)** | **Chosen.** *Pro-rata* is the word an Indian salary already uses for a part month. The owner first took *Pro-rata P&L* with *18 of 31 days* beside it, then, seeing the demo tile, asked for **October P&L (Pro-rata)** with no day count and the tile's usual Expenses line (2026-10-19). |

Each figure carries its basis in one short line, as `profit-estimates` requires:
*Costs counted on the date recorded* under P&L, *This month's fixed costs
charged to today* under P&L (Pro-rata). Verbs: **Add**, **Pay**, **Edit**,
**Drop**, **Undo**, **Stop**. Balance states: **To pay**, **All clear**,
**Paid ahead**. Categories: **Salary**, **Rent**, **Utility**, **Other**.

## D9. Screens

All four are built in the demo first and approved by the owner before any is
wired live (decision 13). These are the starting shapes, in the owner's
conventions; the demo round decides.

**Expenses, Daily | Fixed** (decision 15). Two addresses under the one Expenses
entry: Daily at `ledger/expenses`, Fixed at `ledger/fixed-costs`, a segmented
control of two links drawn like the Ledger's One day | The month, so Back, a
badge and Needs attention each land on the tab they mean. The tabs show only for
the owner and a manager, and only while the `owner-fixed-costs` /
`admin-fixed-costs` surface is renderable; those entries have no navigation of
their own and are what holds the tab back until approval. Staff and the counter
keep the page byte for byte. Daily accepts `?date=`, for the owner and a
manager, so *Recorded on 31 Oct · View* opens that day.

**Fixed**, owner and manager, with the outlet picker Expenses has. A list in Team's
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

**The pay sheet**: amount, Paid on, Counts in (when it applies), Paid with,
note, then the three choices as one group of buttons with the default chosen,
each saying its effect in a few words. The figures under them update as the
amount is typed.

**The Fixed chip**, on the Expenses page (owner and manager) and the Ledger's
month lines: the row reads the fixed cost's own name and category, *Nayan
(Salary)*, or *Rent* where they are one word, from the link, not from the row's
text, with **Fixed** beside it drawn like **Cash**, and *paid 2 Nov* where the
payment counts in another day. The Expenses page and the Ledger read the
outlet's fixed costs with one more request, made alongside their own and only
for the owner and a manager with the gate on. The counter
and staff never read links (RLS), and their rows read as today.

**Overview's P&L tile** (with `one-revenue` and this gate on): *{Month}
P&L (Pro-rata)*, the figure, and beneath it the tile's own line, *Expenses ₹X ·
margin*, where Expenses includes the unpaid share of fixed costs so that revenue
less expenses is the figure shown (owner, 2026-10-19). An outlet with no fixed cost this
month keeps #76's tile. The tile keeps its shape, so its shimmer is unchanged.

**The Ledger's current month**: the block in the proposal's sketch, with *Short
of covering {Month}* under the Covered bar until trading covers the month (D6),
then a
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
chip returns and P&L (Pro-rata) charges only the unpaid share.

## Version skew

- **The four tables** are new. No published build reads them.
- **`create_fixed_cost`, `record_fixed_cost_payment`, `settle_fixed_cost_month`,
  `fixed_cost_month_cost`, `fixed_costs_list`, `fixed_costs_unpaid`** are new.
- **`overview_month` is untouched**, and every path keeps calling it; with the
  gate on, Overview asks `fixed_costs_list` beside it (*Built live*, below,
  says why there is no `overview_month_v2`).
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
(`fixed_costs_list`, `fixed_costs_unpaid`) are `security
definer` with `search_path = ''`, and the one that takes an outlet begins with `overview_assert_outlet`, the check
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
that P&L (Pro-rata) reads as a shop that trades, which also closes the gap
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
- **P&L (Pro-rata) kept for past days and months.** The owner chose a
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

## The owner's demo round

**2026-10-19, first look (Overview, watched in the browser pane while built).**
The tile read *October Pro-rata P&L · 19 of 31 days · P&L ₹3.8L*. The owner asked
for **"October P&L (Pro-rata)"**, no day count, and the line the tile already
shows, *Expenses ₹X · margin*. Made: the Expenses figure includes the unpaid
share of fixed costs so that revenue less expenses is the headline, and the
margin is the Pro-rata figure's. The Ledger card took the same name and lost its
day count too.

The full round (list, a fixed cost's page, the pay sheet, Needs attention, the
Ledger's months, the Expenses chip) is pending (tasks §6).

**2026-10-19, the Fixed tab and a fixed cost's page.** Asked what *October* and
*To pay ₹49,900* meant, which mixed this month with everything owed, the owner
asked for labels that each say one thing, and for *this month* over the month's
name. Made:

- **Tiles, on the list and on a fixed cost's page: This month · Paid · Left to
  pay**, "this month" said once, in the first (owner: the rest is understood).
  *Paid* is paid **for** this month, an earlier advance included. Money owed from
  months that ended is its own line, **Overdue from September ₹3,300**, never
  folded into Left to pay. Paid ahead is its own tile on the page. The Ledger
  card's *Still to pay* became *Left to pay*, the same figure.
- **Rows**: the column is *This month*; the status says this month (*₹8,000
  left*, *Paid*) with *₹3,300 overdue* or *₹5,000 ahead* beneath it in small
  type (\`thisMonthStatus\`). The words are captions; the figures lead.
- **Pay on every row** (owner: a salary day is ten payments one after another,
  and opening each person is a detour). The sheet opens with what is owed filled
  in, so an exact payment is Pay, Paid with, Save. Paid with still starts
  unchosen, as #65 requires. The row's arrow went, because Pay sits at its end and
  the row still opens the page.
- **Edit in the title row**, a primary button like Add, editing every field:
  name, category, monthly amount (with *This month* or *Next month* when it
  changes), start date and note. A start moved before the first monthly amount
  carries that amount back to it. The migration's guard now lets the start date
  change; the outlet and the author stay fixed.

**2026-10-19, one column.** The owner found *This month* and *Status* two columns
for one question and asked for a single one that says the total, what is paid and
what is overdue. Made: **This month** reads *₹4,000 of ₹12,000 paid* (paid in
bold) over a thin bar, *₹10,000 paid* with a full bar once paid; *+ ₹3,300
overdue from Sept* in amber and *+ ₹5,000 ahead* in grey on their own line
beneath, never inside this month's bar. The table is *Fixed cost | This month |
Pay*.

**2026-10-19, the pay sheet.** The owner found it confusing: choosing *Counts in*
at the bottom changed the choices at the top, nothing said why that mattered,
and *Keep pending* / *Drop* were bookkeeping words. Reworked (supersedes D5's
three choices and its "owed through the month it counts in"):

- **Nothing lower down changes anything above it.** What is owed is reckoned at
  today and stated first, fixed: *Owes ₹12,300 · ₹3,300 from Sept + ₹9,000 for
  Oct* (\`payOwed\`). The amount starts at the usual payment: an overdue month if
  there is one (salaries paid on the 1st or 2nd), else what is left of this month.
- **A different amount asks why** (owner: "paying an amount different from what
  is due should require some kind of a note"), with everyday reasons that are
  the expense's note and decide what it does (\`pay-reasons.ts\`): more than
  everything owed: *Advance*, *Bonus*, *Overtime*, *Raise*, *Other* (rent and
  bills: *Paid ahead*, *Bigger bill*, *New monthly amount*, *Other*); less than an
  ended month owes: *Paying the rest later*, *Days off* (or *Smaller bill*),
  *Other*; part of this month: *Advance on this month's salary* (or *Part
  payment*), *Other*. *Other* must be written. The usual amount asks nothing.
- **Counts in became Shows in**, at the foot, only when an earlier month is owed
  and it is not cash, worded with its reason: *September's figures — late pay for
  September: its P&L carries it* or *October's figures — counted on the day it
  was paid* (\`showsInDefault\`). It changes nothing above it.

**2026-10-19, Exact · Less · More, and "we pay".** Under the amount, a switch of
**Exact · Less · More**, Exact chosen at the start, so paying anything but the
amount due is a visible choice and a slip of the thumb is not a payment (owner).
Typing a different figure moves the switch; Less and More take the reader up to
the amount with it selected, never changing it; Exact puts the due figure back.
It replaces the line that said *₹2,000 more than owed*: the reasons beneath ask
only *Why?*. The owner also asked for *pay* over *cost* in what people read about
salaries and rent: *From November, we pay ₹14,000 a month*, *In November we pay
only for the days from 20 Nov*, *In December we pay ₹12,000, then nothing more*.

**2026-10-19, figures in every reason.** Each reason names its amounts so the
choice can be checked before Save (owner): *Advance: November owes ₹10,000
instead of ₹12,000*; *Bonus / overtime* (one answer, owner: "I don't really care
which one it is"): *₹2,000 extra, one time, just October*; *Raise: From November,
we pay ₹14,000 a month*; *Paying the rest later: ₹1,300 of September still to
pay*; *Days off: September settles at ₹2,000; the other ₹1,300 is not owed*;
*Advance on this month's salary: ₹1,000 now, ₹7,000 later*. And the switch can
no longer claim Less or More for the amount due: leaving the amount unchanged
puts it back on Exact.

**2026-10-19, paying less mirrors paying more.** The owner asked for the "less"
side to parallel the "more" side, with practical examples. Now: *Paying the rest
later* (as an advance is), **Leave / fine** (one time, as Bonus / overtime is: days
off without pay, coming late, breakage, a drawer someone was answerable for),
**Pay cut** (from the next month, as Raise is; rent and bills: *Smaller bill /
discount*, *New monthly amount*), and *Other*. They are offered for this month
too, not only for a month that ended, since any amount but the one due now asks
why; a pay cut is not offered for a prorated month. The domain gained \`cut\`
(settle the month and set the amount from the next). **Other** opens inside its
own card to say what it was, required, and the optional note at the foot goes
while Other is chosen. The row's Pay became a small outlined pill (owner: six
full buttons stacked read as clutter), orange where something is owed, quiet
where the month is paid, with a thumb-sized hit area.

**2026-10-19, drawer cash and collected cash.** The business sometimes pays in
cash that is not the drawer's, from the collected stack. Only drawer cash moves the
drawer's expected cash, as it always has; the words now say so everywhere they
appear, not only on the pay sheet (owner): *Paid with* reads **Drawer cash** or
**UPI / bank or collected cash** on the pay sheet and on the everyday Expenses
form, staff's line reads *Drawer cash*, and a non-drawer row reads **Not from
drawer** on Expenses and the Ledger (it read *Not cash*, which a collected-cash
payment is not). This is copy on live surfaces, the counter's expense list among
them, and changes no behaviour; \`docs/SCREENS.md\` takes the words at §10.

**2026-10-19, a refused Save points at its field.** "Just a message is very
annoying" (owner): a refused Save now outlines the field responsible in the
danger colour, puts its message right under it instead of at the foot of the
sheet, scrolls to it only when it is out of view, focuses it where it takes
input, and shakes it once (a pulse under reduced motion). Changing the field
clears it. It is a design-system piece, \`useFieldAttention\` and
\`<AttentionField>\` in \`src/components/ui/\`: the outline is its own layer a
little outside the field, so nothing moves, and the shake runs through the Web
Animations API so React's class list is left alone. This change uses it in the
pay, add and edit sheets; the rest of the app's forms are live, some on the
counter, and take it in a change of their own.

**2026-10-19, the eight answers.** Settled with the owner, every month by its
name (correct for a month already over, where "this month" is not):

- **Why more?** *Includes advance from November* (November owes ₹10,000 instead of
  ₹12,000) · *Includes one-time bonus* (₹2,000 of it is bonus, just October) ·
  *Permanent pay raise* (From November, we pay ₹14,000 a month) · *Other*.
  "Includes", because only part of the payment is the advance or the bonus.
- **Why less?** *Advance from October* (₹1,800 now, ₹6,200 of October later), or
  *Paying the rest later* when the month is already over (paid late, not early) ·
  *That's all for October* (leave, a fine) · *Permanent pay cut* (From November, we
  pay ₹5,800 a month) · *Other*.

Rent and bills: *Includes one-time extra*, *Permanent new amount*, and *That's
all* hinting a smaller bill or a discount.

**2026-10-19, no bar.** Part payments are occasional, so the row's bar went
(owner): *₹4,000 of ₹12,000 paid* says it. *+ ₹5,000 ahead* reads green, as
*+ ₹3,300 overdue from Sept* reads amber.

**2026-10-19, the row's Pay.** It sat above the phone's bottom bar when a row
scrolled under it, because it carried a z-index of its own; now \`relative\`
with none, above its row's link and under the bar. It keeps its size and round
shape and takes the app's own button fills (owner): primary orange where
something is owed, the secondary fill where the month is paid, plainly a
button for paying ahead.

**2026-10-19, Undo a payment.** Asked how a payment recorded wrong is put
right (owner). Each payment on a fixed cost's page has its own **Undo**, which
withdraws the expense *and* takes back what its answer recorded: the month it
settled reopens, and a new monthly amount it set is voided, so the amount
before it is back. The settlement and the amount carry the payment's id
(`fixed_cost_payment_id`), and an amount row is voidable like a settlement;
nothing is deleted. The confirmation names each effect: *This withdraws the
₹12,000 paid 2 Oct, reopens September and puts November back to ₹12,000 a
month. The expense stays on its day, struck through. Then pay again with the
right answer.* Then pay again; there is no editing a payment in place, so its
answer can never disagree with its amount.

On the Expenses page a fixed-cost payment offers only **Edit note** and
**Change on {name}'s page**, never Withdraw: withdrawing it there would leave
its settlement and its new amount behind. The note form says the amount, the
day and how it was paid change by undoing it there, and keeps the fixed cost's
name in front of the note.

**2026-10-19, approved.** The owner approved the demo's UI as it stands, with
Undo, and asked for the full build to follow (§7 on).

**2026-10-20, money owed is louder than work waiting.** The owner's worry: a
salary unpaid read exactly like *5 attendance approvals*, so a manager who has
learned to scroll past one scrolls past the other. Splitting the line by category
alone would have left it looking the same, so the row changed how it looks, not
only what it says:

- **First in Needs attention**, whatever the navigation's order.
- **The money leads**: *₹27,300 overdue · 3 salaries, 1 rent · from September*,
  each category with its count.
- **Tinted by how late it is**: amber from the 1st to the 5th, the days last
  month's salaries are normally paid in, so payday does not cry wolf; red from
  the 6th, or as soon as a month older than the last is owed. Every other row
  stays plain, which is what makes this one stand out.

No separate Dues card: one more block on a full phone screen, doing what a
pinned, tinted row does. `fixed_costs_unpaid` gains `paise`, `categories` and
`today` in a second migration declaring the same gate, its first two keys kept.

**2026-10-20, the alert leads somewhere.** The owner, tapping the Expenses badge:
it opened Daily with nothing pointing at Fixed, and on Fixed nothing said which
of the orange Pay buttons the alert was about. So:

- **The Fixed tab carries the badge**, the same count as Expenses.
- **On Fixed, overdue rows come first.**
- **The overdue line names who**: *Overdue from September · Priyanka*.

The Overview line drops paise, as everything on Overview does; the Fixed tab
keeps them.

**The same day, the tones stay on Overview.** The first build carried the amber
and red down into the page: a red badge on the Fixed tab, a tinted row and a red
**Pay**. The owner refused it as out of the app's patterns. The tone exists to set
money owed apart from the approvals beside it on Overview; once on a page, it is
an alert like any other. So the Fixed tab carries the app's own badge, drawn as
Delivery's channel switch draws it, and the overdue row is first and named in the
usual amber. The row itself keeps a highlight, in the app's own orange tint
(`bg-primary/10`), and **Pay is filled only where a month is overdue**; every
other row's Pay is the outlined one (owner, the same day), so a filled Pay means
"this one is late".

**The same day, no red at all.** Late money on Overview turned from red to the
app's own orange: red read as out of the theme even there (owner). Amber for the
first five days, orange from the 6th: both warm, and still the loudest row. The
tones are named `due` and `late`, not for a colour.

**The same day, no overdue line above the list.** With the overdue row first,
highlighted and holding the only filled **Pay**, the *Overdue from September ·
Priyanka* line said it twice, so it went (owner). The list's tiles are This
month · Paid · Left to pay; money owed from a month that ended is said on its
own row, *+ ₹3,300 overdue from Sept*, as it always was.

The demo's dates move with today, so the tests read its months and Priyanka's
prorated amount from the demo's own facts rather than as "September" and
₹3,300, and the chip test asserts on the two rows it makes rather than a count
a demo payment can join near a month's turn. Checked with the clock moved to
31 Oct, 2 Nov, 15 Dec, 1 Jan and 1 Mar.

## Built live (§7–§10), 2026-10-20

What the live build decided where the design above left room, or differs from it:

- **The screens fold, the server lists.** `fixed_costs_list` returns the raw
  facts, and every figure is folded by `src/domain/fixed-costs.ts`, as in the
  demo. Overview folds the same list with `readProRata`, so its figure is the
  Ledger's by construction.
- **No `overview_month_v2`.** The first build replaced `overview_month` with a v2
  carrying the list, one request per card. Staging's first run refused it: with
  every gate on, One Revenue's own browser tests wait for, delay and answer
  `overview_month` itself, and a test may only be tagged out by a later gate,
  never rewritten, so those tests would have stopped running anywhere. Overview
  now asks `overview_month` exactly as #76 does and `fixed_costs_list` beside it,
  at the same time: one more request per card while the gate is on, on owner and
  manager phones only. An unread list leaves #76's tile, which is true without it.
- **The SQL copy is what the pay function needs**, no more:
  `fixed_cost_month_cost`, the months with their running total, what was paid by
  a day, and whether a month is prorated. They are `security invoker` and
  granted to `authenticated` rather than to no role (D3, *RLS and authority*):
  the invoker pay function must call them as the caller, and they read under the
  tables' policies, so they show nothing a select would not.
- **Each write is a function** taking the outlet from the fixed cost:
  `create_fixed_cost`, `update_fixed_cost`, `change_fixed_cost_amount`,
  `stop_fixed_cost`, `settle_fixed_cost_month`, `record_fixed_cost_payment`,
  `undo_fixed_cost_payment`. Undo of a settlement is the one direct update; its
  guard stamps who voided it.
- **The pay function mirrors `payPrompt` and `payEffect`** at the outlet's
  business date: more than owed needs an answer, and *That's all* or a cut there
  is refused; less than owed settles the first month the payment leaves short,
  and only if it reached it; *ahead*, or no answer where none is needed, records
  nothing beside the payment.
- **The Fixed tab is live** for the owner and the managers (registry `live`). It
  changes no existing figure, so it is not behind `pro-rata-pnl`.
