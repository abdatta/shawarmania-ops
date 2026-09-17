# Design: Repair Kalyani Counter Attribution

This document is written for the separate session that will implement and run
the repair. It must be sufficient without access to the conversation that
identified the incident. Production identifiers, customer facts and employee
identity deliberately remain outside the repository.

## 1. Context and dated production baseline

The physical event is settled: on business date **2026-09-16**, the tablet then
enrolled at Kanchrapara was operated at Kalyani. All sales taken by that device
on that business date belong to Kalyani. The tablet offered Kanchrapara's menu
because menu and outlet context followed device enrollment, not physical
location.

Read-only production checks were repeated on **2026-09-17 IST** while drafting
this proposal. They returned:

| Fact | Reviewed baseline |
|---|---:|
| Kanchrapara incident bills | 37, all settled, none void |
| Bill-number range | 742–778 |
| Bill total | 906,000 paise (₹9,060) |
| Cash / UPI | 213,000 / 693,000 paise |
| Bill items / payment allocations | 43 / 41 |
| Orders | 39: 37 paid, 2 cancelled |
| Order items | 45 |
| Billing command receipts | 115 |
| Public receipt links | 37 |
| Bill discounts / order discounts | 0 / 0 |
| Payment corrections / attribution reviews | 0 / 0 |
| End-of-day confirmations | 0 |
| Effective expenses | 5 rows, 38,000 paise (₹380) |
| Kalyani bills and orders on that date | 0 / 0 |
| Kalyani historical bill high-water at first review | 989 |
| Device/operator/shift cardinality | one / one / one |
| Device last-reported unresolved work | 0 |
| Device state | proven, not removed |
| Incident shift | still stored without `ended_at` |
| Operator's active Biller assignments | one at each outlet |
| Earlier Kanchrapara history on the device | 741 bills; 33 earlier shifts |

The final read-only production refresh on **2026-09-18 IST** found one later,
legitimate Kalyani block that did not exist at first review: bills 990–1024 on
business date 2026-09-17, all 35 settled and unvoided, totalling 753,000 paise,
with 40 items, 37 payments, 35 public links, one payment correction and one
correction allocation. Thirty-six command results carry those bill IDs/numbers.
The Kalyani counter and existing maximum are both 1024. This whole graph is now
part of the frozen repair input rather than treated as disposable later trade.

The earlier history is load-bearing evidence: this is not a request to pretend
the tablet was always Kalyani's. It genuinely served Kanchrapara before the
incident and moves only after the incident day is corrected.

A further read-only production check at **2026-09-17 02:49 IST** confirmed that
no outlet tablet was online: Kanchrapara had last reported at 21:24 IST, Kalyani
at 17:21 IST, and Kalyani Cafe on 2026-09-10. The incident tablet's stored count
was zero unresolved; its last report was about seven minutes after its latest
accepted command and nine minutes after its latest synced bill. Its incident
shift remained open only because its stored expiry was 04:00 IST, and there was
no unresolved shift request. The overnight design therefore assumes no outlet
hardware or outlet network can participate.

The 13 distinct products on settled bills all have a same-price Kalyani
destination. Eleven are exact name-and-price matches. The owner expressly
approved the two aliases:

| Source snapshot | Kalyani snapshot | Price |
|---|---|---:|
| Classic Chicken Shawarma `[S]` | Classic Chicken Shawarma `[SAAJ]` | 11,000 paise |
| Chicken Shawarma Salad | Shawarma Salad | 20,000 paise |

These figures are a proposal baseline, not permission to write. The live tool
must recompute and hash them immediately before apply. Any disagreement is drift
and aborts the run.

Dependency inventory during implementation found one further item only on a
cancelled order: `Double Chicken Shawarma [T]`, 17,000 paise. It is an exact
Kalyani name-and-price match. The complete order/bill graph therefore requires
14 destination menu mappings while the settled-sale statement above remains 13.

## 2. Goals / Non-goals

### Goals

- Make production describe the physical outlet where the incident trade
  occurred without changing any commercial amount or customer fact.
- Preserve stable bill, order, device, shift and public-link identities wherever
  their tables permit it.
- Preserve per-outlet number monotonicity and never reuse a number.
- Keep the existing tablet browser session and make its next shift Kalyani's.
- Make the operation reversible from verified evidence, with the limits of a
  post-commit reversal stated before anybody starts.
- Leave a second session a deterministic runbook with several independent stop
  points and no reliance on conversational memory.
- Preserve outlet isolation after a device identity has history at two outlets.

### Non-goals

- A normal bill correction workflow or a reusable privileged billing endpoint.
- Hiding or deleting infrastructure logs, WAL, provider records or the OpenSpec
  change history. “No audit trail” means no fictional void/reissue/correction
  rows in the application data.
- Recovering from arbitrary future drift by widening the selection. Drift stops
  the run and requires review.
- Making the repair runnable from the browser or distributing a service-role
  credential.

## 3. Decisions

### D1. The repair is an operator tool, not a deploy migration

The tool lives under `scripts/`, is invoked deliberately from a trusted local
environment, and has four modes: `plan`, `apply`, `verify`, and `rollback`.
`plan` is read-only. `apply` requires the exact digest emitted by `plan`, the
production project reference, and an explicit confirmation phrase. `verify`
opens a fresh connection and knows nothing from the apply process except its
signed/hashed manifest. `rollback` accepts only the matching targeted
before-image and its checksum.

A Supabase migration was rejected for the data repair because migrations run in
local, staging and production through deployment, while this mutation is true
only for one production incident. A conditional migration that no-ops elsewhere
would still couple deployment to a manual backup and would be dangerously easy
to mistake for an ordinary repeatable transition.

The tablet-edit RPC and policy correction are different: they are durable
database behavior and invariants and therefore belong in one ordinary migration
with ordinary database and RLS tests. Calling that RPC never performs the
incident bill repair.

### D2. Selection is by an exact incident fingerprint, never by “today”

The repair scope is the intersection of:

- source outlet Kanchrapara;
- target outlet Kalyani;
- explicit business date `2026-09-16`;
- the one device, shift and operator shared by the 37 reviewed bills; and
- the exact dependent graph discovered from those roots.

No timestamp-derived business day is used. No current date is used. The tool
refuses multiple devices, shifts or operators, a different source bill range,
a target counter behind an existing bill, a missing target menu row, a price
mismatch, new incident corrections/discounts/reviews, additional incident-date
source or target trade, any change to the complete later Kalyani 990–1024 bill
graph, either tablet's zero-after-server-work evidence, or the reviewed 1024
target high-water. Any additional bill or dependent row makes `apply`'s locked
plan digest disagree and abort.

The plan manifest contains counts, paise totals, date/range facts and hashes of
opaque IDs. It never prints customer names, phone numbers, receipt tokens or the
operator's identity.

### D3. Backup has two layers and restore proof is mandatory

**Layer one: full logical snapshot.** Before code is allowed to apply, take a
schema-plus-data production dump including `public` and Auth under the existing
snapshot procedure, store it outside the repository, checksum it, and restore
it into an isolated scratch database. A dump that has not been restored is not
accepted as a backup.

**Layer two: targeted before-image.** Immediately before the transaction, export
the complete incident graph, source and target counters, current device row,
shift/request rows, relevant assignments, menu destination rows, and catalog
definitions for every trigger/constraint the tool will alter temporarily. Store
both machine-readable data and a generated compensating script. Hash the row
sets in stable primary-key order.

The full snapshot is catastrophic recovery. The targeted bundle is the quick
reversal. Neither enters Git. The evidence committed to the change contains
only paths, timestamps, checksums, counts and test outcomes.

### D4. Rehearsal uses the restored production snapshot

The tool is run against a scratch restore before production:

1. `plan` must reproduce the reviewed fingerprint.
2. `apply` must produce the intended Kalyani state.
3. `verify` must pass from a new connection.
4. `rollback` must restore row attribution and identities with only the
   documented counter high-water difference.
5. A fresh restore is repaired again. Incident bills must occupy 990–1026, the
   intact later Kalyani block must occupy 1027–1061, and a simulated next Kalyani
   bill must receive 1062 while no Kanchrapara number is reused.
6. Deliberate corruption of every major precondition must make `apply` abort
   without a partial write.

Production apply is forbidden if the restore or either rehearsal fails.

### D5. Stable identities and money survive; outlet identity is corrected

The same bill and order UUIDs stay in place. The repair does not touch subtotal,
discount, tax, rounding, total, quantity, unit price, payment amount, payment
method, customer snapshot, ordered/paid/created timestamps or explicit business
date. Public receipt links remain attached by `bill_id`; their tokens and link
rows do not change.

The operator tool's mutable repair set is limited to outlet IDs, outlet-local
numbers, Kalyani menu-item references and the two approved item-name snapshots,
incident command result numbers, the later Kalyani bills' number plus matching
command result numbers, the incident shift's outlet/end state, five expenses'
outlet, and the existing device's current outlet/label. Its Auth UUID,
session proof, setup attribution and browser credential remain unchanged.

This is a privileged maintenance exception to physical attribution, not a new
application correction semantics. No role grant, RPC or UI can invoke it.

### D6. Move the whole operational graph, not only the visible bills

Moving only `bills.outlet_id` would leave reports disagreeing with orders,
payments, commands and the shift. The tool discovers dependencies from the
incident roots and accounts for at least:

| Graph | Intended treatment |
|---|---|
| `bills` | target outlet; chronological target bill numbers |
| `bill_items` | target menu IDs; approved snapshots; money unchanged |
| `bill_payments` | target outlet; allocation amounts unchanged |
| `orders` | target outlet; keep daily order numbers 1–39 |
| `order_items` | target menu IDs; approved snapshots; money unchanged |
| `billing_commands` | target outlet; canonical accepted results rewritten only where outlet-local numbers appear |
| later Kalyani bills/commands | keep outlet/date/identity/commercial graph; move 990–1024 to 1027–1061 and rewrite only matching command result numbers |
| `counter_shifts` | target outlet; close the incident shift |
| surviving `counter_shift_requests` | target outlet or verified absent, according to its actual terminal shape |
| `counter_devices` | target current outlet/name; identity, proof and setup facts unchanged |
| `expenses` | target outlet for the five same-operator incident rows |
| incident discount/correction/allocation/review/EOD children | required absent by fingerprint; abort rather than invent handling |
| later Kalyani correction/allocation | preserve the one reviewed correction and allocation byte-for-byte |
| `bill_public_links` | unchanged; same `bill_id` and token |
| `bill_public_link_views` | unchanged; access telemetry is not reclassified |
| legacy `shifts` / `bills.shift_id` | required absent for the incident day/graph |
| `counter_device_setup_codes` | one consumed row remains unchanged with the same device UUID |
| `aggregator_dismissed_duplicates` | required absent for the five moved expenses |
| attendance | unchanged; already Kalyani |
| drawer cash-out/observation/adjustment/acknowledgement rows | required absent at both outlets for the frozen business date; no synthetic rows |
| inventory movements | required absent at both outlets for the frozen business date |

If repository inspection or the restored database finds another dependent
table, it must be added to the plan, backup and assertions before production.

### D7. Numbering preserves the original insertion point and remains monotonic

The final closed-hours `plan` requires Kalyani's counter and existing maximum to
be exactly 1024. It freezes two mappings by opaque bill ID: incident 742–778 to
990–1026 in `(paid_at, created_at, id)` order, and later Kalyani 990–1024 to
1027–1061 in existing number order. `apply` locks both bill graphs, their command
rows and the counter, reruns the complete plan, stages affected numbers in a
reserved collision-free range inside the transaction, writes both final
mappings and sets the counter to 1061. It never voids, replaces or deletes a
bill. Preserve incident order numbers 1–39 because Kalyani has no orders on that
business date and those numbers do not collide.

After apply:

- Kalyani bill high-water is 1061 and order high-water for 2026-09-16 is 39.
- Kanchrapara bill high-water remains 778 and its 2026-09-16 order high-water
  remains 39, even though the moved rows no longer occupy those numbers.
- A failed transaction consumes nothing.
- A post-commit reversal does not lower either high-water mark. Kalyani keeps a
  37-number gap (1025–1061) because reusing numbers that existed, even briefly,
  is worse than a visible gap.

### D8. One transaction, narrow locks, and no global trigger bypass

`apply` takes a transaction-scoped advisory lock, write-blocking table locks on
both bill graphs and their mutable dependencies, plus `FOR UPDATE` locks on both
devices/shifts, affected parent rows, source/target counter rows and destination
menu rows. Reads remain available. It sets a short lock timeout, requires the
later Kalyani device to have no live shift or pending request, and aborts rather
than waiting through unexpected activity.

Before implementing updates, the separate session must inventory the exact
immutable triggers and non-deferrable cross-outlet foreign keys on the restored
schema. The transaction may make a named foreign key temporarily deferrable and
may disable only named immutable triggers on the exact affected tables. It must
not set a session-wide replication role and must not drop RLS or grants.

DDL in PostgreSQL is transactional. Every altered constraint/trigger is restored
to its captured definition before final assertions. The transaction queries the
catalog to prove all guards are enabled and definitions match their before-image
before commit. Any mismatch raises and rolls back the whole operation.

### D9. The incident tool closes the shift and rehomes the offline tablet

The stale incident shift is closed inside the transaction. If apply occurs
before its stored expiry, `ended_at` is the transaction time; if after expiry,
it is capped at the stored expiry rather than inventing authority beyond it.
The end reason uses the existing deliberate day-finish value. No end-of-day
confirmation is fabricated.

The operator already has active Biller assignments at both outlets in the
proposal baseline. Apply asserts this and inserts nothing. If that changes, the
run stops for review instead of silently changing human authority.

The same locked transaction repairs the historical graph and changes the
device's current outlet to Kalyani and label to **Kalyani Counter 2**, provided a
fresh target-label uniqueness check passes. It preserves the device/Auth UUID,
`session_proven_at`, setup attribution, removal state and browser credentials.
The targeted before-image and compensating reversal include the device row.

This incident-specific device mutation does not call the normal Edit RPC. The
normal product path correctly demands a fresh zero-unresolved heartbeat because
it cannot otherwise know what an arbitrary tablet holds in IndexedDB. During
this repair the tablet is known to be powered off and unavailable. The stronger
incident fingerprint instead requires all of the following before apply:

- the stored last report says zero unresolved work;
- that report is later than the latest server-accepted command and synced bill;
- the complete 115-command/39-order/37-bill graph reconciles exactly;
- no pending shift request or later server-side device work exists; and
- the owner confirms the counter has remained closed and the device unused
  since that report.

That final point is an explicit operational assertion, not something the
database can prove. The proposal does not mislabel stale telemetry as fresh.
Any mismatch stops the whole transaction. A fresh-connection postflight then
verifies both repaired history and the new device row from the maintenance
laptop; no tablet connection is attempted overnight.

### D10. Rehoming creates a durable tenancy obligation

Current policy branches that admit `device_id = auth.uid()` assume current and
historical outlet are identical. After transfer that branch can expose former
Kanchrapara orders or command receipts to a Kalyani session. The ordinary UI
does not request those rows, but the database boundary must still refuse them.

The policy migration intersects device-owned rows with the current device
outlet and retains existing live-shift requirements. At minimum the
implementation reviews and tests `orders`, `billing_commands`,
`billing_end_of_day_confirmations`, `counter_shift_requests`, `counter_shifts`
and legacy `shifts`; child policies inherit the corrected parent only where that
inheritance is proved. Personal-account and owner/manager branches retain their
existing authority.

This migration lands before transfer. Its tests create a device with history at
outlet A, transfer it to B, and prove that a B shift sees B and cannot read A by
direct REST/database request; with no shift it reaches neither.

### D11. Verification is intentionally repetitive

There are seven distinct checks because they catch different failures:

1. **Plan check:** read-only fingerprint before any write.
2. **In-transaction check:** exact graph, totals, constraints, triggers and
   counters before commit.
3. **First postflight:** a fresh connection repeats every aggregate,
   foreign-key/orphan, device-row and catalog check after the atomic repair.
4. **Device-row postflight:** a separate connection verifies the exact target
   name/outlet and unchanged Auth/device/session identity. The hosted owner UI
   may confirm card regrouping from the laptop, but it is not required for the
   database gate.
5. **Independent complete postflight:** a separate invocation verifies database
   aggregates, receipt resolution without printing tokens, and policy/catalog
   state. Device-session behavior remains proven by automated/rehearsal tests
   until the physical tablet next starts.
6. **First-use check:** at the next opening, the physical tablet comes online,
   shows Kalyani, requests no setup, opens a normal Kalyani shift, and its first
   genuine sale receives the next Kalyani number.
7. **Next-day check:** owner reports, ledger, drawer expectation and expense
   totals agree after the business day has rolled.

Passing an earlier check never waives a later one. Evidence records the command,
time, commit/version, aggregate result and reviewer, never PII.

### D12. Rollback has an explicit point of no return

Before commit, rollback is complete and automatic.

After commit but before a new shift, `rollback` restores the captured device
name/outlet together with historical attribution, original bill/order numbers,
menu references, command results, shift state and expenses from the targeted
bundle. It first proves that no affected row changed and neither outlet accepted
later work that collides. It leaves issued-number high-water marks at their
maximum observed values. No outlet tablet or admin UI is required to reverse.

Once the transferred tablet opens a new Kalyani shift or either outlet records
dependent later work, automatic reversal refuses. Recovery is then a new
forward repair designed from the actual state. A full-database restore is only
for catastrophic recovery during the closed maintenance window because it
would discard every later write.

The first genuine Kalyani bill is therefore the operational close of the quick
rollback window. The owner must know this before reopening the counter.

### D13. Edit exposes exactly the safe device mutation already needed here

The existing database already contains a service-only
`rename_counter_device(...)` function, but neither the Edge Function,
`CounterAdapter` nor Tablets surface exposes it. Name editing is therefore a
small wiring change. Outlet editing is the durable normal-admin operation
designed alongside the one-time incident repair; it never invokes the historical
repair.

Replace or wrap the rename function with one atomic edit boundary accepting
device ID, trimmed label and target outlet. The function re-derives the caller's
authority from the authenticated human resolved by the Edge Function. It locks
the device and rechecks every precondition in the same transaction that writes
the row, so a heartbeat, shift request or label collision cannot race the UI.
The Edge Function passes the verified caller identity; no body-supplied actor or
role is trusted.

Authority is asymmetric by design:

- a Super Admin may change name, outlet, or both for any active tablet;
- a Franchise Admin may change only the name of a tablet currently at an outlet
  they actively manage;
- no tablet session, Biller or Employee may edit either field.

A name-only edit keeps the current outlet and may succeed during a live shift,
matching the rename capability already present. An outlet change requires the
strict transfer preconditions and a fresh zero heartbeat. If name and outlet are
submitted together, they succeed or fail together. A no-change submission is a
successful no-op.

The Tablets card receives a named **Edit <tablet>** action. Its sheet is
prefilled, uses the same outlet list/scope already loaded by the surface, and
shows the outlet as fixed for a Franchise Admin. A Super Admin changing outlet
must confirm a sentence naming source, destination and the fact that the tablet
must reconnect online before its next shift. Busy/refusal states keep the sheet
open with actionable copy: finish the shift, resolve/cancel the pending request,
bring the tablet online until it reports zero, or choose a different label.

The card list refreshes after success; a moved tablet disappears from the source
group and appears under the target if that outlet is in scope. Demo adapters and
fixtures implement the same authority and preconditions. Because the card gains
an action and the surface gains a sheet, its loading placeholder is inspected
and reshaped if necessary in the same change.

Edit is not the incident repair. It changes current assignment and intentionally
leaves historical rows alone. Its complete behavior is exercised against the
restored snapshot and automated environments. Production incident execution
uses D9's exact-fingerprint operator transaction because the real tablet and its
fresh heartbeat are unavailable overnight.

### D14. The 03:00–04:00 IST run is a cutover, not an implementation session

The production operator may begin after the final counter closes at roughly
03:00 or 04:00 **Asia/Kolkata**. By then the implementation commit, migration,
Edge action and UI must already be reviewed, fully verified and deployed. The
full production snapshot must already have been restored and queried in
scratch, and the complete apply/UI-transfer/rollback/reapply rehearsal and
failure injection must already be green. Starting any of that work after the
counters close makes the window unpredictable and is a stop condition.

The only required online client is the maintenance laptop. It must have the
reviewed tool commit, production credentials, network access to Supabase, and
access to the external backup destination. The production database/API/Auth and
any Edge Function used by the tool must be healthy. GitHub, the deployment
control plane and the hosted frontend are pre-window dependencies only; the
core night-of mutation does not fail merely because one of them is unavailable
after the release is already deployed. Every outlet tablet, phone, printer and
outlet network is assumed off or unreachable.

The night-of critical path is deliberately short:

1. Declare the freeze after the last accepted counter command and confirm both
   outlets are closed.
2. Run a fresh read-only plan using the literal business date `2026-09-16`.
3. Capture/checksum the targeted before-image and prove it matches that plan.
4. Apply the one locked historical-and-device transaction.
5. Run two fresh-process database postflights, including exact device identity,
   target outlet/name, policies, receipts, counts, totals and counters.
6. Optionally read the owner UI from the laptop; do not make it a substitute for
   database verification or a requirement for completing the cutover.

The outlet business-day boundary is 04:00 IST, so execution may cross it. That
does not change scope: the operator tool never asks for the current business
day, never derives a date from `created_at`, and never adopts a new target
high-water mark after plan approval. If apply runs before the incident shift's
stored expiry, D9 closes it at transaction time; if apply runs after expiry, D9
caps `ended_at` at that stored expiry. Both paths are rehearsed.

No test sale is manufactured at night. The first real customer sale after
opening performs the first-use check and must receive Kalyani number 1062, one
above the repaired high-water recorded by the committed plan. The change remains
under observation until the later next-day check, but that deferred verification
does not require the maintenance window to stay open.

If a required live precondition fails, the operator follows the nearest safe
stop rather than debugging new code in production. Before apply, nothing has
changed. After apply, history and device change together or neither changes.
Before a new shift, D12's database-only targeted rollback remains available.
The physical session/menu proof is deliberately deferred until the tablet next
comes online; it must happen before the first shift opens. The hard deadline is
the next counter opening, not 04:00 itself.

## 4. Production execution order

```text
BEFORE THE NIGHT-OF WINDOW
implementation/review/full gates/deploy
        │
        ▼
full dump ── restore ── rehearsal apply/verify/rollback
        │                         │
        └────────────── only if all pass
                                  ▼
connected maintenance laptop + credentials/backup destination ready
                                  ▼
03:00–04:00 IST START, AFTER BOTH OUTLETS CLOSE
owner go-ahead ── freeze ── literal business_date 2026-09-16
                                  ▼
fresh plan ── targeted before-image ── plan digest approval
                                  ▼
locked atomic apply
  close/reclassify shift
  move orders/items/discount-free graph
  stage/shift later Kalyani bills 990–1024 to 1027–1061
  move incident bills/items/payments to 990–1026
  rewrite both command-number sets
  move five expenses
  rehome/rename existing device without changing its identity/session
  restore every guard and assert totals
                                  ▼
two independent database postflights ── night-of cutover complete
                                  ▼
NEXT OPENING: tablet online/session/menu proof, then first genuine
Kalyani shift/bill 1062
                                  ▼
next-day reconciliation ── retire targeted recovery bundle
```

## 5. Risks and controls

- **Live drift or a late offline upload:** exact digest, stored zero report after
  the latest accepted command/bill, owner-confirmed device non-use, closed
  window, row locks and abort-on-difference. Stale telemetry is recorded as an
  operational assumption, never presented as fresh proof.
- **Partial graph moved:** dependency inventory, full before-image, FK/orphan
  assertions and independent postflight.
- **Money changed accidentally:** per-bill and aggregate paise hashes over every
  amount/tender field before and after.
- **Wrong menu semantics:** active/available same-price destination required;
  explicit owner-approved aliases; 100% item coverage.
- **Trigger left disabled:** capture definitions, transactional DDL, catalog
  equality assertion before commit, fresh-connection assertion after commit.
- **Bill-number collision or reuse:** both exact mappings and the 1024 input
  high-water are sealed, a reserved temporary range makes update ordering safe,
  the digest refuses post-plan drift, and post-commit counters are never lowered.
- **Old outlet exposed after device transfer:** current-outlet RLS intersection
  and direct cross-outlet tests before rehome.
- **Wrong hardware moved:** the incident plan fingerprints one exact device and
  its identity hashes; the future UI uses a named Edit action, prefilled fields,
  source/destination confirmation and atomic database preconditions.
- **Cached Kanchrapara menu used tomorrow:** first reopening online; no shift
  opened until Kalyani menu/outlet context is confirmed.
- **Recovery artifacts leak sensitive data:** outside-repo path, restrictive ACL,
  encryption where the established snapshot process provides it, hashes only in
  Git, explicit destruction after acceptance.

## 6. Open questions

None are allowed to remain open at apply. The owner has decided the physical
outlet, the two menu aliases, inclusion of the same-shift expenses, preservation
of the tablet session, continued Biller authority at both outlets, and absence
of application-visible correction rows. The owner has also chosen the bounded
Edit surface: name and outlet only, with cross-outlet moves reserved to Super
Admin. Any production drift that changes one of those premises reopens design
rather than being guessed by the operator.
