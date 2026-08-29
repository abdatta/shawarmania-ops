# Proposal: Aggregator Login Live Stages

> **Model**: Opus · **Wave**: D · **Depends on**: #47 · **Gate**: when the owner
> taps Reconnect and the full-login rung fires, the screen shows where the
> sign-in actually is — starting, opening the partner portal, signing in as you,
> waiting for your code (with the input field appearing at that stage), checking
> your code, bringing Hyperpure along, done — each stage arriving within seconds
> of the runner reaching it and without a refresh; a runner that dies mid-stage
> stops claiming progress rather than freezing on one; no auth-request content
> beyond the stage ever reaches a client; and the four-role demo walkthrough
> still walks.

> **Scope note (2026-08-29).** This change was widened on 2026-08-23 to also
> carry a history of runs and a freshness stamp on measured figures. Both have
> been split back out: the history is `sync-run-history` (#48), and the stamp is
> a quickfix carrying no roadmap row. Reason recorded in `design.md` under
> *Rejected alternatives*, so the split is not silently re-merged later.

## Why

Tonight's first live full-login rehearsal (2026-08-22) showed the gap in one
sentence: after tapping Reconnect, the screen went silent for four minutes while
a robot in a datacenter signed in on the owner's behalf. The one moment that
needed a human — a code — arrived with no countdown, no explanation, and three
prior attempts expired unclaimed while the screen said nothing.

The biller shift handshake already solved this exact shape: state lives in
Supabase and both sides follow it live. This change gives the aggregator login
the same nervous system.

## Scope

**Two columns, not a new table.** `aggregator_auth_requests` gains `stage` and
`stage_at`. The table already carries "a login under way" semantics, its RLS,
its isolation tests and its lifecycle sweep; extending it inherits all of that.

**One new runner-authenticated action.** `aggregator-reader` gains
`report_stage`: validates `stage` against a fixed vocabulary, stamps the open
request for the channel. No free text crosses the boundary.

**The runner narrates milestones it already passes through** (`auth.mjs`, via
the shared sync-repo helper): browser up → portal reached → identifier entered →
code screen rendered → code accepted → signing in → Hyperpure captured. Five
extra lines of reporting around existing steps.

**A plain-language stepper on the surface.** While a dispatched reconnect has an
open request, the Hyperpure line expands into the stage list — each stage in
owner words, past stages ticked, current one live:

| Stage | Shown as |
|---|---|
| 1 | Starting the sign-in |
| 2 | Opening the Zomato partner portal |
| 3 | Signing in as you |
| 4 | Waiting for your code ← the input field renders here, with its countdown |
| 5 | Checking your code |
| 6 | Bringing Hyperpure along |
| 7 | Done |

Stage four replaces today's disconnected code card: the input field appears
inside the stepper at the stage it belongs to. When the request closes, the
stepper collapses into the usual quiet/ended line per outcome.

**Transport is Supabase Realtime `postgres_changes` on the request row**, so
stages arrive within seconds without polling. Realtime honors RLS, and the row's
policy is owner-only with the `code` column unreadable to every client —
verified property: no session material or code can reach a browser through this
path. A dropped realtime socket degrades to today's behavior (the health poll
still closes the loop), never to a lie.

**A stalled runner says stalled, not stuck at stage three.** `stage_at` is the
staleness signal: a runner killed mid-stage leaves its last stage frozen, and a
stepper that keeps showing "Signing in as you" ten minutes later is lying with a
straight face. After a bounded silence the stepper says so and offers what the
owner can actually do. The bound and the wording are settled during propose.

## Non-goals

- **No streaming for the capture-only rung in v1.** It writes no mailbox row,
  and its five minutes are already covered by the Repairing note. Follow-up if
  wanted.
- **No new infrastructure** — no new table, no new credentials, no broadcast
  channels, no custom websocket layer.
- **No technical vocabulary.** No "browser context", "storageState", "CI". The
  stage words above are the contract.
- **No run history and no changes to What changed.** That is #48, and it lands
  first.
- **No freshness stamp on measured figures.** Split out as a quickfix.
- No change to the ladder itself, the probe, or anything #44 and #47 settled.

## Design questions to settle during `/opsx:propose`

- Whether the stepper lives inline on the Hyperpure line or as a card between
  the health lines.
- How long silence must last before the stepper stops claiming a stage, and what
  it says then.
- How demo mode fakes the stage sequence (it should walk all seven against
  mocks, like every other state this surface shows), including the stall.
- Whether a stage may ever go backwards — a retried identifier, a second code —
  and if so whether the stepper reruns a stage or holds.

## Docs to update before archiving

`docs/SCREENS.md` (the stepper, replacing the disconnected code card) and
`docs/OPERATIONS.md` (what the owner sees during a sign-in, and what a stalled
sign-in looks like).
