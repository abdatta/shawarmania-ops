## Context

### What already works, and is not rebuilt here

Four things this change would otherwise have had to invent already exist, and
naming them is most of the scoping:

- **The app itself is cached.** `vite-plugin-pwa` precaches the build and serves
  `index.html` as the navigation fallback, so a reload with no network already
  gets the application. What it does not get is a counter.
- **The outbox is durable and ordered.** `src/outbox/` holds immutable envelopes,
  their dependency edges, their server results and their attributed local
  resolutions, with one drain leader and bounded backoff. It already survives a
  restart; `billing-delivery` says so.
- **The overlay is already the counter's reader.** The live adapter composes what
  the server last returned with this tablet's projectable envelopes, for orders
  and for bills, precisely so accepted work cannot flicker back into being
  unpaid. Offline resumption does not need a second reducer. It needs the
  **server side** of that composition to still exist after a cold start.
- **Readiness is already a server answer that names tablets.**
  `billing_day_readiness` reports open orders, live shifts, and missing or stale
  end-of-day confirmations per participating tablet, and
  `confirm_billing_end_of_day` refuses while anything is unsent. Nothing offline
  may weaken that, and nothing here needs to change it.

### What actually blocks the counter

`useRealSession` resolves the tablet by asking the backend. With no answer the
resolution is `indeterminate`, and on a first load — which is what a cold start
is — that becomes `unavailable`, so `CounterRoot` renders `UnconfirmedSession`.
That single branch is the boundary, and `menu-management` states its consequence
as a deliberate V1 scenario. This change replaces that scenario rather than
adding beside it.

## Goals / Non-Goals

**Goals:**

- Reopen the *same* approved counter after a cold start with no backend.
- Keep every counter command available for the rest of that shift.
- Make remembered data unmistakably remembered, with the time it was read.
- Reconnect through the existing exactly-once command protocol, unchanged.

**Non-Goals:**

- Offline credential verification, a new shift offline, or any extension past
  expiry or cutover.
- A privileged recovery upload, an order transfer, or an optimistic-version
  conflict contract. All three were cut on 2026-08-09.
- Peer-to-peer sync between tablets, or local allocation of a bill number.
- Multiple tablets at one outlet, which is #35.

## Decisions

### The tablet keeps one resume record, written whole

After a successful online counter load the tablet writes, in one Dexie
transaction, everything it would otherwise have asked the server for at startup:
its own tablet id, label and outlet; the live shift's id, operator name, opened
time, business date and expiry; the outlet's cutover; the menu it is selling
from; the outlet pipeline and this shift's bills as the server last returned
them; the exact-phone customer results this tablet resolved; the instant of that
successful read, the server time observed with it and the device clock beside it;
and a schema version. A resume record becomes readable only once every part of it
has committed, and a cold start uses the newest complete record for the same
tablet.

Updating each cache independently was rejected because a crash between two writes
can pair a new menu with a stale shift, and that failure would be both silent and
financial. Relying on service-worker response caching alone was rejected because
a cached HTTP response cannot express a shift's expiry, an outlet's cutover, or
the read time a person has to be shown.

### A resume record opens the UI; it never opens authority

The counter opens offline only when the stored tablet is this installation, the
record is complete and its schema is supported, the shift has not ended, and the
device clock is before both the stored expiry and the outlet cutover. Every
command still carries the real tablet id, shift id and its own immutable creation
time, and the server still validates the shift, the tablet's removal state and
the historical-validity rules in `billing-command-contract` when the command
finally arrives.

A signed offline credential was rejected: it would not make removal detectable
offline, would not fix a wrong clock, and would duplicate an authority the
database already holds. The honest property is the one that matters — tampering
with the record can open a screen, and cannot make the backend accept a single
command it would otherwise refuse.

### Remembered data is labelled, and the pipeline says whose truth it is

A persistent line states that the tablet is offline and when it last read
successfully. The menu grid, the pipeline and the bill list each read as of that
time.

The pipeline is **outlet-wide** since #45, which matters here: offline, this
tablet can refresh only its own work. Another tablet's card, and a manager's
cancellation of a stranded order, cannot reach it. That is tolerable precisely
because ordinary action on another tablet's order is already refused — the loss
is freshness on cards this counter could never act on. The rail says as of when,
and reconnect replaces it wholesale.

Discarding the remembered pipeline at reconnect before draining was rejected,
because it can hide unsent work behind a screen that looks empty.

### Customer identity is reused only where it was already resolved

An exact normalized full phone this tablet resolved online may be offered again
offline, labelled as remembered, with the same replacement warning. A phone with
no such result stays unresolved, and the order carries its optional form snapshot
until sync, which is what the snapshot is for.

Caching enough to answer any lookup was rejected because it would put a browsable
copy of a global directory on counter hardware, which `global-customer-identity`
exists to prevent, and because it cannot know a number first seen at the other
outlet anyway.

### Nothing may say "provisional"

`counter-billing` forbids the word outright: a queued bill carries a short local
reference and the words **not sent yet**, and its number arrives when it does.
Offline resumption inherits that verbatim. A bill composed after a cold start is
identical in this respect to one composed during a drop, and no new vocabulary
enters billing.

### The stop is the earlier of two known instants

New work ends at the earlier of the stored shift expiry and the outlet cutover,
evaluated against the device clock. Beyond it the tablet shows unsent and
needs-attention status and the path back: reconnect, and the operator's phone.

A grace period and an offline re-approval were both rejected — the owner's rule
is that a counter opens by a named person entering a code on their own phone, and
an offline tablet cannot do that. Clock skew is already a recorded limitation;
this change adds the two facts needed to see it, the last observed server time
and the device time beside it, and warns rather than correcting. A rolled-back
clock can open local UI early and still produces commands the server rejects
against real shift bounds.

### Finish Day is refused offline, in words

`billing-delivery` requires Finish Day to obtain authoritative server state
before enabling completion, and `billing-command-contract` requires the
end-of-day confirmation to be recorded online with nothing unsent. Offline,
neither is possible. The sheet therefore opens, states that the day cannot be
finished without the backend, and names what is waiting.

Letting the tablet record a local end-of-day was rejected for the reason the
server contract already implies: a confirmation is invalidated by any later
accepted command, so one made offline is a claim a subsequent drain can falsify.
Treating cutover as an automatic finish was rejected because cutover ends
authority and proves nothing about delivery.

### Reconnect re-resolves, drains, then refreshes

On a real response the tablet re-resolves its own status and shift first, so a
removal is learned before anything else happens. If it was removed, ordinary
delivery and new work stop and the envelopes stay on the device — there is no
privileged upload, by decision. Otherwise the drain runs in dependency order and
each command resolves exactly as it does today: accepted, exact replay,
correctable refusal, or terminal refusal moved to needs attention with its
ancestry intact. Only then are the remembered projections replaced by
authoritative reads.

An order a manager cancelled during the outage refuses the tablet's later command
as not open, which is the existing contract and needs nothing new — the operator
sees the refusal named against that order, and re-rings it if the food was made.

## Risks / Trade-offs

- **The tablet is removed while it is offline.** It keeps capturing, and none of
  that is accepted after removal. This is the existing bargain, recorded in
  `docs/LIMITATIONS.md`; what this change adds is a longer window in which it can
  happen, and an honest line saying removal cannot be checked while offline.
- **A wrong clock opens a counter that should have stopped.** Bounded by server
  validation of the real shift, and made visible by showing last server time
  against device time.
- **Remembered customer facts are PII on counter hardware.** Restricted to exact
  results this tablet actually used, excluded from logs and telemetry, and capped
  by a stated retention. `docs/SECURITY_AND_PRIVACY.md` carries it.
- **A build cannot read an older resume record.** It refuses to resume rather than
  erasing one, and no resume-record migration touches a pending envelope.
- **A long outage delays the end-of-day confirmation.** Correct and intended:
  readiness keeps naming the tablet until it reconnects, and no local state may
  substitute for that.

## Migration Plan

1. Add the resume-record stores and their readers, writing records during
   ordinary online sessions with the offline fallback still disabled.
2. Verify a written record against a live counter's own reads.
3. Exercise cold start, extended capture, a second restart, expiry, cutover,
   clock skew, an application update across the record's schema, lost responses,
   and a removal learned at reconnect, on one tablet at a test outlet.
4. Enable the fallback, keeping a switch that returns the tablet to today's
   online-resume behaviour without deleting a single envelope or record.

Rollback disables the fallback only. Every envelope drains afterwards through the
existing path once somebody is online.

## Open Questions

None.
