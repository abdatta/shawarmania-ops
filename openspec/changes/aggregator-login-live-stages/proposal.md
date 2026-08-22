# Proposal: Aggregator Login Live Stages

> **Model**: Ox Alpha · **Wave**: D · **Depends on**: #44 · **Gate**: when the
> owner taps Reconnect and the full-login rung fires, the screen shows where the
> sign-in actually is — starting, opening the partner portal, signing in as you,
> waiting for your code (with the input field appearing at that stage), checking
> your code, bringing Hyperpure along, done — each stage arriving within seconds
> of the runner reaching it, without a refresh; the code column of any auth
> request never reaches a client; and the four-role demo walkthrough still walks.

## Why

Tonight's first live full-login rehearsal (2026-08-22) showed the gap in one
sentence: after tapping Reconnect, the screen went silent for four minutes
while a robot in a datacenter signed in on the owner's behalf. The one moment
that needed a human — a code — arrived with no countdown, no explanation, and
three prior attempts expired unclaimed while the screen said nothing. The biller
shift handshake already solved this exact shape: state lives in Supabase and
both sides follow it live. This change gives the aggregator login the same
nervous system.

**The insight is that almost all of the machinery already exists.** A login
under way is already a database row (`aggregator_auth_requests` — one open row
per channel, created by the runner at precisely the right moment by #44's lazy
mailbox). The runner already talks to Supabase through an authenticated door.
The UI already holds an authenticated Realtime-capable client. What is missing
is only vocabulary: the row does not say WHERE the sign-in is.

## Scope

**Two columns, not a new table.** `aggregator_auth_requests` gains `stage` and
`stage_at`. The table already carries "a login under way" semantics, its RLS,
its isolation tests and its lifecycle sweep; extending it inherits all of that.

**One new runner-authenticated action.** `aggregator-reader` gains
`report_stage`: validates `stage` against a fixed vocabulary, stamps the open
request for the channel. No free text crosses the boundary.

**The runner narrates milestones it already passes through** (`auth.mjs`, via
the shared sync-repo helper): browser up → portal reached → identifier entered
→ code screen rendered → code accepted → signing in → Hyperpure captured. Five
extra lines of reporting around existing steps.

**A plain-language stepper on the surface.** While a dispatched reconnect has
an open request, the Hyperpure line expands into the stage list — each stage in
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
stages arrive within seconds without polling. Realtime honors RLS, and the
row's policy is owner-only with the `code` column unreadable to every client —
verified property: no session material or code can reach a browser through this
path. A dropped realtime socket degrades to today's behavior (the health poll
still closes the loop), never to a lie.

## Non-goals

- **No streaming for the capture-only rung in v1.** It writes no mailbox row,
  and its five minutes are already covered by the Repairing note. Follow-up if
  wanted.
- **No new infrastructure** — no new table, no new credentials, no broadcast
  channels, no custom websocket layer.
- **No technical vocabulary.** No "browser context", "storageState", "CI". The
  words above are the contract.
- No change to the ladder itself, the probe, or anything #44 settled.

## Design questions to settle during `/opsx:propose`

- Whether stage updates should also mark `updated_at` for staleness detection
  (a runner dying mid-stage leaves a stage frozen forever — what should the UI
  show after ten silent minutes?).
- Whether the stepper lives inline on the Hyperpure line or as a card between
  the health lines.
- How demo mode fakes the stage sequence (it should walk all seven against
  mocks, like every other state this surface shows).

## Docs to update before archiving

`docs/SCREENS.md` (the stepper), `docs/OPERATIONS.md` (what the owner sees
during a sign-in).
