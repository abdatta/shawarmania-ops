## Context

### What is already multi-tablet, and is only being proved here

The database command layer was written for concurrency before there was anything
concurrent to run on it, and several later changes kept that property without
being able to exercise it. Naming them is what makes this change small:

- **Ownership is already enforced by the database.** `order-lifecycle` binds
  create to the tablet that made it and requires that same tablet for revise, pay,
  cancel and preparation, and already carries the scenario "Another tablet of the
  outlet sees but cannot act".
- **The pipeline is already outlet-wide.** Since #45 both bands list the whole
  outlet's orders and name the creator when another operator took one, so a second
  tablet needs no new rail — it needs a second tablet.
- **Readiness already counts tablets, not a tablet.** `billing_day_readiness`
  builds its participating set from every distinct `device_id` with a shift for
  the outlet and date, and reports missing and stale confirmations per tablet.
  Nothing about it assumes one.
- **Numbering is already transactional and per outlet**, and
  `billing-command-contract` already resolves replay by command UUID and canonical
  hash, so two tablets paying at once is arithmetic the server already does.
- **The tablet table already carries `label`**, `enrolled_by`, `revoked_at` and
  `last_seen_at`. Management reads a row; it needs to read rows.

### What actually stands in the way

One partial unique index, `counter_devices_one_active_per_outlet`, and the
surfaces built on the assumption it guarantees. And that index has a second
problem already on the backlog: because a tablet row counts as the outlet's
counter the moment redemption commits, a setup whose sign-in never completes
spends the outlet's only slot and needs an admin to clear it. Both are the same
invariant. Rewriting it once is the reason the todo names this change.

## Goals / Non-Goals

**Goals:**

- Several independently removable tablets at one outlet, each bound to that one
  outlet forever.
- Ownership, per-tablet shifts, isolated queues and outlet isolation all intact
  under real concurrency, proved rather than argued.
- Unique, sequential, never-reused per-outlet bill numbers when two tablets pay
  at once and when one syncs late.
- A setup failure that costs a code, and no longer a counter.

**Non-Goals:**

- Order transfer, privileged recovery upload, or an optimistic-version conflict
  contract. All three cut on 2026-08-09.
- Ordinary cross-tablet order editing, shared local storage, peer sync, quotas,
  or automatic setup.
- Local allocation of a bill number.

## Decisions

### One outlet to many tablets, each removable alone

Drop `counter_devices_one_active_per_outlet`. Each row keeps one immutable outlet
binding, its own machine Auth identity, its label, its setup and removal
attribution and its status. Removal stays permanent and per row: there is no
paused state, and returning hardware to service still takes a fresh code.

Sharing one machine identity across tablets was rejected outright — one leak or
one removal would take every counter at the outlet with it, and no command could
say which physical till produced it.

### The slot is proven, not claimed

A redeemed setup creates a row that is **not yet a counter**: it does not appear
on the Tablets surface, reaches nothing, and expires on its own if the browser
never proves a session. It becomes an active tablet only on that proof.

This is the shape the backlog note already argued for, and the reason it waited:
it makes the invariant conditional on a second column, which was the wrong trade
to make at the end of #9 for a failure with a two-tap manual recovery. Here the
invariant is being rewritten anyway. Its constraints carry over unchanged — two
people setting up at once must still not produce two counters where one was
intended, an unproven row must never need an admin to clean up, and the existing
remove-and-reissue path must keep working as the fallback. The failure is injected
in test — a redemption that commits followed by a sign-in that does not — rather
than asserted from the code path that handles it.

**The unproven row expires with the code that created it** [owner, 2026-09-02].
The window is the `expires_at` the setup code already carries, evaluated where the
row is read, in the same shape as `expires_at > now()` on the code itself. This
was chosen because it introduces no second duration for anybody to learn, tune or
find wrong later, and no scheduled cleanup: an expiry a reader evaluates cannot
fall behind, and there is no job to notice has stopped running. It is also the
honest window, since the browser proving its session is the tail of the same act
the code authorises, and an admin who watched a setup fail reissues rather than
waits.

A short fixed window measured from redemption, fifteen minutes being the obvious
candidate, was rejected for being a number with no source: it would have to be
defended against a slow tablet on a bad connection, and defending it means tuning
it. A scheduled sweep that deletes unproven rows was rejected because it makes
correctness depend on a job continuing to run, and a row that is invisible when
read needs no deletion to be harmless. Keeping the row indefinitely and letting
the admin clear it was rejected outright: that is the current behaviour and the
whole complaint.

### One live code per outlet was the other singleton, and it is reshaped here too

Found while implementing, on 2026-09-02, and decided by the owner the same day.
`counter_device_setup_codes_one_live_per_outlet` holds an outlet to a single
unredeemed setup code, and `issue_counter_device_setup_code` enforces it by
**silently superseding** whatever live code the outlet already had. Neither the
proposal nor this design had noticed it, and the spec's own scenario of two
admins setting up at once was therefore unreachable: the second issue killed the
first code before either tablet was touched.

Both go. An outlet MAY hold several live codes at once, one per tablet being set
up, and issuing a code no longer invalidates another. Redemption needs no change
at all, because it already finds a code by its hash rather than by its outlet.

The reason for taking it here rather than leaving it is that silent supersession
is only harmless while an outlet has exactly one tablet. Today `tablet_exists`
refuses the second issue outright, so two admins can barely collide. Once several
tablets are the point, issuing codes becomes a repeated act, and the failure it
produces is the worst shape available: an FA at the outlet and an SA away from it
each generate a code, the second silently voids the first, and the admin who
walks to the counter is told only that their code is `invalid`, which is the one
response deliberately designed to explain nothing.

What replaces it is a refusal at the point of asking, in the shape the function
already uses for that purpose: an issue naming a label an active tablet at that
outlet already holds is refused as `label_taken`, so the admin learns it on their
own phone rather than at the counter. The active-label unique index remains the
boundary, and redemption translates its violation into the same `label_taken`
rather than failing as an unhandled write, because two codes issued with one
label is now a reachable state.

Widening the window in which a stray code still works is the cost, and it is
bounded by what already exists: a code lives at most an hour by the ceiling
`#adversarial-review` put on it, is single use, is stored only as a hash, and now
buys a row that is not a counter until a browser proves a session.

Keeping the index and rewriting the scenario to match was rejected: setting up
two tablets sequentially does work, but it leaves the footgun in place at exactly
the moment the change makes it reachable. Refusing an issue while any live code
exists, with an explicit replace, was rejected as a new path to build and explain
for a problem that per-label refusal answers, and because it can make an admin
wait out an hour for their own typo.

### The server is the only coordinator, and stays the only one

Each tablet keeps its own Dexie stores, its own resume record and its own drain
leader, and never reads or writes another's. They converge only through command
UUID and canonical-hash idempotency, row locks, transactional per-outlet bill
numbering and outlet RLS.

Peer-to-peer or shared browser storage was rejected because it adds an
availability and security boundary that cannot enforce outlet isolation more
strongly than the database already does, and because it would make two tablets
capable of disagreeing about money with nobody to arbitrate. Client-reserved
blocks of bill numbers were rejected because an offline gap or a reuse becomes
visible in the accounting.

**Resumption is already per-tablet, and one fact about it is not.**
`offline-billing-resumption`, which arrived with #34 after this proposal was
first written, uses a record only where its tablet "is this installation, and no
other" and already refuses a record naming another tablet. Two tablets need no
correction to that. What a single tablet could not expose is that the record
holds the **outlet's** pipeline, which since #45 includes the neighbour's orders:
resuming offline therefore hands a tablet a remembered list of work it may see
and may not touch, with no server to ask. So ownership has to be refused locally,
and the remembered pipeline has to read as a past read rather than as the
outlet's present. That is the capability's one delta here.

Leaving it unwritten was rejected. The phase gate gives one tablet an outage
while the other trades, so the behaviour is being tested either way, and a tested
behaviour no requirement states is the exact shape of the two sentences #45 left
behind.

### Ownership is unchanged, and there is still no transfer

Ordinary revise, pay, cancel and preparation continue to require the owning
tablet, whoever holds the shift. A second tablet sees the order on the outlet
pipeline with its creator named and is refused by the database if it acts.

An order stranded on an unusable tablet is cancelled by that outlet's manager
with a reason and re-rung — the path `counter-billing` and `order-lifecycle`
already specify. A transfer command was considered and cut on 2026-08-09: an
order is a short-lived record so the kitchen knows what to cook, paid minutes
later on handover, and building custody handoff for a twenty-minute object buys
a conflict surface instead of an outcome. Automatic takeover was rejected for the
stronger reason that two live tablets could both accept changes and merge money
without anybody deciding to.

### Bill numbers follow acceptance, and never stand in for chronology

The existing allocator serializes successful bill inserts per outlet, so numbers
follow the order the server accepted them. With two tablets, and especially when
one has been offline, that can differ from the order customers were served in.
`ordered_at`, `paid_at` and their explicit business dates keep the economic
chronology; the number stays unique, sequential and never reused. No surface may
sort accounting history by bill number as a proxy for time.

Forcing event-time numbering was rejected because disconnected tablets cannot
agree the next number without collisions or later renumbering, and a renumbered
bill is a bill somebody has already been handed.

### Management reads a collection and always names its target

Every inspect, remove and health action takes one explicit tablet. An FA sees
only the tablets at outlets they are assigned to and an SA sees every one, with
the database refusing anything else rather than the surface hiding it. What each
card carries is unchanged from today: setup state, last seen, last reported
unsent count, whether a shift is open and who holds it — and no bills, no order
counts, no totals, no drawer cash and no customer fact. Reported counts stay
advisory and timestamped, because a tablet that is offline cannot report and a
zero that is hours old must never read as an empty queue.

A server-side query replacing the tablet's own report was rejected because the
server cannot see work that has not been sent, which is exactly the work worth
knowing about. Uploading queue contents was rejected because monitoring does not
justify copying customer data off the till.

### Both tablets confirm, or the date is not ready

`billing_day_readiness` already requires a current end-of-day confirmation from
every tablet that held a shift for the date, and invalidates one when a later
command from that tablet arrives. Two tablets make that real: one tablet's
confirmation never covers the other, and a second tablet still offline leaves the
date outstanding and names itself as the reason.

Aggregating reported health instead was rejected because health is advisory and
stale by construction. Requiring only the last active tablet was rejected because
the other one may be holding accepted money.

## Risks / Trade-offs

- **Bill numbers stop matching the order of service** once a tablet syncs late.
  Mitigated by showing ordered and payment times and business dates explicitly,
  and by never sorting by number. Worth stating in `docs/LIMITATIONS.md`.
- **Two tablets take the same customer's order twice.** A phone is not an order
  identity, so the command UUID cannot prevent a genuine business duplicate. It is
  reconciled the ordinary way — cancel one, with a reason.
- **Reported queue counts go stale.** Labelled with their report time, and never
  read as proof a queue is empty.
- **One tablet missing delays the outlet's date.** Correct, and it names itself.
  The resolution is reconnecting it or removing it, never letting the other stand
  in.
- **The invariant is being rewritten while it is the thing protecting the
  counter.** Mitigated by ordering: everything else lands and passes with the
  index still in place, and the index is dropped last.

## Migration Plan

**Corrected on 2026-09-02, during implementation.** As first written this plan
kept the singleton index in place through step 3 and dropped it in step 4, with
step 3 running the two-tablet suites. That ordering cannot execute: a unique
index on `(outlet_id) where removed_at is null` makes a second active tablet
unwritable, so there is no way to run a two-tablet suite while it stands.

What the ordering was protecting is real and is kept: never allow a second tablet
while an unproven row still counts as a counter. One migration satisfies that
better than two, because both land in the same statement and there is no window
between them at all. So:

1. **One migration** adds the unproven-setup state, the active-label uniqueness,
   the proof helpers and both index reshapes, atomically. A separate gate
   (`scripts/check-multiple-billing-devices-migration.test.mjs`) asserts it stays
   additive, backfills before it constrains, and never renames or repopulates
   `counter_devices` — which is what keeps existing tablet rows, machine
   credentials, pending local work and historical attribution in place.
2. Seed and demo fixtures gain a second tablet at one outlet, so every suite
   below runs against a shop that has two.
3. Build the collection management surfaces and per-tablet actions.
4. Run the two-tablet database, RLS, removal and concurrency suites.
5. Set up a second tablet at one live outlet, verify online and offline
   coexistence and a full trading evening, then allow a second tablet elsewhere.

Rollback stops new setups and must never delete or merge a tablet identity. An
already active tablet is removed individually through ordinary operations.

## Resolved Questions

**Is the dependency on #34 still a dependency?** Moot: #34 archived on
2026-09-02, so single-tablet offline resumption is proven and in the living
specs before this change starts. It was never a code dependency in any case, and
the sequencing argument it rested on has been paid: a bug found here is not being
debugged through two tablets and interleaved reconnects at the same time.

**How long does an unproven tablet row live?** Answered above: the expiry its own
setup code already carries, evaluated at read time. Recorded as a decision rather
than left to the implementation, because it was the one number this change would
otherwise have invented.

**Does `offline-billing-resumption` need a delta?** Yes, one added requirement,
for the outlet-wide remembered pipeline. Reasoned above.

**Does the Kalyani code-request complaint belong here?** No, and the Non-goals
say why. It is the only backlog note adjacent to this change that is deliberately
not being taken.
