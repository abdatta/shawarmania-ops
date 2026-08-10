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

## What is still true

**The expense row still carries the bill enum**, so the *type* continues to permit
`swiggy` and `zomato` on an expense. An expense "paid by Swiggy" is not a thing
that can happen: those are revenue channels, not sources of money leaving the
business. Nothing but the form stops one being written, and a hand-crafted insert
is not stopped at all — which is the shape of gap this repo treats as real, since
outlet isolation and money rules are database boundaries here rather than UI ones.

Of the values that do belong, only one distinction changes any figure the app
computes: money either leaves the drawer, moving the day's cash position, or it
does not.

## Why this is not trivial

It is a shared database type, and it is *correct* for bills. Narrowing it for
expenses means either a separate type or a check constraint, and either way a
decision about what the column means.

The manual ledger deliberately did not inherit it, storing instead the one
distinction its arithmetic asks about. #38 extends that to three states by adding
one for an expense not yet paid, which the bill enum cannot express at all. So by
the time this is picked up there will be two live models of the same idea, and the
smaller one will have been in daily use for months. **Read what the ledger settled
before designing this**; the useful question is whether the expense record adopts
the ledger's model, not whether the bill enum can be trimmed further.

## Trigger to promote

`expenses-and-inventory-live` (#11), which is the change that makes this column
reachable by a real user for the first time. Handling it there costs one migration
on an empty table; handling it afterwards costs a data migration.
