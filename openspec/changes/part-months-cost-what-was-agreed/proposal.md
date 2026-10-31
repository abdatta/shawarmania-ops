# Proposal: part-months-cost-what-was-agreed

> **Model**: Opus · **Kind**: a follow-up to #79 (`fixed-costs-are-spread-over-the-month`), not a roadmap change · touches Expenses → Fixed, a fixed cost's page, and its Stop, Add and Edit sheets · **Gate**: `agreed-part-months` (*AM*), off

## Why

A fixed cost that starts or stops part-way through a month is charged a share by days today: Jayanta Da (cleaner), ₹6,000 a month, stopped on 28 October, reads *Salary · 28 days* and *₹2,000 of ₹5,419.35 paid* (6,000 × 28 / 31). The owner says this is wrong (2026-10-31). In practice the two sides agree on a whole-rupee figure when somebody leaves or joins, the dates are entered late and loosely, and nobody pays 35 paise. Jayanta Da was paid ₹2,000 on 21 October and another ₹2,000 at closing, so October came to ₹4,000, a figure no day count produces.

The owner also wants a stopped cost kept where it was in the list for the month it stopped, marked as done, instead of dropping to a *Stopped* section at the foot where nobody sees it; and gone from the list after that, so stopped costs do not pile up month after month.

## What Changes

- **Stopping asks for the final payment.** The Stop sheet asks for the **final payment**, in whole rupees, *on top of* what has already been paid that month, starting empty. **Nothing more** fills 0 with one tap. Beneath it the sheet says what the month comes to (*October comes to ₹4,000*) as the amount is typed. **Paid now** records that amount as a payment on the last day (asking *Paid with*), the same as Pay would; **Paying later** leaves it owed, and the row reads *₹2,000 of ₹4,000 paid* until somebody pays it. The month then costs exactly paid + final. The old *₹X paid ahead: Clear or Keep* choice goes: a final payment cannot be below zero.
- **A stopped cost whose last month has no agreed figure** (one stopped before this change) offers **Close {Month}** on its page, the same sheet with its last day already set.
- **Starting mid-month asks what that month comes to.** When Add's (or Edit's) start date is not the 1st, one more field, **{Month} comes to (₹)**, empty and required. The line *we pay only for the days from 20 Oct* goes.
- **No day count on screen.** *Salary · 28 days* on the list and *28 of 31 days* on a cost's months go. A part month's line reads **closing** or **first month**, and its figure offers **Change** instead of **Undo**, because undoing it would bring the day share back.
- **A stopped cost stays in its place for the month it stopped in.** Its row says *Stopped 28 Oct* beneath the name. While money is owed it keeps the amber ring and *₹2,000 of ₹4,000 paid*; once it is all paid the row is greyed and the ring becomes a **red cross** (where a paid running cost shows the green tick), and its **Pay** goes.
- **From the next month it leaves the list**, unless it still owes. One quiet line at the foot, **Stopped · 3 · Show**, opens the stopped costs, so the line never grows however many pile up.
- **Pro-rata P&L is unchanged in shape**: it still charges a month day by day. A part month's agreed figure is charged from its start day or by its stop day, so a stopped month is charged in full by its last day. The dates decide when the figure is charged, never how much.

## Change gate

- **Key**: `agreed-part-months` · **Code**: `AM` · depends on nothing.
- **On**: A fixed cost that starts or stops part-way through a month costs the figure agreed for that month, stopping asks for the final payment, and a stopped cost stays in its place, marked done, for the month it stopped in.
- **Off**: A part month costs its share by days, and stopped fixed costs sit under Stopped at the foot of the list.

Off is today. What the on path saves is a settlement (the month's agreed figure), a stop date and an ordinary fixed-cost payment, all of which the off path and every published build already read: with the gate off, a month closed while it was on keeps its agreed figure and the payment stays a payment. Nothing is queued; the Fixed page is owner- and manager-only and never on the counter.

## Non-goals

- **No change to how a whole month costs**, to the monthly amount, to payments, coverage or the pay sheet's choices.
- **No change to Pro-rata P&L's day-by-day building up** within the month (owner, 2026-10-31: confirmed).
- **No day count removed from the database's fallback.** A part month with no agreed figure is still worked out by days by `fixed_cost_month_cost`, so every published build keeps agreeing with the server; with the gate on the app never creates one, and Close fixes the ones that exist.
- **No data repair.** Garbage already closes at ₹2,400, its month in full. Jayanta Da is closed by the owner or a manager, either with Pay on today's build (₹2,000, paid 28 Oct, *That's all for October*) or with **Close October** once this is on.
- **No refund flow**: a closing figure below what was paid cannot be typed.

## Docs to update before archive

- `docs/SCREENS.md`: the Daily | Fixed paragraph (Stop, Add, closing and first month, stopped rows).
- `docs/DATA_MODEL.md`: Fixed costs, the three new functions.
- `docs/TESTING.md`: the fixed-cost cases line, for the closing figure.
