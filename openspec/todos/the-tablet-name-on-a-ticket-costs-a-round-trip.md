# The Tablet Name On A Ticket Costs A Round Trip

**Type**: Scaling risk · **Status**: Open, sized and deliberately deferred 2026-09-21 · **Area**: Billing

## Expectation

Reading a page of tickets or bills costs one request. The name of the till that
took each one is part of that page, not a second question asked about it.

## Current behaviour

Every read of orders or bills is followed by a second call that trades the ids
it just fetched for their historical till names. One batched call per page, not
one per ticket — but still a round trip whose response grows with the page.

## Why it is that way, and why that reasoning still holds

The name is not stored on the ticket. It is an effective-dated fact: renaming or
transferring a till must not rename last month's bills, so the label is resolved
as of the instant the ticket was taken. That history table is deliberately
ungranted to the app — its outlet column would otherwise be a cross-outlet
discovery path — so the read goes through a `security definer` function that
re-derives the same authority the ticket itself carries.

So this is not an accidental N+1. Embedding is not available precisely because
the boundary is doing its job.

## Why it is deferred

It was measured while attributing an egress spike on 2026-09-21, when it was the
second-largest consumer at roughly 1.36 million rows a day. Almost all of that
was borrowed trouble: it was being handed every order the outlet had ever sold,
because the pipeline read was over-fetching. Once
`the-pipeline-asks-only-for-the-pipeline` narrowed that, the same call carries a
handful of ids.

Sized after the fix: a few thousand rows a day, each a uuid and a short string —
on the order of 0.3 MB a day against a 5 GB monthly allowance. The redesign that
removes it is a schema change plus a backfill of every existing order and bill,
which is a migration, a review and the full database gates. Not worth it yet,
and recorded so that it reads as a decision rather than an oversight.

## The shape the fix would take

Snapshot the label onto the ticket at write time, the way line items already
snapshot item name and unit price. A frozen column cannot be rewritten by a
later rename, which is the property the history table was built to guarantee, so
the guarantee survives while the round trip does not. The history table would
still be the authority for corrections and for anything asked retrospectively.

## Trigger to promote

The label call reappears as a visible share of egress after the pipeline fix has
been in production for a cycle; or a change is already migrating `orders` and
`bills` and can carry the backfill; or ticket volume grows enough that a second
round trip per page is felt on a slow counter connection.
