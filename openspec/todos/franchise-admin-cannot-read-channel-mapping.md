# A Franchise Admin Cannot Read The Channel Mapping

**Type**: Defect with a stated workaround · **Status**: Open · **Area**: Aggregator sync

## What is wrong

`public.outlet_channel_restaurants` carries exactly one SELECT policy —
`outlet_channel_restaurants_owner_reads`, which is
`app_is_owner() AND app_account_active()`. A Franchise Admin has no policy branch,
so the table reads as **nought rows with no error**: RLS filters rows, it does not
refuse the request.

Every other outlet-scoped table in this repo lets a Franchise Admin read the rows
their live assignment names. This one does not, and until #52 nothing in the app
noticed, because only Edge Functions read it and they hold the service role.

## Why it matters now

`#52 restore-the-month-pnl` made the Ledger's month depend on it. The month shows
a section per delivery channel *that outlet* trades on, so a channel whose sync
has died is named rather than silently absent — and which channels an outlet
trades on is exactly what this table says.

With the mapping unreadable, a manager's month cannot tell "trades on nothing"
from "cannot see". #52 therefore falls back to every known channel when the
mapping comes back empty, which errs toward saying too much: it may show a
*recorded nothing* line for a channel the outlet does not use.

**The cost being carried:** the owner sees Kanchrapara's month with no Swiggy
section, and a manager sees the same month with a Swiggy *recorded nothing* line.
Neither hides money, and both are honest about what that reader can see — but two
people looking at one month disagree about whether a sales channel is missing.

## The fix

One policy, mirroring how the rest of the estate scopes a Franchise Admin: read
the mapping for the outlets their live assignment names. It needs its own
`test:rls` coverage, because a silently over-permissive policy passes every
functional test in this repo — which is why it is a migration and a change of its
own rather than a line added to #52.

Worth checking in the same pass whether anything else the Ledger or the Delivery
surface reads has the same owner-only shape.

## Trigger

A manager asks why their month names a channel the outlet does not sell on, or
the next change touching aggregator policies opens the file anyway.
