# Expense Payment Method Inherits The Bill Enum

**Type**: Design gap · **Status**: Open · **Area**: Expenses

## The expectation

Recording what an expense was paid with should offer only ways a business
actually pays for something.

## The observed behaviour

The expense record reuses the payment method list built for **bills**, which
describes how a *customer* paid. So recording an expense offers, among its
choices, the two food-delivery aggregators. An expense "paid by Swiggy" is not a
thing that can happen: those are revenue channels, not sources of money leaving
the business.

Of the remaining choices, only one distinction changes any figure the app
computes. Money either leaves the drawer, in which case the day's cash position
moves, or it leaves a bank account, in which case it does not. Card versus a bank
transfer changes nothing anywhere, and no surface groups by it or reconciles
against it.

## Why this is not trivial

The list is a shared database type. Narrowing it means deciding what happens to
the values being dropped, and the same type is also correct where it is used for
bills, so it cannot simply be replaced.

The manual ledger deliberately did not inherit it, storing instead the one
distinction its arithmetic asks about. #38 extends that to three states by adding
one for an expense not yet paid, which the bill list has no way to express at
all. So by the time this is picked up there will be two live models of the same
idea, and the smaller one will have been in daily use for months. **Read what the
ledger settled before designing this**; the useful question is probably whether
the expense record adopts the ledger's model rather than whether the bill list
can be trimmed.

## Trigger to promote

`expenses-and-inventory-live` (#11), which is the change that makes this list
reachable by a real user for the first time. Handling it there costs one
migration on an empty table; handling it afterwards costs a data migration.
