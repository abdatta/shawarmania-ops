# A change gate per outlet

**Trigger:** two or more outlets trading at once, and the owner wanting a change
on at one before the others — or a Franchise Admin asking to turn a change at
their own outlet.

## The expectation

A change gate can be on at one outlet and off at another, so a change is tried
at one shop's counters while the rest run as before.

## Why it waits

Designed first and dropped on 2026-10-12 ("making it per outlet is not
necessary, we can enable for entire app at once"). It makes gate state
outlet-scoped data, with its own policy and isolation tests, a second form of
every read and a switch per outlet on the gate's page — and with one outlet
trading for the coming months it would turn nothing one business-wide answer
does not.

## The shape agreed

Additive: a table of per-outlet answers with its policy and isolation test, read
as an override of the business answer by a new reader, and a row per outlet on
the gate's page. Nothing existing changes, so it obeys the same rule as every
other migration.
