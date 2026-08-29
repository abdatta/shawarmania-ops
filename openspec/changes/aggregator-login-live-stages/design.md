# Design: Aggregator Login Live Stages

## Context

A full-login reconnect dispatches a workflow that drives a real browser through
the Zomato partner portal. It takes about four minutes. The surface currently
learns nothing about it until it ends, except for one moment: a code card that
appears when `aggregator_auth_requests` opens a row.

The 2026-08-22 rehearsal exposed what that costs. Four silent minutes, then a
code arriving with no countdown and no context, after three earlier attempts had
expired unclaimed. The owner cannot tell a working sign-in from a hung one, so
the rational response to silence is to tap Reconnect again — which is the one
action that makes it worse.

The mechanism to fix this already exists in the codebase twice over. The biller
shift handshake keeps its state in Supabase and both sides follow it live. The
auth-request row is already the "a login is under way" record, already
owner-scoped by RLS, already swept on expiry.

## Goals / Non-Goals

**Goals**

- The owner can see where a sign-in is, within seconds, without refreshing.
- The code field appears at the stage it belongs to, not as a card floating
  beside the story.
- A dead runner stops claiming progress.
- Nothing beyond the stage name can reach a browser through this path.

**Non-Goals**

- The capture-only rung. It opens no mailbox row and has nothing to stream.
- Run history, `What changed`, or anything on the figures. #48 and a quickfix.
- Any change to the repair ladder, the probe, or dispatch.

## Decisions

### D1. Two columns on the existing request row

`stage` (constrained vocabulary) and `stage_at` (timestamptz).

*Rejected: a `aggregator_login_stages` event table, one row per transition.* It
would give a replayable trace, which nothing asks for. The stepper renders the
current position and the ticks behind it, both derivable from one word. An event
table adds a policy, an isolation test case and a sweep of its own, to store
history for a row that lives four minutes.

*Rejected: Supabase Broadcast instead of `postgres_changes`.* Broadcast does not
go through RLS. On a row whose neighbouring column is a one-time code, the
transport that enforces the policy is the only defensible one.

### D2. The stage vocabulary is closed and validated server-side

`report_stage` on `aggregator-reader` validates against the fixed list and
stamps the open request for the channel. No free text crosses the boundary,
matching how `outcome` is already handled.

**The security property this change must not weaken:** the request row's policy
is owner-only and its `code` column is unreadable to every client. Realtime
delivers the same columns a select would, so the property holds by construction
— but it holds only as long as nobody widens the policy to make the stepper
easier. A test asserts a subscribed client receives `stage` and never `code`.

### D3. `stage_at` exists for staleness, not for display

The stepper does not show times. `stage_at` answers a different question: is
this stage still true? A runner killed mid-stage leaves its last stage frozen,
and a stepper reading "Signing in as you" ten minutes later is a confident lie.

After a bounded silence the stepper stops claiming the stage and says the
sign-in has gone quiet, offering what the owner can do. The bound is an open
question below; it must be longer than the slowest legitimate stage, and the
slowest legitimate stage is stage four, which waits on a human.

*Rejected: reusing `updated_at` for this.* It moves on any write to the row,
including one that has nothing to do with progress. A stamp that means "we
reached a stage" has to be written only when a stage is reached.

### D4. The code field moves inside the stepper

Today's code card is a separate element that appears when the request opens. It
becomes stage four's own content, so the field is where the story says it should
be. When the request closes the stepper collapses into the existing quiet/ended
line per outcome, which is unchanged.

### D5. A dropped socket degrades to today, never to a lie

If realtime never connects or drops mid-sign-in, the existing five-second health
poll still closes the loop and the surface behaves as it does now. The stepper
shows what it last knew and the staleness rule from D3 covers the rest. No
retry storm, no fabricated progress.

## Risks / Trade-offs

**Realtime is a new dependency for this surface.** Mitigated by D5: it is an
enhancement over a poll that still runs, not a replacement for it.

**The stage vocabulary is a contract with a separate repo.** A runner reporting
a word the function does not know must be rejected loudly rather than stored, or
the stepper silently stops advancing. Validation is server-side for that reason.

**Stages could go backwards.** A retried identifier or a second code could
revisit an earlier stage. Whether the stepper reruns a stage or holds is an open
question; either is acceptable, silently rendering a tick then untick is not.

## Migration Plan

1. Migration adds `stage` and `stage_at` to `aggregator_auth_requests`, both
   nullable, check-constrained vocabulary, column comments. Existing RLS
   unchanged; the isolation test case for the table is re-asserted against the
   new columns rather than a new one added.
2. `aggregator-reader` gains `report_stage`. Deployable before the runner uses
   it and before the UI reads it.
3. Sync repo reports stages. Deployable independently: an unread column breaks
   nothing, and a stage nobody renders is inert.
4. Surface subscribes and renders the stepper; the code card moves inside it.

Nothing is destructive. A request row written before this change carries a null
stage and renders as today's card, which is also what happens if the runner is
older than the UI.

## Rejected alternatives

**Keeping the run history and the freshness stamp in this change.** They were
added to this proposal on 2026-08-23 and split back out on 2026-08-29.

The three shared a screen and a theme and nothing else: different tables
(`aggregator_auth_requests` versus `aggregator_sync_runs` versus
`aggregator_channel_days`), different transports — this proposal's own non-goals
had already ruled out streaming the history — and, for the stamp, a different
feature folder entirely (`src/features/manual-ledger/`).

The decisive argument was risk. This change is additive and reversible and
cannot touch money. The history's summaries require cutting into
`ingest_aggregator_cycle`, a `security definer` function that writes settlement
figures. Verifying both against one gate means a working stepper can carry a
money regression past a checkpoint. The gate was also three "and" clauses
needing three unrelated rehearsals, which is a gate that can half-pass.

Ordering was decided the other way from the risk argument, deliberately: #48
lands first because the owner wants the history sooner, and the two do not
depend on each other. They touch opposite ends of
`aggregator-sync-surface.tsx`; whichever is second rebases.

## Open Questions

- Inline on the Hyperpure line, or a card between the health lines.
- How long silence must last before the stepper stops claiming its stage, and
  the wording when it does. Must exceed the slowest legitimate stage, which is
  the one waiting on a human.
- Whether a stage may go backwards, and whether the stepper reruns or holds.
- Whether the capture-only rung eventually wants the same treatment, once the
  stepper exists and the cost of extending it is known.
