# Proposal: a-read-that-worked-ends-a-lapse

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · corrects the healing rule in `src/data-access/supabase-adapters/aggregator-sync.ts` · **Gate**: none — an owner page away from the counter, it writes nothing, and a revert cleanly undoes it; the new adapter test fails with the fix reverted.

## Why

On 12 November the owner reconnected Zomato from the Delivery page. Both reads after it used the new session and wrote their weeks, and both ended `reconciliation_failed` over one disputed payout week (26 Oct – 1 Nov). The page kept the *Reconnect Zomato* card up anyway: the 11 November `session_lapsed` runs are resolved only by a later run whose outcome is exactly `ok`, so a run that read fine but could not reconcile a week never ended them. The badge already counts by the newest run, so the page and the badge disagreed again, the same split the healing rule was written to close in August.

## What Changes

- A lapse or changed shape is resolved by any later real run that read the portal: outcome `ok` or `reconciliation_failed`, named once as `READING_WORKED` in the adapter. A run that stopped for a code, lapsed or found a changed shape still proves nothing.
- The adapter test's stub answers the recovery query by the query's own outcome filter, the way the database does, so which outcomes heal is decided by the adapter rather than by the stub; two tests pin both sides of the line.

## Change gate

No gate: a read-side change on an owner page away from the counter that a revert cleanly undoes.

## Non-goals

- No spec delta: `aggregator-settlement-sync` already says a matter resolved by a later run leaves *what needs them*; this restores that for the lapse.
- The disputed week keeps asking. It is real work, and its own row and the badge's count are unchanged.
- The channel's health word still reads *Stuck* after a `reconciliation_failed` run; whether a read that worked but did not reconcile should read differently is the owner's call, not this fix.
- The demo seam's mock adapter is untouched.
