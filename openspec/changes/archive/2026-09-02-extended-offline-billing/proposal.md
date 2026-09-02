# Proposal: Extended Offline Billing

> **Model**: Opus · **Wave**: D · **Depends on**: #10 · **Gate**: **Billing V2.1:** after one online shift approval the tablet is closed, updated and reloaded with no reachable backend and reopens **the same counter** — its menu, the outlet pipeline and this shift's bills all present and labelled as of their last read; twenty mixed commands across compose, save, prepare, reprepare, pay, take-back, tender correction and cancel are accepted through an extended outage, survive a second restart, and land exactly once on reconnect with refusals arriving as refusals; the counter stops at its shift's expiry and at cutover and opens no new shift without the operator's phone and the backend; Finish Day refuses offline and names why; the end-of-day confirmation stays online-only, so `billing_day_readiness` keeps naming the tablet until it reconnects; and the four-role demo walkthrough still walks.

## Why

Billing V1 keeps an **already open** counter working through a connection drop,
and the outbox already survives a reload. What does not survive is the *opening*.
Session resolution asks the backend who this tablet is, and with no answer the
first resolution is `unavailable`: the tablet shows the could-not-confirm screen
with a retry, not a counter. `menu-management` says so deliberately — "V1 opens
no new billing work from a persisted cache".

So the realistic failure is not the outage; it is the reload inside it. A tablet
that drops connection at 19:00 keeps billing until something reloads it, and the
things that reload it are ordinary: the browser discards a backgrounded tab,
somebody force-closes the app, the battery runs out, an update is taken. After
that the counter is unreachable for the rest of the evening even though every
fact needed to run it was on the device the whole time.

## What Changes

- **Keep one resume record on the tablet**: its own identity and outlet, the live
  shift and its bounds, the outlet's cutover, the menu, the pipeline and this
  shift's bills as last read from the server, exact-phone customer results this
  tablet resolved, the last successful read time and the server clock observed
  with it. It is written as one unit and is readable only once complete.
- **Let session resolution fall back to it.** On a set-up tablet whose first
  resolution is `indeterminate`, open the counter from a complete resume record
  for that same tablet while its shift has not ended and neither its expiry nor
  the outlet cutover has passed. Anything else keeps today's screen.
- **Say what is remembered and what is current.** A persistent offline line
  carries the last successful read; the menu, the pipeline and the bill list are
  labelled as of that read. Nothing cached is presented as current server truth.
- **Compose the counter the way it is already composed.** The adapter already
  overlays this tablet's durable envelopes onto server rows for orders and bills;
  the resume record supplies the server side of that overlay when there was no
  read to do it. No second source of truth and no second reducer.
- **Cover every command the counter can now make** across a cold start: create,
  revise, mark prepared, reprepare, pay, take a payment back, cancel after
  payment, correct a tender, cancel, and record an expense.
- **Stop at the boundary rather than near it.** New work ends at the earlier of
  the shift's expiry and the outlet cutover. After that the tablet shows unsent
  and needs-attention status and asks for the backend and the operator's phone.
- **Refuse Finish Day offline**, because its readiness sheet is a server answer
  and the end-of-day confirmation is an online command. Say that plainly instead
  of offering a button that cannot mean anything.
- **Reconnect in one order**: re-resolve the tablet and shift, drain in dependency
  order, then replace the remembered projections with authoritative reads. A
  removed tablet stops there, and its envelopes stay on the device exactly as the
  existing contract says.

## Capabilities

### New Capabilities

- `offline-billing-resumption`: the resume record, what may open the counter from
  it, the freshness it must disclose, where it stops, and what reconnect does.

### Modified Capabilities

- `billing-delivery`: capture continues across a deliberate restart inside one
  approved shift, not only across a drop in a session that stays open.
- `menu-management`: the scenario that refuses a persisted cache at startup is
  replaced by one that permits it inside a live shift and still prefers the
  latest reachable menu whenever the backend answers.
- `counter-device-sessions`: a tablet may re-enter **its own** unexpired shift
  from the device without the server, and may never create one there.
- `counter-billing`: offline provenance on the workspace, the pipeline read as of
  its last outlet-wide read, and Finish Day's offline refusal.
- `app-shell`: the constrained offline counter after a cold start, and no
  personal-role surface inside it.
  While editing this capability, carry the correction described in
  [`openspec/todos/pipeline-rename-left-two-sentences-behind.md`](../../todos/pipeline-rename-left-two-sentences-behind.md):
  its Counter-workspace paragraph still says the activity column holds **this
  tablet's open orders**, which #45 made outlet-wide, and still names the
  resizable pair the current-bill and activity columns where `counter-billing`
  now says middle and activity. The app already behaves the corrected way; only
  the sentence is behind.

## Impact

The Dexie schema gains resume-record stores beside the existing envelope stores;
session resolution gains one fallback branch on the counter path; the live
billing adapter gains a persisted base for the overlay it already performs; the
counter chrome gains offline provenance; Finish Day gains an offline refusal. The
command contract, the RPCs, RLS, bill numbering and the server's authority over
every delayed write are **unchanged** — nothing here asks the database for a new
permission, and a tampered resume record can at most open local UI.

## Non-goals

- Opening a **new** shift offline, or verifying any credential offline. The
  handshake needs the operator's own phone and the backend, and stays that way.
- Extending a shift past its expiry or past cutover.
- Any privileged upload or recovery path from a removed tablet. There is none by
  decision, `docs/LIMITATIONS.md` records the cost, and this change does not add
  one.
- Order transfer between tablets, and an optimistic-version conflict contract.
  Both were cut on 2026-08-09; a stranded order is cancelled by that outlet's
  manager with a reason.
- Browsing customer identity offline. Only an exact full phone this tablet
  already resolved online may be reused, labelled as remembered.
- A second tablet at the outlet, which is #35.
- Emergency billing on an unregistered personal device
  ([`openspec/todos/emergency-billing-continuity.md`](../../todos/emergency-billing-continuity.md)).

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and
`docs/LIMITATIONS.md`.
