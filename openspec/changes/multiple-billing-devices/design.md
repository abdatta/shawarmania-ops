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

1. Add the unproven-setup state, active-label uniqueness and management metadata
   **with the singleton index still in place**, and prove existing tablet rows,
   credentials, pending local work and historical attribution are untouched.
2. Build the collection management surfaces and per-tablet actions, still against
   one tablet per outlet.
3. Run the two-tablet database, RLS, removal and concurrency suites.
4. Drop the singleton index only once those pass.
5. Set up a second tablet at one test outlet, verify online and offline
   coexistence and a full trading evening, then allow a second tablet elsewhere.

Rollback stops new setups and must never delete or merge a tablet identity. An
already active tablet is removed individually through ordinary operations.

## Open Questions

**Is the dependency on #34 still a dependency?** It is now sequencing judgement
rather than a code dependency. Nothing in this change reads a resume record, and
the constraint, label, setup, management and concurrency work would all pass with
V1 offline behaviour. What #34 buys is confidence: proving single-tablet offline
resumption first means a bug found afterwards is not being debugged through two
tablets and interleaved reconnects at the same time. If the two are reordered or
split, the halves that genuinely need #34 are the offline coexistence in step 5
and the extended-outage cases in the gate.
