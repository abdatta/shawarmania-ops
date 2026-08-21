# Design: Aggregator Reconnect And Hyperpure Automation

## Context

#43 froze the ledger and moved both channels to measured figures, but shipped
with three deliberate deferrals: the Hyperpure session cannot be minted
headlessly (so its figures still depend on the owner uploading statements by
hand), the Hyperpure Reconnect button was hidden rather than shown lying, and a
reconnect asks for a one-time code on every attempt whether or not the login
requested one.

Since the seed was written, the core unknown has been **closed by experiment**
(2026-08-22, on the owner's machine, using their own Edge cookies transplanted
into a fresh browser — see the proposal's "Verified locally" section):

- A bare `hyperpure.com` visit does **not** SSO, even with a live Zomato
  partner session in the context. This is precisely why the current
  `captureHyperpure` finds no token.
- The working route is the partner portal's outlet picker:
  navigate `zomato.com/partners/onlineordering/hyperPure/`, click the outlet
  card, press its `Start buying` button — the Hyperpure `token` cookie lands
  on `.hyperpure.com` within seconds. Two clicks and waits.
- The Hyperpure JWT carries **no `bExp` claim**; its lifespan is unmeasured.
- A session captured this way read a live statement through the existing
  reader, so capture → read is proven end to end.

The production state at the time of writing: the Zomato session stored in the
ops database is alive and renewed by every twice-daily sync; no Hyperpure
session exists, so the scheduled `hyperpure` workflow fails (by design — it
throws rather than write zeroes) roughly twice a day.

The reconnect machinery spans two repositories. The ops repo owns the surface
(`zomato-sync-surface.tsx`), the dispatch (`request-aggregator-sync`), the
credential store and the mailbox (`aggregator-reader`, `aggregator_auth_requests`).
The sync repo (`abdatta/shawarmania-sync`) owns the browser work (`auth.mjs`,
`login.yml`) and the readers.

## Goals / Non-Goals

**Goals:**

- `captureHyperpure` mints a live Hyperpure session headlessly by driving the
  verified outlet-picker hop, in the same headed-under-xvfb runner the Zomato
  login already uses.
- A reconnect becomes a **repair ladder** — probe, capture-only, "still signed
  in", full login last — instead of a synonym for redoing the whole login
  (owner decision, 2026-08-22; see the proposal's ladder section).
- A one-time code prompt appears **only when the login actually requested a
  code**; a reconnect on a still-alive session completes without one.
- The Hyperpure health line carries a working Reconnect again, and a reconnect
  in which Zomato succeeds but Hyperpure does not follow is **named on the
  spot** (owner decision, 2026-08-22).
- Hyperpure's daily figures arrive on the schedule without a manual upload;
  the manual upload remains as the proven fallback (non-goal to remove it).

**Non-Goals:**

- No removal of the OTP entirely. The login is OAuth2 + PKCE with
  `scope=offline`, so a refresh token could remove the one-off code someday;
  that is separate future work. This change only fixes *when* the code is asked
  for.
- No Swiggy.
- No change to how figures are stored, reconciled or frozen. The ledger shape,
  append-only guards, commission-as-reduction and the restatement are #43's
  and are untouched.
- No schema migration of any kind. The database already knows the `hyperpure`
  channel (credentials, run records, the health RPC and its isolation tests
  landed with #43). This change teaches the *dispatch* and the *surface* what
  the database already accepts.

## Decisions

### D1 — Capture drives the outlet-picker hop, in the login runner's own escalation ladder

`captureHyperpure` is rewritten to: with the Zomato partner session already
live in the browser context, navigate to
`/partners/onlineordering/hyperPure/`, click the outlet card for the configured
delivery outlet, press `Start buying`, then wait (bounded) for the `token`
cookie on `.hyperpure.com` and save the storageState exactly as today.

*Why here and not a direct SSO replay:* the experiment showed the bare visit
does not SSO and there is no evidence of a token endpoint that can be replayed
from the Zomato session without the portal hop. The hop is two deterministic
clicks — cheaper to drive than to reverse-engineer, and what works in a real
browser is by construction what the portal supports.

*Why the same launch ladder:* `auth.mjs` already escalates bundled-chromium →
headed-under-xvfb → real chrome because Akamai drops headless browsers at the
protocol level on runner IPs. The capture runs inside `login()`'s context
today; it keeps that context, so it inherits the ladder for free.

*Rejected:* capturing in `sync.yml`. That job is deliberately browser-free and
cheap (~1 minute, 62 runs a month); giving it Chromium plus xvfb to serve a
repair that is needed rarely inverts the cost.

### D2 — Capture-only becomes its own dispatchable workflow

New `capture-hyperpure.yml` in the sync repo: load the **stored** Zomato
session from the ops database, rebuild a browser context from it, drive the
picker hop, save the Hyperpure session. No sign-in step, no mailbox, no code.

*Why a separate file rather than a flag on `login.yml`:* #43 already paid for
this lesson once — reconnect was dispatched to the wrong workflow and silently
ran the reader, so `dispatchTarget` chooses a workflow **by mode**. A mode
flag on the login workflow is the same trap one level down: the login's
contract is "full sign-in", and a capture-only dispatch is not that.
Separate file, separate contract, one more entry in the dispatch table.

*Why the runner opens no mailbox:* the capture-only path never reaches a
credential challenge, so there is nothing to wait for. If the stored Zomato
session turns out to be dead mid-run, the run fails with `sessionLapsed` and
the surface's ladder moves to the full-login rung — it does not improvise a
prompt.

### D3 — The reconnect ladder is decided by a server-side probe, before any dispatch

`aggregator-reader` gains a `probe` action: load the stored session for a
channel and make one cheap authenticated call (Zomato: the finance endpoint
the sync already uses; Hyperpure: the accounts endpoint the reader already
uses). It returns alive / lapsed without booting a runner. The edge function
then chooses the rung:

1. Probe both channels.
2. Zomato warm, Hyperpure cold → dispatch `capture-hyperpure.yml`. No auth
   request is opened.
3. Both warm → answer `still_signed_in`. Nothing is dispatched.
4. Zomato cold → open the mailbox and dispatch `login.yml` (the only rung
   that can ever cost a code).

*Why probe in the edge function and not in a workflow:* a probe costs one
HTTPS call; a workflow costs a runner boot (~90 s) before it could say the
same thing. The owner's tap should get its verdict in the first second.

*Why not trust stored expiry claims:* Zomato's `bExp` slides and is usually
truthful, but Hyperpure's token carries **no** expiry claim at all (verified
2026-08-22), so "has_session" alone cannot distinguish alive from dead. One
real call is the only honest probe.

*RLS note:* no new table, no new policy. The probe reuses the service-role
credential read that `load_session` already performs inside
`aggregator-reader`, whose authority contract is unchanged.

### D4 — The mailbox opens when the login asks for a code, not when the owner taps

Today `request-aggregator-sync` inserts the `aggregator_auth_requests` row
*eagerly*, before dispatch — which is exactly why the owner was shown a code
box for a code that never came. The insert moves into the runner:
`aggregator-reader` gains an `open_code_request` action, and `auth.mjs` calls
it at the moment the OTP screen is actually reached (after the identifier is
accepted and the code screen renders), then polls as it does today.

The surface keeps following `awaitingOneTimePassword` from the health read, so
the card appears when — and only when — a code genuinely exists to type.
Sweeping of expired requests and the one-open-per-channel index keep their
current roles; the eager-open path and its orphan-cleanup branch in
`request-aggregator-sync` are removed with the behaviour they served.

*Rejected:* keeping the eager open and merely probing harder. Probing decides
*whether to dispatch*; it cannot know that the login will demand a code this
time (Zomato chooses per attempt). Only the login flow itself knows, so only
the login flow may open the mailbox.

### D5 — The Hyperpure health line gets its Reconnect back, wired to the same dispatch

`HyperpureHealthLine` regains a Reconnect button dispatching
`requestReconnect(outletId, 'hyperpure')` — the edge function stops refusing
`channel: 'hyperpure'` for reconnects (the database has accepted the channel
since #43). The line states the three states in the surface's existing
vocabulary: alive ("All quiet"), lapsed ("Session ended" + Reconnect), awaiting
code (the shared code card), and shape-changed ("Stuck" — a maintainer's).

When a reconnect ends with Zomato signed in but Hyperpure not captured, the
Hyperpure line says so **at that moment** ("signed into Zomato, but Hyperpure
didn't follow — try again") rather than leaving the manual upload as the only
signal (owner decision, 2026-08-22). The run outcome that carries this is
already distinct: the login reports `signed_in` for Zomato and a separate
capture outcome for Hyperpure.

*Mock/adapter note:* the mock adapter grows the same states so the demo
walkthrough exercises the surface without touching Supabase — the seam holds.

### D6 — Cleanups ride along, scoped exactly as the seed lists them

Delete the dead `api.orders` path in the Zomato source (superseded by
`deliveredOrders`/`statementBytes`); give the Hyperpure API client the same
transient-failure retry `ops.mjs` got (408/429/5xx with backoff — the
`aggregator-reader` 503 fix, applied where #43 noted it was missing). The
optional month-view "not counted" note ships only if it stays small; it is the
first thing to drop if the change grows.

## Risks / Trade-offs

- **Akamai may treat the stored session's stale bot-cookies differently in the
  CI runner** than a fresh login's → the capture run keeps full artifacts on
  failure (screenshots, field dumps) exactly as `login.yml` does, and the
  launch ladder gives it the same escalations. A stored-session capture that
  cannot pass is visible in one dispatch, not discovered in production.
- **The Hyperpure token's lifespan is unmeasured** (no expiry claim) → the
  day-floor expiry fallback stays; the scheduled job goes red on a lapsed
  session rather than writing zeroes; the ladder re-mints from the Zomato
  parent without the owner seeing a code. Worst case the owner uploads a
  statement exactly as they do today.
- **Two runners racing one session** → the existing cooldown and
  one-open-per-channel guards are unchanged and now also cover the
  capture-only workflow (same dispatch door, same rate limit — D4's contract
  keeps one place where the limit lives).
- **A capture that renews the Zomato token without saving it** → the capture
  run saves the Zomato storageState back when the portal hands it a renewed
  token, matching `sync.mjs`'s rule that saving the renewal is the mechanism,
  not an optimisation.
- **Lazy mailbox leaves a reconnect with no visible feedback while the runner
  boots** → the surface already follows the run (`running` state), not the
  request; the button's in-progress state covers the gap, and a code card
  appearing late is now *information* rather than a lie.
- **Money arithmetic, offline semantics, tenancy** → untouched by design: no
  schema change, no policy change, no counter-path change. The demo seam is
  preserved by giving the mock adapter the new states rather than reaching for
  the Supabase client.

## Migration Plan

1. Sync repo: land capture rewrite + `capture-hyperpure.yml` + lazy mailbox on
   a **branch**; dispatch capture-only against the branch ref and watch it
   mint a live Hyperpure session in CI. No production surface changes yet;
   scheduled runs on `main` are untouched.
2. Ops repo: land the probe action, the ladder in `request-aggregator-sync`,
   and the surface changes; verify against the local stack and the suite.
3. Deploy order: ops edge functions + app first (they tolerate the old
   workflow), then merge the sync repo branch to `main` (the twice-daily
   `hyperpure` job is already red, so the new code cannot turn a green job
   red). Pushes are releases — the owner picks the window; nothing merges to
   either `main` while the counter trades.
4. Rollback: revert the ops deploy (surface returns to hidden-button +
   eager-mailbox behaviour); the sync repo's scheduled jobs are unchanged by
   the new workflow file's existence.

## Open Questions

- **Auto-heal in the scheduled job** (carried from the seed, deliberately
  undecided): should `sync.yml` notice "Hyperpure cold, Zomato warm" and
  re-mint without any tap, weighed against the xvfb cost it adds to a job that
  is currently browser-free and cheap? Decided during implementation by
  measuring what the capture-only run actually costs; the ladder works
  correctly without it either way.
- **The missing-orders window** (observed 2026-08-22): `readStatement`'s
  missing list compares all delivered history against the statement window, so
  short windows flag long-settled orders. Fixing the comparison is in scope
  only if it stays a filter, not a redesign.
