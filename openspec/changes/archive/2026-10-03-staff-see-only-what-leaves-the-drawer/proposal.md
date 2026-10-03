# Proposal: staff-see-only-what-leaves-the-drawer

> **Model**: Opus · **Wave**: E · **Depends on**: #38, #12 · **Gate**: a Biller, an Employee and a counter tablet holding a live shift each read their outlet's cash expenses and **no other expense**, proved by a hand-crafted request against a day holding a salary paid by transfer, a Hyperpure order and a cash purchase; each is refused by the database when recording or correcting an expense into anything but cash, with a sentence saying who records the rest; the drawer's expected cash is unchanged by the narrowing; the staff and counter expense forms ask three things and no payment method; the owner's and a manager's form starts with **Paid with** unchosen and will not save until it is chosen, every time; and the four-role demo walkthrough still walks.

## Why

On the first days of a month the owner records the month's fixed costs: salaries,
rent, the vendors billed monthly. Every one of those rows is readable by every
Biller and Employee at the outlet. The staff Expenses screen and the counter
tablet show them for two days. The database lets staff read them on any date,
because no policy on `expenses` carries a date or a method predicate.

Production on 2026-10-01 puts a size on it. Since August, staff could read:

| Recorded by | Rows | Total |
|---|---|---|
| Owner, not cash | 32 | ₹5,00,923, six of them **Salary** (₹86,000) |
| Hyperpure sync, not cash | 58 | ₹2,78,676 |

What one person is paid is exactly the figure the other people at the counter
should not read. The design that opened the record to staff (#38, design D2)
reasoned that *hiding an expense row protects nothing, since it is not a revenue
figure*. Salaries show that reasoning is wrong.

The owner's rule [owner, 2026-10-01]: **staff only need the expenses that came
out of the drawer.** That is the only money a staff member handles. Staff cannot
pay with the business's UPI. When they pay a supplier from their own UPI, the
business pays them back from the drawer, so that is a cash expense recorded at
the moment the cash leaves. Production agrees: staff have recorded 133 expenses
and every one of them is cash.

The same conversation surfaced a second, smaller hazard. **Paid with** defaults to
*Cash, out of the drawer* for everybody. An owner entering a month of salaries who
misses one tap records a salary as drawer cash. The drawer then expects cash that
was never there, and the next count reports a shortfall nobody caused. The owner's
rule: the owner and a manager choose the method themselves, every time, with no
default.

## What changes

- **A Biller or Employee reads only cash expenses** at the outlets they are
  assigned to. So does a counter tablet holding a live shift. A non-cash expense
  is invisible to them, enforced by Row-Level Security rather than by the screen.
- **Staff and the counter record and correct only cash expenses.** The database
  refuses anything else with a sentence: *staff record only what leaves the
  drawer; a manager or the owner records the rest.*
- **The staff and counter expense form loses its payment method field.** It asks
  for a category, an amount and an optional note, and says plainly that the
  expense is cash out of the drawer.
- **The owner's and a manager's form starts with Paid with unchosen.** It shows
  *Choose…* and will not save until a method is picked. Correcting an existing
  expense starts from the method that expense already has, because that choice was
  already made.
- **Staff still see small cash salary advances** paid from the drawer, with their
  notes (owner decision, 2026-10-01; see Non-goals).
- The living spec stops claiming the owner's remote entries are refused as cash.
  Production holds 76 such rows, and the owner records drawer spends remotely by
  design (#38 D9). The spec now says what ships: the owner records either method,
  and a remote cash entry is marked as one.

## Non-goals

- **No hidden categories.** A cash salary advance from the drawer stays visible to
  staff, note and all. Production holds three: ₹2,500 recorded by the owner and two
  of ₹100 recorded by staff themselves. The owner accepted that visibility
  [owner, 2026-10-01] rather than take on a per-category privacy setting that
  someone would forget to set. Revisit only if large advances start leaving the
  drawer.
- **The category suggestion list is unchanged.** Staff still see category *names*
  such as "Salary" or "Rent" while typing, never an amount or a row.
- **No drawer arithmetic changes.** The drawer readers run as `security definer`
  and keep counting every cash expense. Non-cash expenses never reached the drawer.
- **No change to what the owner or a manager reads**, on Expenses, the Drawer or
  the Ledger.
- **No rows are rewritten.** No staff-recorded non-cash row exists to hide from its
  own recorder.
- **No narrower date window.** Today-and-yesterday stays as it is. On its own it
  would not have hidden a salary entered today.

## Docs updated before archive

- `docs/ROLES_AND_PERMISSIONS.md`: the Expenses rows of the capability matrix, and
  the paragraph that says everyone at the outlet reads every expense row.
- `docs/SCREENS.md`: the staff **Expenses** screen (the two-day window paragraph
  claims hiding a row protects nothing), the counter tablet's expense form, and the
  owner and manager form's unchosen method.
- `docs/LIMITATIONS.md`: the "expense record to everyone at the outlet" sentence,
  plus a bound recording that staff see cash salary advances and category names by
  decision.
