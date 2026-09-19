# Tasks: Hyperpure Delivery Cutover

## 1. Establish the dated routing authority

- [x] 1.1 Add `supplier_delivery_routes` with `source_system`, explicit
  `effective_from date`, and `outlet_id`, keyed by source and effective start;
  document that the greatest start not later than an invoice date is the route.
- [x] 1.2 Seed Hyperpure's historical-default route from `0001-01-01` to
  Kanchrapara and its `2026-09-16` route to Kalyani using stable outlet
  identifiers, with assertions that each name/code resolves exactly once and
  the retained pre-books invoice resolves before its ledger-date fallback.
- [x] 1.3 Enable RLS and grants in the same migration: service-role writes,
  Super Admin reads, and no read or write for Franchise Admin, Biller, Employee
  or anonymous callers.
- [x] 1.4 Add the table to schema/RLS coverage enumeration and prove cross-outlet
  isolation with hand-crafted database requests.
- [x] 1.5 Keep `outlets.hyperpure_delivery` only as a rollout-compatibility
  marker, move its current value to Kalyani, and document it as non-authoritative.
- [x] 1.6 Regenerate `src/data-access/database.types.ts` from the reset schema.

## 2. Make routing per-order and database-owned

- [x] 2.1 Rewrite `ingest_supply_statement` to resolve each Hyperpure order's
  outlet from `source_system + invoice_date` inside the order loop.
- [x] 2.2 Verify every resolved outlet is in `p_permitted_outlets`; refuse the
  whole ingest atomically when any order resolves outside the caller's derived
  authority or no route exists.
- [x] 2.3 Continue accepting the version-1 top-level `outlet_id` during mixed
  deployment, but never use it as Hyperpure routing authority.
- [x] 2.4 Update the shared parser and Edge Function comments/types so
  `hyperpure_delivery` is no longer presented as authoritative; keep old and
  new deployments interoperable.
- [x] 2.5 pgTAP: one statement spanning 15/16 September writes its older orders
  to Kanchrapara and newer orders to Kalyani in one transaction.
- [x] 2.6 pgTAP: a forged top-level outlet cannot override the dated route, a
  manager missing either resolved outlet is refused, and the scheduled/owner
  authority covering both succeeds.
- [x] 2.7 Parser/Edge tests: scheduled bytes and a manual upload of the same
  cross-boundary file produce the same routed result.

## 3. Make Hyperpure source identity global

- [x] 3.1 Add a partial global unique index for every Hyperpure expense on
  `(source_system, source_ref)`, including withdrawn rows, while retaining the
  outlet-scoped index for sources whose references are not proved account-global.
- [x] 3.2 Change Hyperpure ingest conflict handling to the global key; update the
  one row's mutable statement facts but never silently change its outlet.
- [x] 3.3 Refuse an existing Hyperpure identity whose stored outlet disagrees
  with its dated route, naming an attribution conflict that requires an audited
  migration rather than inserting or moving it silently.
- [x] 3.4 pgTAP: replay all 28 overlapping days after the cutover and prove one
  row per order globally, unchanged pre-cutover outlet attribution, and no
  increase in total paise from duplication.
- [x] 3.5 pgTAP: two genuinely different Hyperpure order numbers with equal
  date and amount remain two purchases.

## 4. Correct the bounded production set exactly

- [x] 4.1 In the same forward migration, snapshot every unvoided Hyperpure row
  dated from `2026-09-16` that still belongs to Kanchrapara, including row ids,
  source refs, dates, amounts, count and total paise.
- [x] 4.2 Before changing anything, assert exactly one anchor row exists for
  `ZHPWB27-OR-0030242357`, at Kanchrapara, dated `2026-09-17`, for `110129`
  paise; assert no pre-cutover Hyperpure row is outside Kanchrapara and no
  post-cutover row is at an unexplained third outlet.
- [x] 4.3 Move the snapshotted set to Kalyani through a transaction-bounded
  migration-only bypass of the expense identity trigger; restore the trigger
  before commit.
- [x] 4.4 Assert afterwards that every snapshotted row retains its id, source
  ref, date, amount, shared marker and void state exactly once at Kalyani; count
  and total paise are unchanged; the anchor exists once globally; and no order
  dated through 15 September moved.
- [x] 4.5 Add a migration rehearsal fixture matching the production boundary;
  prove an unexpected anchor, amount, date, outlet, duplicate, row-count drift
  or paise drift aborts the migration without a partial correction.

## 5. Companion sync configuration, without authentication work

- [x] 5.1 In `abdatta/shawarmania-sync`, update documentation so
  `HYPERPURE_OPS_OUTLET_ID` is explicitly run-health attribution and not expense
  routing.
- [ ] 5.2 At rollout, change `HYPERPURE_OPS_OUTLET_ID` from Kanchrapara's Ops UUID
  to Kalyani's Ops UUID; retain historical run rows unchanged.
- [x] 5.3 Leave `HYPERPURE_DELIVERY_OUTLET_ID=1719650`, the Zomato picker card,
  stored credentials, capture workflow, login workflow and OTP mailbox code
  byte-for-byte unchanged.
- [x] 5.4 Add or retain source-contract tests proving an ordinary Hyperpure read
  and `rehearse=true` load the stored session directly and cannot dispatch
  `login.yml`, open a code request or submit an OTP.

## 6. Docs and durable contract

- [x] 6.1 Update `docs/DATA_MODEL.md` with dated supplier routes, global
  Hyperpure identity, the attribution-conflict rule and the compatibility marker.
- [x] 6.2 Update `docs/OPERATIONS.md` with the cutover procedure, safe deployment
  order, no-OTP verification boundary and run-health variable.
- [x] 6.3 Update `docs/BUSINESS_CONTEXT.md`: physical Hyperpure deliveries are
  Kanchrapara through 15 September 2026 and Kalyani from 16 September 2026.
- [ ] 6.4 Merge the delta into `openspec/specs/supply-statements/spec.md` only at
  archive time.

## 7. Verification and production rollout

- [x] 7.1 Before code changes, capture the production baseline by source ref,
  outlet, invoice/business date and paise; record that the 17 September order
  was the only post-cutover row requiring correction at proposal time, while
  treating every later arrival before deploy as part of the bounded correction.
- [ ] 7.2 Run the repository suite from `.github/workflows/verify.yml`:
  `lint`, `format:check`, `typecheck`, `functions:typecheck`, unit tests,
  contrast and build, followed by `test:e2e`.
- [x] 7.3 Because this changes a table, RLS, migration and money attribution,
  run the full Docker gate in CI order on a fresh stack: `db:start`, `db:reset`,
  `test:db`, `test:rls`, `test:e2e:auth`, regenerate types, and require a clean
  generated-type diff.
- [x] 7.4 Run the companion sync repo's Hyperpure, session, workflow, format and
  static checks. Do not invoke `login.yml` or any OTP path.
- [ ] 7.5 Pause only `hyperpure.yml`, deploy the migration and compatible Edge
  changes, then change only the health-attribution variable.
- [ ] 7.6 Dispatch `hyperpure.yml` with `rehearse=true`; if the stored session is
  unavailable or lapsed, stop and report the blocker without reconnecting.
- [ ] 7.7 Dispatch one ordinary Hyperpure read, then prove in production:
  through 15 September remains Kanchrapara; from 16 September is Kalyani; order
  `ZHPWB27-OR-0030242357` exists once at Kalyani for 110,129 paise; every
  Hyperpure source ref is globally unique; and the overlapping replay did not
  change the all-time paise total except for later genuine orders.
- [ ] 7.8 Resume `hyperpure.yml`. Record the rehearsal, live-run URL and
  read-only database evidence. No OTP or re-login is an allowed verification
  dependency.

## 8. PHASE GATE

- [ ] 8.1 **Gate (`hyperpure-delivery-cutover`):** every Hyperpure order invoiced
  through 15 September 2026 remains booked once at Kanchrapara, every order
  invoiced from 16 September 2026 is booked once at Kalyani, order
  `ZHPWB27-OR-0030242357` (17 September, ₹1,101.29) is corrected to Kalyani,
  replaying the overlapping 28-day statement creates no duplicate anywhere, a
  manual upload and scheduled read resolve the same outlet, every client role is
  refused route writes and every non-owner role is refused route reads, and no
  implementation or verification step invokes or changes a login or OTP path.
- [ ] 8.2 Report every suite and live clause honestly. A lapsed stored session
  blocks only the optional live replay evidence; it never authorises escalation
  into login, reconnect or OTP.
