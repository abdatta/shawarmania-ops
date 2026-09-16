## 0. Freeze the incident definition

- [ ] 0.1 Record the dated owner decision: the Kanchrapara-enrolled tablet was
  physically used at Kalyani on business date 2026-09-16; all trade from the
  identified device/shift that date, including the five same-operator expenses,
  belongs to Kalyani; the two named menu aliases are approved; the device shall
  remain usable at Kalyani without setup.
- [ ] 0.2 Add `evidence/baseline.md` containing only the proposal's aggregate
  counts, paise totals, bill range, date and opaque row-set hashes. Verify it
  contains no UUIDs, customer facts, employee identity, receipt tokens or
  credentials.
- [ ] 0.3 Inventory every table, view, trigger, constraint, policy, counter and
  function that references the incident device, shift, orders or bills on the
  current schema. Compare it with design D6 and amend the design/tasks before
  code if anything is missing.
- [ ] 0.4 PHASE GATE — the incident has one written scope, all commercial facts
  and exclusions are explicit, and a second session can identify the intended
  graph without reading this conversation.

## 1. Prove the backups before building the repair

- [ ] 1.1 Take a full logical production dump (schema, public data and Auth)
  under the established snapshot procedure, store it outside the repository
  with restrictive access, and record only its external path, timestamp, size
  and SHA-256 in `evidence/backup.md`.
- [ ] 1.2 Restore that dump into an isolated scratch database. Verify schema
  version, incident aggregate fingerprint, source/target counters, device proof
  state, shift state, assignments and the 741 earlier Kanchrapara bills match
  production. A dump that has not restored cleanly blocks every later phase.
- [ ] 1.3 Export a targeted before-image template covering every row and catalog
  object from task 0.3, plus stable row-set hashes and a generated compensating
  transaction. Verify the template writes outside the repository and refuses a
  path inside the workspace.
- [ ] 1.4 Define recovery-artifact retention: keep the full snapshot under the
  normal backup policy; keep the targeted bundle through first-use and next-day
  acceptance; then securely remove the targeted sensitive data while retaining
  checksum/outcome evidence only.
- [ ] 1.5 PHASE GATE — the full backup has been restored and queried, the targeted
  recovery shape is complete, and both can be located without exposing their
  contents in Git.

## 2. Make tablet transfer a safe database operation

- [ ] 2.1 Add the `counter-device-sessions` delta: privileged transfer preserves
  machine identity/session, requires no live shift or pending request and recent
  zero-unresolved evidence, preserves historical row outlet, and makes future
  shifts use the target outlet. Include the Edit surface: Super Admin edits name
  and outlet; Franchise Admin edits name only at their managed outlet.
- [ ] 2.2 Replace or wrap the existing service-only rename function with one
  atomic tablet-edit RPC. Trim/validate the name, enforce target-label
  uniqueness, re-derive active authority, reserve outlet changes to Super Admin,
  and lock/recheck live shift, pending request, telemetry freshness/unresolved
  count, device proof/removal state and target activity in the write transaction.
- [ ] 2.3 Add a migration tightening every device-owned read made unsafe by
  transfer. Review at minimum `orders`, `billing_commands`,
  `billing_end_of_day_confirmations`, `counter_shift_requests`,
  `counter_shifts`, legacy `shifts`, and child-policy inheritance. Preserve
  existing personal-account and owner/manager authority.
- [ ] 2.4 Expose one `edit` action through the `counter-devices` Edge Function.
  Derive the human caller from their bearer token, pass no body-supplied role or
  actor authority, classify each precondition/label refusal, and add the
  required function configuration/type checks.
- [ ] 2.5 Extend `CounterAdapter` and both live/demo implementations with an
  atomic `editDevice({ deviceId, label, outletId })`. Preserve typed error copy,
  mock parity and the existing list/operational snapshot shapes.
- [ ] 2.6 Add an **Edit** action to every administrable tablet card and a prefilled
  FormSheet with Name and Outlet. Let Super Admin choose an active outlet; show
  Franchise Admin the current outlet as fixed. Confirm outlet changes with
  tablet/source/target consequences; refresh grouping after success; keep the
  sheet open on actionable refusals; inspect and update the loading shape.
- [ ] 2.7 Add database and real-HTTP RLS tests: device history at outlet A,
  transfer to B, no-shift reads nothing, B shift reads B, direct A reads and
  writes fail, prior A history remains available to authorised A managers, and
  the device's Auth UUID/session proof is unchanged.
- [ ] 2.8 Add edit/precondition tests for name-only changes during a live shift,
  atomic name-plus-outlet success, no-change submission, Super Admin transfer,
  Franchise Admin rename, Franchise Admin transfer refusal, and refusal for live
  shift, pending request, stale heartbeat, nonzero unresolved work,
  removed/unproven device, inactive outlet and target-label collision. Every
  failure leaves both fields and history unchanged. Add component/browser
  coverage for sheet defaults, confirmation, errors, regrouping, focus and
  phone/tablet light/dark layouts.
- [ ] 2.9 Update generated schema types and run the complete migration,
  `test:db`, `test:rls`, real-HTTP/auth and generated-type gates; RLS changes do
  not use the quickfix lane.
- [ ] 2.10 PHASE GATE — an authorised admin edits the fields setup originally
  chose; name-only edits remain small, outlet moves are atomic and safely
  refused while busy, the same browser needs no setup, and a tablet can have
  historical rows at A and a current assignment at B without either outlet
  reaching the other's data.

## 3. Build the incident-specific operator tool

- [ ] 3.1 Add a non-browser script with `plan`, `apply`, `verify` and `rollback`
  modes. Require explicit project/environment selection; refuse non-reviewed
  source/target/date values; never load a service-role credential into frontend
  code or print a secret.
- [ ] 3.2 Make `plan` read-only and emit the exact D2 fingerprint, frozen bill
  number/menu mappings, reviewed source-to-target device name/outlet mutation,
  stored-zero telemetry ordering against the latest accepted command/bill, and
  SHA-256 digest. Make `verify` require the exact atomically repaired graph and
  target device row. Redact
  customer, employee, device, shift and receipt-link identifiers from console
  output and committed evidence.
- [ ] 3.3 Make `apply` require the matching plan digest and confirmation phrase,
  acquire advisory/row locks with a short timeout, and rerun the entire plan
  inside its transaction before the first mutation.
- [ ] 3.4 Inventory named immutable triggers and cross-outlet foreign keys from
  the live schema. Temporarily defer/disable only the exact named guards needed;
  never use global replication-role bypass; restore and catalog-compare every
  definition before commit.
- [ ] 3.5 Implement the frozen graph repair: close/reclassify the incident shift;
  move 39 orders/45 items; move and renumber 37 bills/43 items/41 allocations;
  move 115 command receipts and rewrite only outlet-local result numbers; move
  five expenses; map all menu references/snapshots; update counters; and rehome
  and rename the existing device while preserving its UUID/session/setup facts.
  Leave public-link rows, attendance and prior Kanchrapara history untouched.
- [ ] 3.6 Assert inside the transaction: exact row counts; per-row and aggregate
  money identity; 37/2 paid/cancelled order status; zero orphan/dependent drift;
  menu coverage and prices; receipt-token hash equality; source/target counters;
  unique numbers; device/shift/assignment state; all triggers/constraints/RLS
  enabled; the incident shift closed; the device assigned to the exact target
  name/outlet with identity/session unchanged; and zero application
  correction/audit rows created.
- [ ] 3.7 Implement `rollback` from the targeted before-image. Refuse checksum
  mismatch, changed affected rows, later dependent work or number collisions;
  restore historical attribution, shift state and the captured device row where
  safe; never lower a committed high-water counter. The planned reversal is
  database-only and requires no outlet hardware or admin UI.
- [ ] 3.8 Add local tests for exact success and every refusal: count/money drift,
  second device/shift/operator, target trade, target counter drift, missing or
  price-changed menu mapping, stored nonzero unresolved work, last report before
  the latest command/bill, later server-side device work, assignment drift,
  corrections or discounts appearing, lock contention, mid-transaction failure,
  guard-restore failure, wrong digest/project and unsafe rollback.
- [ ] 3.9 Prove repository hygiene: no dump, before-image, token, UUID list,
  customer/employee fact or secret is tracked; source files are UTF-8 without
  BOM; logs contain aggregates and hashes only.
- [ ] 3.10 PHASE GATE — the tool can do nothing without a matching fresh plan,
  every failure is all-or-nothing, and rollback is executable rather than prose.

## 4. Rehearse against restored production

- [ ] 4.1 Run `plan` on the scratch restore and reproduce every reviewed baseline
  fact. Investigate any difference; do not tune expectations until the command
  turns green.
- [ ] 4.2 Run `apply`, then a fresh-process `verify`. Prove Kalyani has 37 settled
  bills totalling 906,000 paise with 213,000 cash and 693,000 UPI; Kanchrapara
  has none of the incident rows; all IDs/timestamps/customer facts/tenders and
  receipt tokens hash identically; prior history is untouched; and the device is
  at the reviewed target name/outlet with its identity/session unchanged and no
  live shift.
- [ ] 4.3 Against the restored environment through the real app/Edge/RPC path,
  independently exercise the normal Edit feature with a fresh zero heartbeat on
  a separate test device/state. Verify confirmation, grouped-card movement,
  preserved device session, target menu after refresh and no historical-row
  mutation. This tests the durable UI without putting it on the incident's
  production critical path.
- [ ] 4.4 Run database-only `rollback` and compare the restored state with the
  task-1 targeted before-image. Verify the device row and historical graph are
  restored together and the only permitted post-commit difference is that
  issued number high-water marks are not lowered.
- [ ] 4.5 Reset scratch from the full dump and repeat the atomic apply, then
  simulate the repaired production tablet's next online Kalyani startup/shift
  and genuine next bill, and verify it receives bill 1027 while Kanchrapara does
  not reuse 742–778.
- [ ] 4.6 Inject a failure after each mutation group and before guard restoration.
  Verify every run rolls back completely and the next `plan` returns the
  original digest.
- [ ] 4.7 Have a separate review pass compare proposal, design, dependency
  inventory, SQL, tests and reversal. Fix every unaccounted table or assumption,
  rerun 4.1–4.6, and record the evidence without PII.
- [ ] 4.8 PHASE GATE — atomic history/device apply, independent verification,
  database-only rollback, re-apply, separate real UI-transfer coverage,
  first-next-bill and failure injection have all passed on a restored production
  snapshot.

## 4A. Prepare the closed-hours cutover before the live window

- [ ] 4A.1 Finish review, every repository/database/RLS/auth/UI gate, production
  deployment and post-deploy policy probes before the maintenance night. Pin the
  reviewed application/tool commit and migration version in private operator
  evidence; do not build, patch or deploy during the live cutover.
- [ ] 4A.2 Confirm the full snapshot has restored successfully and tasks 4.1–4.8
  are green before the counters close. Stage the exact `plan`, `apply`,
  `verify` and `rollback` commands without secrets in shell history or Git, and
  pre-create/permission the external targeted-backup destination.
- [ ] 4A.3 Prepare the connected maintenance laptop with the reviewed local
  commit, production access, Supabase/API reachability and the external backup
  destination. Explicitly assume every outlet tablet, phone, printer and outlet
  network is off or unreachable; none may appear in the night-of critical path.
- [ ] 4A.4 Rehearse both cutover-time branches: apply just before the incident
  shift's stored 04:00 IST expiry closes at transaction time; apply at/after the
  expiry caps `ended_at` at expiry. In both cases the literal incident business
  date remains `2026-09-16`, the mapping remains 990–1026 and no current-date or
  host-timezone value enters selection.
- [ ] 4A.5 Print or save outside Git the stop/rollback decision card: pre-apply
  abort; transaction rollback on apply failure; database-only targeted reversal
  after commit; and no automatic rollback after a new shift/dependent work.
- [ ] 4A.6 PHASE GATE — when the counters close, all code and infrastructure work
  is finished, the backups/rehearsal are proved, the maintenance laptop can
  reach every required hosted service, and the operator needs only execute the
  reviewed runbook without outlet hardware.

## 5. Final production preflight and freeze

- [ ] 5.1 Begin the live window only after both counters have closed, ordinarily
  around 03:00–04:00 Asia/Kolkata. Obtain the owner's dated go-ahead, record the
  last accepted counter command, confirm nobody is using either billing surface,
  and record that the incident tablet has remained powered off/unused since its
  last stored zero report. Do not require contact with any outlet device.
- [ ] 5.2 Confirm the tablet-edit/RLS migration, Edge action and UI are deployed,
  the production policy probes pass, and nobody uses the normal Edit flow for
  this incident; deployment itself moves no production device or historical row.
  If implementation, deploy, full-restore proof or rehearsal remains unfinished,
  cancel the live window rather than completing it under the freeze.
- [ ] 5.3 Run a fresh production `plan`. Require the reviewed 37 bills, 906,000
  paise, 43/41 bill children, 39/45 order graph, 115 commands, five expenses,
  zero target-day trade, target high-water 989, exact menu mapping, proven device,
  active assignments at both outlets, stored zero unresolved work, last report
  after the latest accepted command/synced bill, and no later server-side device
  work. Any drift stops the run and amends this change before execution. Pass
  the literal business date `2026-09-16`; reject `today`, an inferred date or a
  host-local date.
- [ ] 5.4 Confirm there are still no payment corrections, discounts, attribution
  reviews, end-of-day confirmations, drawer observations/collections or
  inventory movements in the incident graph, and no surviving dependent table
  omitted from backup/apply.
- [ ] 5.5 Take the final targeted before-image after the plan, checksum it, build
  its reversal, and run a read-only comparison proving its manifest equals the
  plan digest.
- [ ] 5.6 PHASE GATE — production is frozen, policy-safe, backed up twice, and
  byte-for-byte represented by the reviewed plan that `apply` will require.
  Crossing 04:00 IST after this gate does not invalidate the plan or alter its
  date, number mapping or target high-water assertions.

## 6. Atomic historical and device production repair

- [ ] 6.1 Run `apply` once with the reviewed plan digest. Capture start/end time,
  tool commit, transaction outcome and aggregate assertions in private operator
  output; never capture row payloads in Git evidence.
- [ ] 6.2 Require every in-transaction assertion from task 3.6 and catalog equality
  for every temporarily changed guard before commit. On any failure, verify the
  transaction rolled back and stop; do not patch production manually between
  attempts.
- [ ] 6.3 Record the committed number mapping hash and resulting counters as
  aggregate evidence. Confirm the device now has the reviewed target name/outlet
  with the same UUID/session and no live shift, and confirm no void, replacement,
  adjustment, attribution-review or application-audit row was created.
- [ ] 6.4 PHASE GATE — one transaction committed the reviewed graph, or no
  transaction committed anything. There is no partially repaired state.

## 7. Verify the offline cutover, then verify the tablet at next opening

- [ ] 7.1 **First database postflight:** run `verify` from a fresh process.
  Repeat all counts, totals, per-row money hashes, FK/orphan checks, counter
  checks, menu coverage, trigger/constraint state, receipt-token hash,
  assignment state and closed-shift state. Verify the device has the exact
  target name/outlet while its UUID, proof and setup facts are unchanged.
- [ ] 7.2 **Independent database postflight:** from a separate process and fresh
  connection, prove Kalyani owns the 37 bills/39 orders/five expenses and
  Kanchrapara owns none of the incident graph; verify policies/catalog state,
  public-receipt resolution without printing tokens, counters and the device
  row. Do not require a tablet token or any outlet connection.
- [ ] 7.3 From the connected laptop, optionally open the deployed owner Tablets
  surface and confirm the read-only card is grouped under Kalyani as `Kalyani
  Counter 2`, with no duplicate/source card or setup code. If the hosted
  frontend is unavailable, record that UI observation as deferred; database
  postflights 7.1–7.2 remain the authoritative night-of gate.
- [ ] 7.4 Compare Kalyani's derived sales/drawer figures and Kanchrapara's derived
  figures against hand-calculated 906,000 total, 213,000 cash, 693,000 UPI and
  38,000 cash expenses. Verify no drawer collection or inventory movement was
  invented.
- [ ] 7.5 If any authoritative database check disagrees, run the rehearsed
  database-only targeted rollback before any counter reopens; never wait for an
  outlet device and never improvise a partial SQL fix.
- [ ] 7.6 NIGHT-OF PHASE GATE — tasks 7.1, 7.2 and 7.4 are green, the historical
  graph and current device row are complete, no shift is open, and the counter
  is safe to remain powered off until normal opening. Keep the targeted recovery
  bundle and do not claim physical-session acceptance yet.
- [ ] 7.7 **First-start check at the next real opening:** bring the physical
  tablet online before requesting a shift. Verify the same proven session loads
  the Kalyani device/outlet and Kalyani menu and asks for the normal shift
  handshake rather than setup. If it shows Kanchrapara, requests setup or reports
  unresolved local work, open no shift and escalate using the retained recovery
  evidence.
- [ ] 7.8 **First-use check:** after 7.7 passes, open the normal shift and verify
  its outlet/device/operator attribution. Let the first genuine customer sale,
  not a manufactured night-of sale, prove Kalyani bill number 1027 with its
  order, payment and command receipt at Kalyani. Record that this closes the
  automatic rollback window.
- [ ] 7.9 **Next-day check:** after business-date rollover, verify owner reports,
  Kalyani/Kanchrapara daily billing, drawer expectation, expenses and ledger all
  agree with the repaired day and the post-transfer sale; verify no delayed
  Kanchrapara command arrived from the tablet.
- [ ] 7.10 PHASE GATE — both night-of database postflights, next-opening
  same-session/menu verification, first-use and next-day checks all agree; every
  disagreement was resolved before the next checkpoint rather than waived by
  an earlier green check.

## 8. Documentation, cleanup and final gate

- [ ] 8.1 Update `docs/DATA_MODEL.md`, `docs/OPERATIONS.md`,
  `docs/SECURITY_AND_PRIVACY.md`, `docs/OFFLINE_AND_SYNC.md` and
  `docs/TESTING.md`, `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md` and
  `docs/DEMO_MODE.md` exactly as named in the proposal. Keep incident-specific
  counts/history in this change, not in the timeless docs.
- [ ] 8.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`,
  `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`
  and `npm run test:e2e`; fix and repeat until green.
- [ ] 8.3 On a fresh local database run `npm run db:start && npm run db:reset`,
  then `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`,
  `npm run db:types`, and verify the generated-type diff is expected/clean.
- [ ] 8.4 After task 7 passes, securely remove the targeted before-image and
  reversal under the task-1 retention decision. Keep the full snapshot under
  normal backup retention and retain only non-sensitive checksums/results in
  `evidence/`.
- [ ] 8.5 Run `npm run roadmap:sync` and confirm this intentionally unlisted
  incident change does not hand-edit or corrupt roadmap status.
- [ ] 8.6 PHASE GATE — the proposal Gate is proved literally: the 2026-09-16
  trade reads wholly at Kalyani with unchanged money and identities, prior
  Kanchrapara history is intact, no number was reused, no fictional correction
  trail exists, the tablet continues at Kalyani without setup, authorised admins
  can edit name/outlet with the agreed role split and safety refusals, database
  tenancy survives transfer, all seven verification layers passed, and recovery
  artifacts were retained and retired exactly as planned. Do not archive
  automatically; report every result and remaining external artifact to the
  owner first.
