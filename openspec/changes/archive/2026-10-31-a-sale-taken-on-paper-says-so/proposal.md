# Proposal: A Sale Taken on Paper Says So

> **Model**: Opus · **Wave**: F · **Roadmap**: #77 (owner request, 2026-10-15;
> every question answered by the owner the same day) · **Depends on**: #10 (live
> billing), #71 (Analytics) · **Related**: #76 `revenue-reads-the-same-everywhere`
> (every screen sums the same settled bills, so a paper bill must be one of them)
> · **Gate**: the owner runs the paper-sales script against a file of written
> orders for an outlet already marked closed, sees the day's totals by tender
> before anything is written, then writes one bill per order; each bill reads
> *from paper* in Billing history, naming who entered it and when, and names no
> tablet, shift or biller; the bills count in Overview, the Ledger, Analytics and
> the drawer exactly as counter bills do, proved by reading each against the
> file's totals; running the same file again creates nothing; the script's undo
> cancels the file's bills; a paper bill carrying a phone earns points and sends
> no SMS; a manager's crafted request for an outlet they do not manage and a
> counter tablet's request are both refused; every revenue read a published
> build calls counts paper bills; and the four-role demo walkthrough still walks.

## Why

**Some trading happens on paper.** Durga Puja 2026 is the first case: a pop-up
stall for the five days of the Puja, selling chicken shawarma and nothing else,
run with as few staff as possible through a rush nobody can bill through an app.
Orders are written on a sheet and entered afterwards, by the owner or by an
agent working from photographs of the sheets. The owner expects to do the same
for fests, events and other one-off occasions. A counter that loses its tablet
for a day is the same problem: Kalyani Cafe's opening day, 1 October 2026, was
traded on paper and entered on 2 October.

**Today a sale can exist only as a bill rung on a registered tablet, during a
shift, by a named biller.** So entering paper means inventing all three. The
1 October backfill did exactly that: 75 bills credited to one biller, on the
Cafe's test tablet, inside a shift nobody opened, with the outlet's bills then
renumbered so the paper day came first. Every figure was right. Every
attribution was made up. The owner's words: *"we'd be just lying too much, which
is so unnecessary."*

**Typing a day's total instead is not available, and would not be wanted.** The
manual ledger that accepted typed Cash and UPI totals was retired by #12: there
is one record of a trading day, and it is bills. On 1 October the owner also
chose one bill per payment over one large bill, so that average order value and
dish counts stayed honest.

The app already has this shape in one place. A **manual** attendance entry is
recorded by an admin on someone's behalf, says who entered it, carries no
coordinates, and is never judged against the fence. A paper sale is the same
idea for billing.

## What changes

- **The database accepts a bill nobody rang.** A paper bill is an ordinary
  settled bill — line items snapshotted, totals validated, numbered in the
  outlet's sequence, cancellable — that names no tablet, no shift and no
  biller, and records who entered it and when.
- **Entry is by command, never on a screen** [owner]. Paper days run to hundreds
  of orders and nobody types them by hand. A script reads a file of written
  orders, one row per order, and shows the day's totals by tender — orders,
  items, cash, UPI, discounts — before anything is written. It writes only when
  told to, signed in as the person entering, so the record of who entered it is
  true by construction. Running the same file again creates nothing. The same
  script **undoes** a file: it cancels that file's bills, with a reason.
- **Paper bills count everywhere a bill counts**: revenue on Overview, the
  Ledger and Analytics, dish figures, and, for cash, the outlet's drawer. A day
  already counted in the drawer shows the late bills as an exception beside its
  count, as a late counter bill does today.
- **The one piece of UI is the mark.** In Billing history a paper bill reads
  *from paper* where a counter bill says *by* its biller and *on* its till, and its detail says
  who entered it and when.
- **It works on a closed outlet**, for any business day up to the outlet's
  today. A five-day stall is closed by the time its last sheet is entered.

## Owner decisions, 2026-10-15

Each question was put to the owner with a recommendation. Their answers:

| # | Question | Decision |
|---|---|---|
| 1 | Who may enter paper sales? | **The owner for any outlet, and a manager for the outlets they manage.** Every bill names who entered it. |
| 2 | What time does a paper bill carry? | **Always a time.** The person entering gives one, a best guess where the sheet has none; UPI orders take the time the UPI app shows. Paper bills appear in the by-hour charts at that time. |
| 3 | Bill numbers? | **The outlet's ordinary sequence.** Paper entered afterwards takes the next numbers; at an outlet that also has a counter they are out of time order, and the mark explains why. No renumbering. |
| 4 | How detailed? | **One bill per written order.** No day-summary bills. |
| 5 | Where is it entered? | **By command only — an agent or the owner running the script. No entry screen, now or as a follow-up.** *"Usually these will be large in number, nobody will manually enter these."* |
| 6 | Which business days? | **Any day up to and including the outlet's today**, no limit backwards. |
| 7 | Discounts and free food? | **As at the counter**: a percentage or flat discount with its reason; food given free is a 100% discount. *As built (2026-10-16): the counter's discounts have no reason column, so a paper bill's has none either; a percentage is entered as the rupee amount it came to; an order given away entirely cannot come to nothing, because every bill, at the counter too, comes to at least ₹1. **Owner, 2026-10-16: a free dish is billed at ₹1, as the counter already does**, so the script's ` free` prices a dish at ₹1 and a wholly free order is a bill of ₹1 a dish.* |
| 8 | Customers? | **An optional phone (and name) where the sheet has one.** It links the bill to the customer and earns points at that outlet as a counter bill would. **No receipt SMS is sent.** Paper bills never spend points. |
| 9 | A change gate? | **None** [owner asked whether one is needed; agreed it is not]. See below. |
| 10 | The word on the bill | **Paper.** *Changed 2026-10-16 after the owner saw staging: the row reads **from paper**, because every counter row reads *by* its biller and a bare *Paper* beside them was confusing.* |
| 11 | The 1 October bills | **Left as they are.** Cancelling and re-entering them would add 75 cancelled bills to that day and nothing true. |
| 12 | A new check on `bills` | **Agreed**: the database itself refuses a paper bill without an enterer and a counter bill without a tablet. Recorded as the owner's agreement for the release-lint exception in `design.md`. |

## Change gate

**No gate:** the change adds an entry path that no build calls — it runs only
when the owner deliberately runs the script — and a mark that renders only on
bills that path wrote, so until the first paper bill exists every screen is
exactly today's. The schema loosening ships with its migration whatever a gate
says, and a gate could not take back a paper bill already written, because it
is money that changed hands. The way out is the script's undo, which cancels a
file's bills. The owner asked whether a gate was needed and agreed it is not
(2026-10-15).

## Non-goals

- **An entry screen** [owner]. Not now and not as a follow-up.
- **Billing live on a personal phone.** `openspec/todos/emergency-billing-continuity.md`
  stays deferred. Nothing here opens a sale while it happens; it records,
  afterwards, a sale that already happened.
- **Reading photographs inside the app.** An agent may read the sheets; the
  database takes the orders it is given.
- **Day-total or summary bills** [owner, Q4].
- **Changing any existing bill.** Bills stay append-only. The 1 October bills
  stay as they are [owner, Q11].
- **Receipt SMS, spending points, and GST** on paper bills.
- **Expenses, drawer counts and attendance at a pop-up.** Each can already be
  recorded from away by an admin, and none changes here.
- **A new kind of outlet.** A pop-up is an ordinary outlet, created on Outlets
  and marked closed when the event ends.

## Docs this change updates before it can archive

- `docs/DATA_MODEL.md` — bills: how a bill was entered, who entered it, the
  columns that are empty on a paper bill, and the check that pairs them.
- `docs/SCREENS.md` — *from paper* in Billing history.
- `docs/OPERATIONS.md` — a runbook, *a day traded on paper*: the file format,
  the dry run, the write, the undo, staging first, for a pop-up outlet and for a
  counter-down day. It is the entry path, so it is complete enough for an agent
  to follow from the runbook alone.
- `docs/ROLES_AND_PERMISSIONS.md` — who may enter paper sales.
- `docs/GLOSSARY.md` — *paper sale*.
- `docs/LIMITATIONS.md` — a paper bill's time is what the person entering
  said; the by-hour charts cannot tell a guessed time from a rung one except by
  the mark.
- `docs/BUSINESS_CONTEXT.md` — pop-up stalls at events, traded on paper.
