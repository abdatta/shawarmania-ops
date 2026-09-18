> **Active checkpoint — 2026-09-18 after first real use:** 70 of 75 tasks
> are complete. A fresh 03:15 IST read proved both repaired business dates and
> every effective payment allocation reconcile, and explained the live ₹200:
> ₹5,200 was physically counted, ₹5,000 was collected from that observation,
> and no cash bill or cash expense followed it. The same read also proved the
> observation's stored historical variance is stale: reattribution adds ₹2,130
> cash and ₹380 cash expenses to its already-counted interval, so expected cash
> must rise by ₹1,750 and the count must read ₹1,770 short rather than ₹20 short.
> Task 7.4 is reopened. Tasks 7.11–7.16 now track the finance-wide proof, the
> backed-up observation correction, and effective-dated tablet identity so old
> bills retain the tablet name effective when they were paid.
> The temporal schema, bounded label reader, live and demo adapters, indexed
> lookup coverage and finance/history follow-up operator are now implemented
> locally. The restored-production rehearsal passed plan, capture, atomic apply,
> verify, rollback, re-apply and re-verify with expected 697,000 paise,
> difference -177,000 paise and two device-identity intervals. Production has
> not received this follow-up yet; tasks 7.12, 7.14 and 7.16 therefore remain
> open until deployment/backfill and the subsequent production proof. A focused demo
> test now also proves a rename creates exactly one new identity interval, leaves
> an existing bill on its old label and treats an unchanged save as a no-op. A
> newly restored production clone also passed scratch-only failures after each
> follow-up mutation group; both rolled back to the same captured digest before
> a normal re-apply/re-verify reproduced every frozen finance figure and all 778
> pre-boundary historical labels. Review aligned the secured label batch with
> PostgREST's 1,000-row page ceiling (and refuses 1,001); a fresh reset applied
> that migration and its focused database suite passes 51 assertions, including
> proof that the stable device UUID cannot ask the label function about its
> former outlet. The
> post-review format, TypeScript, Edge-function type, lint and full unit gates
> are green (143 files / 1,765 tests; 14 pre-existing lint warnings, no errors),
> as are the 274 browser tests. A final mock-parity review fixed live-shift
> cards to use the newly edited current tablet name while old bills remain on
> their effective historical name; the focused adapter/mock suite passes 39
> tests, and the final rebuilt browser suite again passes all 274. Roadmap sync
> changed zero rows; diff/BOM and sensitive-artifact scans are clean. A fresh
> post-cutover production snapshot was checksummed and restored, then exposed
> and fixed rollback timestamp drift. The hardened operator now freezes each
> drawer component and exact locked before-image; its final restored-production
> failure/apply/verify/rollback/re-apply/re-verify matrix passes, including 778
> historical bills and 829 historical orders. The final post-hardening lint,
> format, type/function type, unit (143 files / 1,765 tests), contrast (52 pairs)
> and production-build gates are green. A fresh 05:14 IST read-only production
> verify still matches the committed cutover digest and every stable graph hash,
> with counters 778/1061, zero live shifts and zero pending unexpired shift
> requests. A final fresh local reset after the IST date-boundary window passed
> all 59 database files / 2,365 assertions, all six RLS/realtime/race groups /
> 251 assertions, and all 28 authenticated browser cases; regenerated database
> types were byte-identical to the reviewed working copy. No follow-up production
> migration or data write has occurred. After the operator's final rollback-lock
> hardening, a newly restored production clone again passed plan, fresh capture,
> apply, verify, rollback, re-apply and re-verify: the exact finance figures,
> two identity intervals, 778 historical bills and 829 historical orders all
> matched. Only the disposable clone was mutated.
> The final repository rerun also passed format, lint, app/Edge types, contrast,
> production build, roadmap reconciliation and strict OpenSpec validation. One
> unrelated row-actions unit case missed its synthetic menu click in the first
> parallel run; it passed immediately in isolation (4/4) and the complete rerun
> then passed all 143 files / 1,765 tests.
> Commit `f402c5f082534a054900471e87e46abaa6030f2d` deployed through green
> verification, migration, Edge Function and frontend jobs. A fresh restricted
> production before-image was captured outside Git with checksum
> `81c8f2e075dfbbc3bd3eef8f2684dbfa698b1ffe9b56c55d3d32fde038b5c515`.
> One guarded follow-up transaction committed, and fresh-process verification
> plus a separate read-only SQL audit both passed. The latest Kalyani observation
> now retains counted 520,000 and collected 500,000 paise while expected is
> 697,000, difference is -177,000 and the live drawer remains 20,000 paise.
> Counters remain Kalyani 1061 / Kanchrapara 778; the 37 incident and 35 later
> bills exactly match their bill/payment and Cash/UPI totals with zero mismatches;
> five incident expenses total 38,000 paise. The transferred tablet has one old
> Kanchrapara and one current Kalyani interval with no overlap, resolving 778 old
> bills and 829 old orders to the former label. The current device is active at
> Kalyani, with zero live shifts and zero pending unexpired requests. Tasks 7.4,
> 7.12, 7.14 and 7.16 are now complete; physical first-start/use and next-day
> acceptance deliberately remain open.
> The owner then identified that the first history split used the repair/capture
> instant, causing the 37 incident bills to retain the former tablet label. Tasks
> 7.14 and 7.16 are reopened. A production read-only timeline proves a safe,
> business-semantic replacement boundary at the 2026-09-16 04:00 IST cutover:
> the last prior Kanchrapara event was 2026-09-15 22:26:27.526 IST, the Kalyani
> incident shift opened at 2026-09-16 12:32:03.552 IST, and zero device events
> occurred between cutover and that shift. The next operator will change only
> the two history interval endpoints; bills, orders, finance and current device
> authority remain untouched. A fresh restored-production clone has passed the
> dedicated operator's plan, external capture, apply, verify, exact rollback,
> re-apply and re-verify sequence. It partitioned historical labels as intended:
> 741 bills / 790 orders retain `Kanchrapara`, while all 37 incident bills / 39
> incident orders resolve to `Kalyani Counter 2`; every frozen money figure and
> both bill counters remained unchanged.
> Commit `f57671513a35149100dfc625f71c7cba63db34ec` passed the complete deploy
> workflow. The final restricted production boundary before-image has checksum
> `dc59aa65a02758c56f112788ca3eef1a8ae62344e183283240ef099d26d88844`.
> One guarded production transaction moved the contiguous boundary to exactly
> 2026-09-16 04:00 IST. Fresh-process verification and an independent read-only
> audit agree: 741 bills / 790 orders before cutover retain `Kanchrapara`; all 37
> incident bills / 39 incident orders resolve to `Kalyani Counter 2`; overlap is
> zero. Incident bills/payments remain 906,000 paise (213,000 Cash / 693,000 UPI)
> with zero mismatches, the Kalyani counter remains 1061, the current tablet is
> active at Kalyani and no device shift is live. Tasks 7.14 and 7.16 are complete
> again; physical first-start/use and next-day acceptance remain open.
> At 21:01 IST the same proven tablet was active and freshly seen at Kalyani with
> zero reported unsent or oldest-unresolved work. Its normal Kalyani shift opened
> at 16:51 IST without setup. The first genuine bill was exactly 1062; by the
> read-only checkpoint it had produced 33 settled bills numbered 1062–1094, 42
> orders and 113 commands, all at Kalyani. Bills and effective payments both
> totalled 771,000 paise (130,000 Cash / 641,000 UPI); historical-label,
> menu-outlet, bill/payment and delayed-wrong-outlet mismatches were all zero.
> The secured owner drawer reader reconciled 130,000 paise of new Cash receipts
> and 15,000 paise of new Cash expenses against the retained 20,000 paise,
> yielding 135,000 paise expected. Tasks 7.7 and 7.8 are complete; task 7.9 must
> wait until the next 04:00 IST business-date rollover.
>
> The owner confirmed both shops were physically closed and has
> frozen a revised numbering decision: preserve the original Kalyani insertion
> point by moving incident bills 742–778 to 990–1026, then shift every genuine
> later Kalyani bill 990–1024 upward intact to 1027–1061. No settled bill is
> voided, replaced or deleted; the 35 later bill IDs and their money, children,
> payment correction, public links and business date remain unchanged. The
> Kalyani counter becomes 1061 and its next genuine bill will be 1062. Read-only
> production inspection found the later block contiguous, settled and unvoided:
> 35 bills / 753,000 paise / 40 items / 37 payments / 35 public links / one
> payment correction and allocation / 36 bill-bearing command results. Both
> tablets report zero unresolved work after their latest server work. The
> Kalyani database shift remains live until its stored 04:00 IST expiry, so the
> final preflight will recheck it and all counters immediately before apply.
> A fresh three-part production backup dated 2026-09-18 has been checksummed and
> the full dump restored successfully into an isolated scratch database. Tasks
> 3.5–3.8 and 4.1–4.8 are reopened until the amended atomic operator, rollback,
> clone-per-case rehearsal and separate review pass again.
> The amended clone-per-case rehearsal has now passed exact apply, fresh-process
> verify, database-only rollback, both incident-shift cutoff branches, active
> later-shift refusal, next-opening bill 1062, all fourteen mutation failure
> points, and every frozen count/money/menu/telemetry/assignment/correction,
> digest, lock and unsafe-rollback refusal. Tasks 3.5–3.8 and 4.1–4.6 are green
> again; 4.7–4.8 remain open for the separate amended review.
> The separate amended review then found and fixed collision-safe rollback
> staging and overly broad command-result hash exclusions. A newly generated
> bundle passed the complete matrix again, so 4.7–4.8 and 4A.2 are now green.
> Commit `ca93b39c247d96df2aa4457f6b24968922e8d626` pins the reviewed
> operator. At 01:45 IST, the owner-confirmed closed Kalyani counter still had
> one database-live shift; a locked call to the existing `end_counter_shift`
> function closed it only after rechecking zero open orders, zero pending
> requests, zero reported unsent work and a zero report after latest server
> work. The subsequent production plan exactly matched reviewed digest
> `2ddd9538e42cb0141885db927d471a6d74ecc58a6654ac4622db9f954ba4b5a2`.
> The final production bundle checksum is
> `69108a1995fc35bc934bf661e57c3f4147beee63403789eabbca0771d56c7e07`.
> One production apply committed. Fresh operator verification and an independent
> direct query both passed: incident 37 bills / 906,000 paise, later 35 bills /
> 753,000 paise, Kalyani/Kanchrapara counters 1061/778, zero source incident
> rows, zero staging rows or command mismatches, 37/35 public links, zero
> incident corrections/reviews, zero live shifts, one rehomed device and zero
> disabled reviewed triggers. Night-of tasks 6.1–7.6 are complete; first-opening,
> first-use and next-day tasks remain deliberately pending.
>
> **Earlier deployed checkpoint — 2026-09-17 15:59 IST:** 42 of 69 tasks were
> complete under the superseded append-after-current numbering plan.
> The incident graph and device remain untouched. Commit
> `3dd514f81fc3c1a0dee03cae54f94fc7c5ec0b81` deployed successfully: every CI
> gate, production migration `20260917000000`, all Edge Functions and Pages are
> green. Post-deploy catalog, RLS and unauthenticated Edge probes passed from the
> connected maintenance laptop; the deployment pin and stop/rollback card are
> saved outside Git with the recovery artifacts. A fresh read-only production
> plan at 15:45 IST correctly stopped before producing a digest because Kalyani's
> bill counter is now 991 rather than the reviewed 989. Normal Kalyani bills 990
> and 991 were created at 15:26:53 and 15:27:15 IST for 39,000 paise total, and
> Kalyani currently has an open shift. The reviewed 990–1026 mapping is obsolete,
> so no live apply or targeted capture was attempted. The operator now derives
> the next 37 numbers from the final plan-time target high-water, seals that
> range into the digest/bundle and refuses later drift. A read-only production
> plan proved the unchanged incident graph and yielded 992–1028 from counter
> 991, but it was deliberately not captured as the final plan while Kalyani
> remained open. The restored-production harness now passes both the original
> 989 baseline and an advanced 991 high-water: the latter froze 992–1028 and its
> first subsequent real billing RPC received 1029. At the requested pause,
> production itself had continued normally through bill 994 at 15:55:02 IST;
> the active Kalyani tablet could see its correct outlet, one live shift, five
> current-day orders, sixteen commands and twenty-four available menu items.
> No production repair write, bundle capture, shift closure or tablet edit was
> attempted. The amended operator/docs remain local pending the reopened
> separate review, verification and commit-pin tasks.
> The original 989 restored-snapshot plan was re-read after the pause boundary
> and still matches digest
> `807fb5e9340120c114a98d2f947622ff48b64186ab2d159dfc3232647b1aa8e8`.
> Two fresh-restore scratch rehearsals proved plan/apply/fresh-process verify;
> the latest also proved database-only rollback against every targeted
> before-image row while retaining number high-water marks. Targeted UI/adapter
> tests pass (33 tests). The new database transfer/RLS test passes all 39
> assertions against a seeded restored schema and rolls its transaction back.
> A clean local `db:reset` applies the migration and seed successfully, and
> `test:db` passes 59 files / 2,344 assertions. The live local Edge/Auth path
> now passes 11 tests, including disposable-device setup, session proof,
> Franchise Admin rename/transfer refusal, Super Admin transfer, no-shift
> isolation and destination-shift/menu access without new setup; Edge Function
> type-checking is green. The production-schema dependency inventory now covers
> 34 relations plus all associated triggers, constraints, policies, indexes,
> views and functions. The expanded plan explicitly refuses drawer, inventory,
> legacy-shift, discount/correction/review/EOD and expense-aggregator drift. A
> version-2 external before-image passed apply, fresh-process verify and rollback
> against the restored production snapshot; an in-repository backup path was
> refused. Twelve scratch-only failure points—after guard disable, after every
> mutation group, before guard restoration and after guard restoration—each
> rolled back completely and reproduced the original plan digest. Tablet-edit
> defaults, focus, confirmation, actionable errors and regrouping pass component
> coverage; its phone/tablet light/dark browser matrix passes all four layout
> cases. The complete repository suite is green: 143 unit files / 1,764 tests,
> 274 browser tests, all static/type/function/build gates and 52 contrast pairs.
> A clone-per-case local harness
> also passes exact success plus count/money/cardinality, target trade/counter,
> menu, telemetry/server-work, assignment, discount/correction, lock, digest,
> project and unsafe-rollback refusals. A fresh full-dump clone now also
> rehearses the repaired tablet's next request/confirm shift path and real
> billing RPC: the first post-transfer bill landed at Kalyani as 1027 while
> Kanchrapara's high-water mark stayed 778. The harness now proves both stored
> cutoff branches: before expiry closes at transaction time, while at/after
> expiry caps the close at the stored expiry. Repository hygiene is green: the
> changed-file diff is clean, edited files have no BOM, no dump/before-image/
> reversal/token/credential/UUID list is tracked, and evidence/operator output
> contains aggregates and hashes only. The real local Edge/Auth rehearsal also
> passed 11 tests, including a disposable fresh-zero device edit/transfer,
> preserved session, regrouping, no-shift isolation and destination menu access.
> A separate artifact/schema review found and fixed the pre-expiry refusal and
> timestamp-canonicalization gaps, found no missing dependent relation, and
> reran the restored-snapshot matrix successfully. A final fresh local reset
> passes 59 database files / 2,344 assertions, the complete RLS/race/drawer/
> telemetry/ledger sequence and all 28 real-auth browser tests; regenerated
> types contain only the expected tablet-edit RPC. Roadmap reconciliation made
> zero changes. No incident production mutation has occurred; the reviewed app,
> migration and functions have deployed, while this later operator-only amendment
> remains local until its reopened review and verification tasks pass.

## 0. Freeze the incident definition

- [x] 0.1 Record the dated owner decision: the Kanchrapara-enrolled tablet was
  physically used at Kalyani on business date 2026-09-16; all trade from the
  identified device/shift that date, including the five same-operator expenses,
  belongs to Kalyani; the two named menu aliases are approved; the device shall
  remain usable at Kalyani without setup.
- [x] 0.2 Add `evidence/baseline.md` containing only the proposal's aggregate
  counts, paise totals, bill range, date and opaque row-set hashes. Verify it
  contains no UUIDs, customer facts, employee identity, receipt tokens or
  credentials.
- [x] 0.3 Inventory every table, view, trigger, constraint, policy, counter and
  function that references the incident device, shift, orders or bills on the
  current schema. Compare it with design D6 and amend the design/tasks before
  code if anything is missing.
- [x] 0.4 PHASE GATE — the incident has one written scope, all commercial facts
  and exclusions are explicit, and a second session can identify the intended
  graph without reading this conversation.

## 1. Prove the backups before building the repair

- [x] 1.1 Take a full logical production dump (schema, public data and Auth)
  under the established snapshot procedure, store it outside the repository
  with restrictive access, and record only its external path, timestamp, size
  and SHA-256 in `evidence/backup.md`.
- [x] 1.2 Restore that dump into an isolated scratch database. Verify schema
  version, incident aggregate fingerprint, source/target counters, device proof
  state, shift state, assignments and the 741 earlier Kanchrapara bills match
  production. A dump that has not restored cleanly blocks every later phase.
- [x] 1.3 Export a targeted before-image template covering every row and catalog
  object from task 0.3, plus stable row-set hashes and a generated compensating
  transaction. Verify the template writes outside the repository and refuses a
  path inside the workspace.
- [x] 1.4 Define recovery-artifact retention: keep the full snapshot under the
  normal backup policy; keep the targeted bundle through first-use and next-day
  acceptance; then securely remove the targeted sensitive data while retaining
  checksum/outcome evidence only.
- [x] 1.5 PHASE GATE — the full backup has been restored and queried, the targeted
  recovery shape is complete, and both can be located without exposing their
  contents in Git.

## 2. Make tablet transfer a safe database operation

- [x] 2.1 Add the `counter-device-sessions` delta: privileged transfer preserves
  machine identity/session, requires no live shift or pending request and recent
  zero-unresolved evidence, preserves historical row outlet, and makes future
  shifts use the target outlet. Include the Edit surface: Super Admin edits name
  and outlet; Franchise Admin edits name only at their managed outlet.
- [x] 2.2 Replace or wrap the existing service-only rename function with one
  atomic tablet-edit RPC. Trim/validate the name, enforce target-label
  uniqueness, re-derive active authority, reserve outlet changes to Super Admin,
  and lock/recheck live shift, pending request, telemetry freshness/unresolved
  count, device proof/removal state and target activity in the write transaction.
- [x] 2.3 Add a migration tightening every device-owned read made unsafe by
  transfer. Review at minimum `orders`, `billing_commands`,
  `billing_end_of_day_confirmations`, `counter_shift_requests`,
  `counter_shifts`, legacy `shifts`, and child-policy inheritance. Preserve
  existing personal-account and owner/manager authority.
- [x] 2.4 Expose one `edit` action through the `counter-devices` Edge Function.
  Derive the human caller from their bearer token, pass no body-supplied role or
  actor authority, classify each precondition/label refusal, and add the
  required function configuration/type checks.
- [x] 2.5 Extend `CounterAdapter` and both live/demo implementations with an
  atomic `editDevice({ deviceId, label, outletId })`. Preserve typed error copy,
  mock parity and the existing list/operational snapshot shapes.
- [x] 2.6 Add an **Edit** action to every administrable tablet card and a prefilled
  FormSheet with Name and Outlet. Let Super Admin choose an active outlet; show
  Franchise Admin the current outlet as fixed. Confirm outlet changes with
  tablet/source/target consequences; refresh grouping after success; keep the
  sheet open on actionable refusals; inspect and update the loading shape.
- [x] 2.7 Add database and real-HTTP RLS tests: device history at outlet A,
  transfer to B, no-shift reads nothing, B shift reads B, direct A reads and
  writes fail, prior A history remains available to authorised A managers, and
  the device's Auth UUID/session proof is unchanged.
- [x] 2.8 Add edit/precondition tests for name-only changes during a live shift,
  atomic name-plus-outlet success, no-change submission, Super Admin transfer,
  Franchise Admin rename, Franchise Admin transfer refusal, and refusal for live
  shift, pending request, stale heartbeat, nonzero unresolved work,
  removed/unproven device, inactive outlet and target-label collision. Every
  failure leaves both fields and history unchanged. Add component/browser
  coverage for sheet defaults, confirmation, errors, regrouping, focus and
  phone/tablet light/dark layouts.
- [x] 2.9 Update generated schema types and run the complete migration,
  `test:db`, `test:rls`, real-HTTP/auth and generated-type gates; RLS changes do
  not use the quickfix lane.
- [x] 2.10 PHASE GATE — an authorised admin edits the fields setup originally
  chose; name-only edits remain small, outlet moves are atomic and safely
  refused while busy, the same browser needs no setup, and a tablet can have
  historical rows at A and a current assignment at B without either outlet
  reaching the other's data.

## 3. Build the incident-specific operator tool

- [x] 3.1 Add a non-browser script with `plan`, `apply`, `verify` and `rollback`
  modes. Require explicit project/environment selection; refuse non-reviewed
  source/target/date values; never load a service-role credential into frontend
  code or print a secret.
- [x] 3.2 Make `plan` read-only and emit the exact D2 fingerprint, frozen bill
  number/menu mappings, reviewed source-to-target device name/outlet mutation,
  stored-zero telemetry ordering against the latest accepted command/bill, and
  SHA-256 digest. Make `verify` require the exact atomically repaired graph and
  target device row. Redact
  customer, employee, device, shift and receipt-link identifiers from console
  output and committed evidence.
- [x] 3.3 Make `apply` require the matching plan digest and confirmation phrase,
  acquire advisory/row locks with a short timeout, and rerun the entire plan
  inside its transaction before the first mutation.
- [x] 3.4 Inventory named immutable triggers and cross-outlet foreign keys from
  the live schema. Temporarily defer/disable only the exact named guards needed;
  never use global replication-role bypass; restore and catalog-compare every
  definition before commit.
- [x] 3.5 Implement the frozen graph repair: close/reclassify the incident shift;
  move 39 orders/45 items; move and renumber 37 bills/43 items/41 allocations;
  preserve their frozen Kalyani range 990–1026 by shifting the complete later
  Kalyani 2026-09-17 block from 990–1024 to 1027–1061 without changing bill IDs,
  status, void state, money, children, correction, public links or business date;
  rewrite matching later command result numbers and set high-water 1061;
  move 115 command receipts and rewrite only outlet-local result numbers; move
  five expenses; map all menu references/snapshots; update counters; and rehome
  and rename the existing device while preserving its UUID/session/setup facts.
  Leave public-link rows, attendance and prior Kanchrapara history untouched.
- [x] 3.6 Assert inside the transaction: exact row counts; per-row and aggregate
  money identity; 37/2 paid/cancelled order status; zero orphan/dependent drift;
  menu coverage and prices; receipt-token hash equality; source/target counters;
  unique numbers; device/shift/assignment state; all triggers/constraints/RLS
  enabled; the incident shift closed; the device assigned to the exact target
  name/outlet with identity/session unchanged; and zero application
  correction/audit rows created.
- [x] 3.7 Implement `rollback` from the targeted before-image. Refuse checksum
  mismatch, changed affected rows, later dependent work or number collisions;
  restore historical attribution, shift state and the captured device row where
  safe; never lower a committed high-water counter. The planned reversal is
  database-only and requires no outlet hardware or admin UI.
- [x] 3.8 Add local tests for exact success and every refusal: count/money drift,
  second device/shift/operator, target trade, target counter drift, missing or
  price-changed menu mapping, stored nonzero unresolved work, last report before
  the latest command/bill, later server-side device work, assignment drift,
  corrections or discounts appearing, lock contention, mid-transaction failure,
  guard-restore failure, wrong digest/project and unsafe rollback.
- [x] 3.9 Prove repository hygiene: no dump, before-image, token, UUID list,
  customer/employee fact or secret is tracked; source files are UTF-8 without
  BOM; logs contain aggregates and hashes only.
- [x] 3.10 PHASE GATE — the tool can do nothing without a matching fresh plan,
  every failure is all-or-nothing, and rollback is executable rather than prose.

## 4. Rehearse against restored production

- [x] 4.1 Run `plan` on the scratch restore and reproduce every reviewed baseline
  fact. Investigate any difference; do not tune expectations until the command
  turns green.
- [x] 4.2 Run `apply`, then a fresh-process `verify`. Prove Kalyani has 37 settled
  bills totalling 906,000 paise with 213,000 cash and 693,000 UPI; Kanchrapara
  has none of the incident rows; all IDs/timestamps/customer facts/tenders and
  receipt tokens hash identically; prior history is untouched; and the device is
  at the reviewed target name/outlet with its identity/session unchanged and no
  live shift.
- [x] 4.3 Against the restored environment through the real app/Edge/RPC path,
  independently exercise the normal Edit feature with a fresh zero heartbeat on
  a separate test device/state. Verify confirmation, grouped-card movement,
  preserved device session, target menu after refresh and no historical-row
  mutation. This tests the durable UI without putting it on the incident's
  production critical path.
- [x] 4.4 Run database-only `rollback` and compare the restored state with the
  task-1 targeted before-image. Verify the device row and historical graph are
  restored together and the only permitted post-commit difference is that
  issued number high-water marks are not lowered.
- [x] 4.5 Reset scratch from the full dump and repeat the atomic apply, then
  simulate the repaired production tablet's next online Kalyani startup/shift
  and genuine next bill. Verify the incident block is 990–1026, the complete
  later Kalyani block is 1027–1061, the next real bill is 1062, and Kanchrapara
  does not reuse 742–778.
- [x] 4.6 Inject a failure after each mutation group and before guard restoration.
  Verify every run rolls back completely and the next `plan` returns the
  original digest.
- [x] 4.7 Have a separate review pass compare proposal, design, dependency
  inventory, SQL, tests and reversal. Fix every unaccounted table or assumption,
  rerun 4.1–4.6, and record the evidence without PII.
- [x] 4.8 PHASE GATE — atomic history/device apply, independent verification,
  database-only rollback, re-apply, separate real UI-transfer coverage,
  first-next-bill and failure injection have all passed on a restored production
  snapshot.

## 4A. Prepare the closed-hours cutover before the live window

- [x] 4A.1 Finish review, every repository/database/RLS/auth/UI gate, production
  deployment and post-deploy policy probes before the maintenance night. Pin the
  reviewed application/tool commit and migration version in private operator
  evidence; do not build, patch or deploy during the live cutover.
- [x] 4A.2 Confirm the full snapshot has restored successfully and tasks 4.1–4.8
  are green before the counters close. Stage the exact `plan`, `apply`,
  `verify` and `rollback` commands without secrets in shell history or Git, and
  pre-create/permission the external targeted-backup destination.
- [x] 4A.3 Prepare the connected maintenance laptop with the reviewed local
  commit, production access, Supabase/API reachability and the external backup
  destination. Explicitly assume every outlet tablet, phone, printer and outlet
  network is off or unreachable; none may appear in the night-of critical path.
- [x] 4A.4 Rehearse both cutover-time branches: apply just before the incident
  shift's stored 04:00 IST expiry closes at transaction time; apply at/after the
  expiry caps `ended_at` at expiry. In both cases the literal incident business
  date remains `2026-09-16`, the plan-frozen mapping remains unchanged and no
  current-date or host-timezone value enters selection.
- [x] 4A.5 Print or save outside Git the stop/rollback decision card: pre-apply
  abort; transaction rollback on apply failure; database-only targeted reversal
  after commit; and no automatic rollback after a new shift/dependent work.
- [x] 4A.6 PHASE GATE — when the counters close, all code and infrastructure work
  is finished, the backups/rehearsal are proved, the maintenance laptop can
  reach every required hosted service, and the operator needs only execute the
  reviewed runbook without outlet hardware.

## 5. Final production preflight and freeze

- [x] 5.1 Begin the live window only after both counters have closed, ordinarily
  around 03:00–04:00 Asia/Kolkata. Obtain the owner's dated go-ahead, record the
  last accepted counter command, confirm nobody is using either billing surface,
  and record that the incident tablet has remained powered off/unused since its
  last stored zero report. Do not require contact with any outlet device.
- [x] 5.2 Confirm the tablet-edit/RLS migration, Edge action and UI are deployed,
  the production policy probes pass, and nobody uses the normal Edit flow for
  this incident; deployment itself moves no production device or historical row.
  If implementation, deploy, full-restore proof or rehearsal remains unfinished,
  cancel the live window rather than completing it under the freeze.
- [x] 5.3 Run a fresh production `plan`. Require the reviewed 37 bills, 906,000
  paise, 43/41 bill children, 39/45 order graph, 115 commands, five expenses,
  the exact later Kalyani 990–1024 block and dependencies, target high-water
  1024, the incident 990–1026 plus shifted-later 1027–1061 mappings, exact menu
  mapping, proven device,
  active assignments at both outlets, stored zero unresolved work, last report
  after the latest accepted command/synced bill, and no later server-side device
  work. Any drift stops the run and amends this change before execution. Pass
  the literal business date `2026-09-16`; reject `today`, an inferred date or a
  host-local date.
- [x] 5.4 Confirm there are still no payment corrections, discounts, attribution
  reviews, end-of-day confirmations, drawer observations/collections or
  inventory movements in the incident graph, and no surviving dependent table
  omitted from backup/apply.
- [x] 5.5 Take the final targeted before-image after the plan, checksum it, build
  its reversal, and run a read-only comparison proving its manifest equals the
  plan digest.
- [x] 5.6 PHASE GATE — production is frozen, policy-safe, backed up twice, and
  byte-for-byte represented by the reviewed plan that `apply` will require.
  Crossing 04:00 IST after this gate does not invalidate the plan or alter its
  date, number mapping or target high-water assertions.

## 6. Atomic historical and device production repair

- [x] 6.1 Run `apply` once with the reviewed plan digest. Capture start/end time,
  tool commit, transaction outcome and aggregate assertions in private operator
  output; never capture row payloads in Git evidence.
- [x] 6.2 Require every in-transaction assertion from task 3.6 and catalog equality
  for every temporarily changed guard before commit. On any failure, verify the
  transaction rolled back and stop; do not patch production manually between
  attempts.
- [x] 6.3 Record the committed number mapping hash and resulting counters as
  aggregate evidence. Confirm the device now has the reviewed target name/outlet
  with the same UUID/session and no live shift, and confirm no void, replacement,
  adjustment, attribution-review or application-audit row was created.
- [x] 6.4 PHASE GATE — one transaction committed the reviewed graph, or no
  transaction committed anything. There is no partially repaired state.

## 7. Verify the offline cutover, then verify the tablet at next opening

- [x] 7.1 **First database postflight:** run `verify` from a fresh process.
  Repeat all counts, totals, per-row money hashes, FK/orphan checks, counter
  checks, menu coverage, trigger/constraint state, receipt-token hash,
  assignment state and closed-shift state. Verify the device has the exact
  target name/outlet while its UUID, proof and setup facts are unchanged.
- [x] 7.2 **Independent database postflight:** from a separate process and fresh
  connection, prove Kalyani owns the 37 bills/39 orders/five expenses and
  Kanchrapara owns none of the incident graph; verify policies/catalog state,
  public-receipt resolution without printing tokens, counters and the device
  row. Do not require a tablet token or any outlet connection.
- [ ] 7.3 From the connected laptop, optionally open the deployed owner Tablets
  surface and confirm the read-only card is grouped under Kalyani as `Kalyani
  Counter 2`, with no duplicate/source card or setup code. If the hosted
  frontend is unavailable, record that UI observation as deferred; database
  postflights 7.1–7.2 remain the authoritative night-of gate.
- [x] 7.4 Compare Kalyani's derived sales/drawer figures and Kanchrapara's derived
  figures against hand-calculated 906,000 total, 213,000 cash, 693,000 UPI and
  38,000 cash expenses. Verify no drawer collection or inventory movement was
  invented. **Reopened after the live owner drawer showed only the latest
  observation's carried ₹200 and zero post-observation bills:** prove from
  timestamps and interval rules whether that is the correct continuous-drawer
  answer rather than treating the incident-day cash as a second receipt after it
  had already been counted.
- [x] 7.5 If any authoritative database check disagrees, run the rehearsed
  database-only targeted rollback before any counter reopens; never wait for an
  outlet device and never improvise a partial SQL fix. Not invoked: both
  authoritative postflights agreed.
- [x] 7.6 NIGHT-OF PHASE GATE — tasks 7.1, 7.2 and 7.4 are green, the historical
  graph and current device row are complete, no shift is open, and the counter
  is safe to remain powered off until normal opening. Keep the targeted recovery
  bundle and do not claim physical-session acceptance yet.
- [x] 7.7 **First-start check at the next real opening:** bring the physical
  tablet online before requesting a shift. Verify the same proven session loads
  the Kalyani device/outlet and Kalyani menu and asks for the normal shift
  handshake rather than setup. If it shows Kanchrapara, requests setup or reports
  unresolved local work, open no shift and escalate using the retained recovery
  evidence.
- [x] 7.8 **First-use check:** after 7.7 passes, open the normal shift and verify
  its outlet/device/operator attribution. Let the first genuine customer sale,
  not a manufactured night-of sale, prove the Kalyani bill number equals the
  committed plan's repaired target high-water plus one, with its order, payment
  and command receipt at Kalyani. The number is not a build-time constant.
  Record that this closes the automatic rollback window.
- [ ] 7.9 **Next-day check:** after business-date rollover, verify owner reports,
  Kalyani/Kanchrapara daily billing, drawer expectation, expenses and ledger all
  agree with the repaired day and the post-transfer sale; verify no delayed
  Kanchrapara command arrived from the tablet.
- [ ] 7.10 PHASE GATE — both night-of database postflights, next-opening
  same-session/menu verification, first-use and next-day checks all agree; every
  disagreement was resolved before the next checkpoint rather than waived by
  an earlier green check.

### 7A. Finance-wide reconciliation and historical tablet identity

- [x] 7.11 Inventory every production finance reader and stored attribution that
  can be affected by changing a bill, order, expense, payment or tablet outlet:
  daily sales, overview, ledger, drawer intervals/observations, public receipts,
  reconciliation and any cached/materialised summary. Record whether each derives
  from canonical rows or stores a value that must be repaired. Recorded in
  `evidence/finance-followup.md`; only one containing drawer observation stores
  an affected copied financial value.
- [x] 7.12 Run a read-only production reconciliation for both outlets across the
  incident interval, the later genuine Kalyani interval and the latest drawer
  observation. Prove bill/payment totals, payment-method splits, expenses,
  collections, expected drawer balance and observation difference agree at every
  layer; do not expose customer or device identifiers in evidence.
- [x] 7.13 Add temporal counter-device name/outlet history. An edit closes the
  current interval and opens the next one atomically, while historical bill and
  order readers resolve the tablet identity whose interval contained the event
  time. Do not copy a display name onto bills or rewrite prior history.
- [x] 7.14 Backfill the transferred tablet's pre-transfer Kanchrapara identity and
  post-transfer Kalyani identity from the retained before-image and committed
  cutover facts, and backfill every other existing tablet with a safe initial
  interval. Verify that old Kanchrapara bills regain the old tablet name while
  repaired incident bills and future Kalyani bills show the identity effective at
  their billing time.
- [x] 7.15 Index and explain the temporal lookup so history pages remain fast;
  cover boundary instants, rename-only edits, outlet transfers, repeated edits,
  tenancy and historical rendering in database and adapter tests.
- [x] 7.16 Re-run all money and tenancy gates plus production read-only finance
  reconciliation after deployment/backfill. Keep 7.10 and 8.6 open until both the
  finance-wide proof and historical-label proof are green.

## 8. Documentation, cleanup and final gate

- [x] 8.1 Update `docs/DATA_MODEL.md`, `docs/OPERATIONS.md`,
  `docs/SECURITY_AND_PRIVACY.md`, `docs/OFFLINE_AND_SYNC.md` and
  `docs/TESTING.md`, `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md` and
  `docs/DEMO_MODE.md` exactly as named in the proposal. Keep incident-specific
  counts/history in this change, not in the timeless docs.
- [x] 8.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`,
  `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`
  and `npm run test:e2e`; fix and repeat until green.
- [x] 8.3 On a fresh local database run `npm run db:start && npm run db:reset`,
  then `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`,
  `npm run db:types`, and verify the generated-type diff is expected/clean.
- [ ] 8.4 After task 7 passes, securely remove the targeted before-image and
  reversal under the task-1 retention decision. Keep the full snapshot under
  normal backup retention and retain only non-sensitive checksums/results in
  `evidence/`.
- [x] 8.5 Run `npm run roadmap:sync` and confirm this intentionally unlisted
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
