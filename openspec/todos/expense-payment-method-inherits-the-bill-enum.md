# Expense Payment Method Inherits The Bill Enum

**Type**: Design gap · **Status**: Open, narrowed · **Area**: Expenses

## The expectation

Recording what an expense was paid with should offer only ways a business
actually pays for something — and the *database* should be what refuses the rest,
not the form.

## What #31 already settled

`ui-billing-lifecycle` narrowed the shared `payment_method` enum to
`cash | upi | swiggy | zomato`, after a read-only production audit found no Card or
Other rows in either bills or expenses. So two of this note's original complaints
are gone: Card no longer exists anywhere, and the expense form offers Cash and UPI
only — it never listed the aggregators to begin with after that change.

## What #10 then settled

`billing-live` withdrew Swiggy and Zomato as tender methods and narrowed the
shared enum to `cash | upi`. The complaint this note opened with is therefore
gone entirely: an expense "paid by Swiggy" is now impossible at the type level and
not merely absent from the form, and a hand-crafted insert is refused by the
database rather than accepted. Every value the type still holds is a way a
business actually pays for something.

## What is still true

**The expense row still carries the bill enum**, and that is now the whole of the
note. The type is correct for both tables today by coincidence of both being
two-valued, which is exactly the condition under which a shared type drifts
silently later: the first value either table needs that the other must refuse will
be added without anyone noticing the other inherited it.

Of the values that do belong, only one distinction changes any figure the app
computes: money either leaves the drawer, moving the day's cash position, or it
does not.

## Why this is not trivial

It is a shared database type, and it is *correct* for bills. Splitting it means
either a separate type or a check constraint, and either way a decision about what
the column means. #38 is the concrete pressure: an expense not yet paid is a state
the bill enum cannot express at all, and adding it to a shared type would put a
meaningless value on every bill.

The manual ledger deliberately did not inherit it, storing instead the one
distinction its arithmetic asks about. #38 extends that to three states by adding
one for an expense not yet paid, which the bill enum cannot express at all. So by
the time this is picked up there will be two live models of the same idea, and the
smaller one will have been in daily use for months. **Read what the ledger settled
before designing this**; the useful question is whether the expense record adopts
the ledger's model, not whether the bill enum can be trimmed further.

## Trigger to promote

**Re-pointed on 26 Aug 2026**, because the change this named no longer exists and
its premise no longer holds. The column is already reachable by real users: the
notebook's expense table has been the live one since #36, and `expenses` was
never filled. So the cheap window this note assumed has already closed, and a fix
is a data migration whenever it happens.

The natural home is now `retire-the-manual-ledger` (#12), which renames the real
expense table and is already touching its schema and its generated types. Doing
it there costs one more statement in a migration that is running anyway. Doing it
later means a migration of its own against live rows.
