## Context

The device boundary, customer directory, order/bill transaction contract, and
complete billing lifecycle UI land before this change. Billing Live is therefore
the integration and rollout boundary: real adapters replace demo adapters and
the counter starts taking money. Launch has reliable connectivity and exactly
one enrolled device per outlet, but a brief network loss must not lose an order
the operator was just told was accepted.

V1 deliberately provides durable local commit and retry without claiming full
offline operation. An already-open, authenticated counter with a loaded menu may
survive a transient outage. Opening or resuming the counter after a reload still
requires online authentication. Roadmap #34 expands that boundary, and #35 then
adds several active devices per outlet.

## Goals / Non-Goals

**Goals:**

- Wire every #31 billing lifecycle surface to #9, #32, and #33 real contracts.
- Acknowledge counter writes only after a durable IndexedDB commit, then deliver
  them exactly once without keeping the operator waiting for the network.
- Preserve pending work through logout, cutoff, restart, and application update.
- Make response, conflict, quarantine, late-sync, and recovery states visible.
- Promote the billing-related gates to live while retaining the coherent demo.

**Non-Goals:**

- Starting or resuming billing offline after a reload.
- Several active billing devices at one outlet.
- Emergency billing from an unenrolled personal device.
- Attendance, partial/split payments, refunds, GST, printing, or digital sharing.

## Decisions

### Local commit is the V1 acknowledgement boundary

Every mutating adapter builds the immutable command envelope defined by #9/#33
and commits it to Dexie before reporting success or clearing the form. Network
delivery starts afterwards. If durable storage fails, the UI remains populated
and reports that the action was not saved.

Waiting for the server before clearing was rejected because a brief outage would
stop the counter. Clearing before IndexedDB commit was rejected because browser
or tab failure could erase a transaction the operator believed was recorded.

### One ordered drain leader delivers dependency chains

One visible page becomes drain leader using Web Locks with the #9 IndexedDB lease
fallback. Commands are FIFO within a dependency chain: create precedes revise,
revise precedes pay/cancel, and a corrected replacement follows its rejected
original. Independent commands may proceed when a quarantined chain is blocked.
Retries use bounded exponential backoff with jitter and resume on foreground,
connectivity evidence, and periodic leader ticks.

Sending from every tab was rejected because it amplifies retries and makes local
status race. Strict global FIFO was rejected because one conflicted order would
freeze every unrelated payment.

### Actual request evidence, not `navigator.onLine`, defines delivery state

A response or successful health/read request marks the backend reachable. Network
exceptions, timeouts, or missing HTTP responses mark it unreachable and display
the persistent offline banner. Authentication, validation, RLS, version, and
idempotency responses are server responses and are never relabelled as offline.

The browser connectivity hint is useful only to trigger an attempt. Treating it
as truth was rejected because captive portals and reachable Wi-Fi without the
backend produce both false positive and false negative states.

### V1 caches only the active authenticated counter context

While reachable, billing always fetches the latest outlet menu and customer/order
state. The active daily grant retains its last successful menu snapshot. If the
backend drops while that screen remains active, the operator may continue using
that snapshot and local commands until cutoff, with an offline banner. A reload,
closed app, missing grant, or new business day requires online sign-in and a fresh
menu before new work can start; the background drain may still deliver old work.

This boundary gives short-drop protection without presenting V1 as a deliberate
full-day offline product. Persisted offline bootstrap and safe offline resumption
belong to #34.

### Server outcomes map to explicit local terminal states

Accepted and exact-replay responses mark the local command delivered and retain
its server references. Retryable transport/server failures remain pending. A
version conflict, changed-content UUID reuse, invalid historical grant, or other
correctable permanent rejection becomes quarantined. Correction creates a new
linked UUID; discard writes an attributed local tombstone. Neither path mutates
the rejected envelope.

Treating every conflict as success was rejected because different money could be
hidden behind UUID reuse. Infinite retry of a deterministic refusal was rejected
because it conceals action the operator or admin must take.

### Revocation blocks access without deleting recovery evidence

Normal drain stops when the device is revoked. Pending pre-revocation envelopes
remain durable. An authenticated FA/SA physically using the device may invoke the
upload-only recovery contract from #9; it cannot restore counter navigation or a
daily grant. Server-returned late, historical, and recovery flags are retained
and exposed on the manager/admin surfaces.

### Finishing billing creates a close-readiness seal, not a local promise

The billing device exposes “Finish billing for the day” only online. It first
drains every command for the business date and requires no pending, blocked, or
quarantined entry. One server transaction ends the current grant and records the
device-day seal/watermark from #33. The counter then accepts no new work for that
date unless an eligible operator reauthenticates online before sign-off; reopening
invalidates the seal. After #12 signs the day off, no grant can reopen that date.

A local “queue looks empty” indicator was rejected as a close gate because the
cash-signoff caller may be on another device and a stale report is bypassable.
Automatically sealing on logout was rejected because logout can occur with
unresolved work and does not express an end-of-day decision.

### Live and demo remain separate adapter compositions

The real enrolled-device context receives Supabase-backed read adapters and
local-first command adapters. `/demo` retains the #31 synthetic adapters and
never opens the live Dexie queue or writes to Supabase. Gate promotion changes
visibility, not the demo dataset or route semantics.

## Risks / Trade-offs

- **A user reloads during an outage and cannot resume billing in V1** -> explain
  the online-resume boundary in the recovery screen and deliver #34 next.
- **IndexedDB is unavailable or quota-constrained** -> refuse to acknowledge the
  command, keep the form intact, and expose a blocking storage diagnostic.
- **A dependency chain quarantines** -> block only descendants and keep unrelated
  orders draining; show the exact chain requiring correction or discard.
- **An app update changes envelope code** -> version envelopes and retain readers/
  senders for every locally supported pending version through the rollout window.
- **Late delivery changes historical revenue** -> retain #33 dual dates and flags;
  #12/#13 surface reconciliation exceptions rather than rewriting a close.
- **The device is offline or quarantined at closing time** -> day sign-off remains
  blocked until the device reconnects and resolves/seals; no silent local bypass.

## Migration Plan

1. Ship Dexie schema/readers and local-first adapters while gates remain demo.
2. Exercise direct pay, unpaid-order edit/pay/cancel, quarantine, and recovery
   against local Supabase with forced transport failures and browser restarts.
3. Enrol one test device per outlet, load the live menu, and run shadow smoke tests.
4. Promote device and billing gates to live, one outlet at a time, with the other
   outlet able to remain demo/hidden during rollback.
5. Observe pending/quarantined counts without logging payloads or phone numbers.

Rollback may demote gates while leaving compatible queue code installed so
accepted local commands continue draining. Never roll back by clearing IndexedDB
or deleting command receipts.

## Open Questions

None.
