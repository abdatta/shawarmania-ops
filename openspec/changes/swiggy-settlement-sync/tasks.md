## 1. Dependency and evidence baseline

- [x] 1.1 Finish and archive #44 `aggregator-reconnect-and-hyperpure-automation`, then re-read its merged `aggregator-channel-sessions` spec and verify this change's delta applies without duplicate or contradictory requirements.
- [x] 1.2 Pin the current Zomato owner tab, reconnect ladder, event resolution, statement upload and ledger day/month behavior with focused tests before extracting shared code; verify every new characterization test passes against the unchanged implementation.
- [x] 1.3 Capture and redact real Swiggy fixtures for live Net Sales, current payout, at least two FINAL cycles (including one non-seven-day boundary), every finance page, pagination and representative error responses; verify fixtures contain no access token, cookie, customer PII, bank reference or live order identifier.
- [x] 1.4 Capture and redact real Swiggy Business Metrics XLSX, payout-annexure XLSX, payment-advice PDF and tax-invoice PDF variants; record MIME bytes, sheet/field contracts and which facts each proves, and verify every retained fixture is synthetic/redacted and parses with network disabled.
- [x] 1.5 Capture one multi-restaurant Business Metrics report or explicitly record that its row partition remains unsupported; verify the parser fixture proves each restaurant row is mapped independently or rejects the ambiguous shape.
- [x] 1.6 Write a short evidence matrix in the change notes or tests mapping portal/API/file fields to normalized gross, order payout, adjustment, cycle finality and bank status; verify Total Customer Paid is excluded from the Net Sales gross basis and no percentage is an input.

## 2. Channel-aware database foundation

- [x] 2.1 Add a normalized channel-scoped external restaurant mapping with unique `(channel, external_ref)`, one-outlet ownership, enabled/dormant state and audit metadata; verify schema tests allow multiple Swiggy references for Kalyani, reject ambiguous mappings and leave Kanchrapara unmapped.
- [x] 2.2 Widen restaurant-money constraints on channel days, cycle deductions, cycle reconciliations, sync boundaries and ingest inputs to admit Swiggy while continuing to reject Hyperpure; verify schema coverage tests enumerate the intended channel set for every table and RPC.
- [x] 2.3 Widen credential, auth-request and sync-run channel constraints to admit Swiggy independently; verify one open request is allowed per channel, Swiggy metadata cannot close a Zomato request and client roles cannot read Vault material.
- [x] 2.4 Extend channel-day storage with exact gross, order-level reduction, net payout, source/as-of metadata and legacy provenance without floats; verify zero-gross/negative-net cancellation rows, nullable provisional net, settled completeness and `net + reduction = gross` invariants.
- [x] 2.5 Extend cycle reconciliation with operator cycle identity, declared start/end, stated final payout and separate bank status; verify coincident Zomato/Swiggy dates do not collide and shortened month-boundary cycles persist unchanged.
- [x] 2.6 Make source, deduction and accepted-difference identities include channel and stable operator reference; verify replays are inert within one channel and cannot overwrite the other channel's same-date record.
- [x] 2.7 Add/adjust RLS so Super Admin reads all channel days and internals, Franchise Admin reads only assigned-outlet channel days, and Biller/Employee read none; verify assigned, cross-outlet, deactivated and hand-crafted SELECT/INSERT/UPDATE/DELETE cases in `test:db` and `test:rls`.
- [x] 2.8 Keep cycle records, deductions, mappings, sync runs, credentials and auth requests owner/server-only even at an assigned outlet; verify a Franchise Admin receives no row from every protected table and cannot invoke an owner command.
- [x] 2.9 Regenerate `src/data-access/database.types.ts` from the reset schema and verify `npm run db:types` leaves no unexpected generated-type diff.

## 3. Channel-neutral ingest and reconciliation

- [x] 3.1 Generalize the normalized order/cycle payload to carry channel, external restaurant reference, operator cycle identity, bank status, gross/reduction/net, timestamped adjustments and cycle-only adjustments; verify runtime validation rejects floats, unsupported channels, incomplete settled money and ambiguous/unmapped references.
- [x] 3.2 Generalize the ingest Edge Function and SQL transaction so channel is authenticated/allowlisted rather than hard-coded to Zomato; verify a valid Swiggy payload commits and Hyperpure or a mismatched outlet mapping is refused before any write.
- [x] 3.3 Apply the outlet's cutover to each order placement timestamp inside the transaction and refuse unattributed required rows; verify 03:59 belongs to the prior business date, 04:00 opens the new date and no portal calendar date bypasses the rule.
- [x] 3.4 Reconcile `sum(order net payouts) +/- dated and cycle adjustments` to the exact stated final payout with one ₹1 cycle-level tolerance; verify a match commits atomically, a larger mismatch changes nothing and marks the candidate disputed, and rounding tolerance is not applied per row.
- [x] 3.5 Preserve provisional, settled, revised and disputed monotonicity per outlet/channel/date, with bank status independent; verify FINAL Pending can settle, live data cannot downgrade it and a later changed final retains prior values as a revision.
- [x] 3.6 Generalize rehearse, recheck and accept-difference commands to Swiggy with channel-safe identities; verify rehearsal performs all arithmetic with zero financial writes, recheck cannot conceal a discrepancy and acceptance records the exact difference without changing a day.
- [x] 3.7 Generalize sync event recording and no-zero failure outcomes for auth lapse, access denial, transport exhaustion, source-shape change, unmapped identity, unattributed order and reconciliation dispute; verify every failure leaves prior money byte-for-byte unchanged.

## 4. Independent Swiggy session boundary

- [x] 4.1 Extend the Ops reader boundary to read/save/forget Swiggy Vault material and return secret-free health with truthful unknown expiry; verify app clients receive metadata only and no service-role or session material.
- [x] 4.2 Add a cheap authenticated Swiggy GraphQL probe with alive/lapsed/access-denied/shape/transport outcomes; verify it never defaults an unknown channel to Zomato and tests cover each classification.
- [x] 4.3 Make reconnect dispatch branch explicitly by channel: Swiggy probes and repairs only Swiggy, while the existing Zomato/Hyperpure ladder remains unchanged; verify healthy Swiggy returns `still_signed_in`, lapsed Swiggy dispatches only `login.yml(channel=swiggy)`, and unconfigured Kanchrapara is refused.
- [x] 4.4 Extend the OTP mailbox actions and answer function to Swiggy with atomic per-channel claim, sweep and expiry behavior; verify a Swiggy code cannot answer Zomato, duplicate answers are inert/refused and no submitted code is logged or returned.
- [x] 4.5 Update every Edge Function declaration/config block affected by the new channel and verify `npm run lint:functions` passes with the intended JWT boundary.

## 5. Browser-free Swiggy readers in the sync repository

- [x] 5.1 Harden the plain-HTTP Swiggy client around the captured access token, GraphQL errors and bounded 408/429/5xx retry; verify tests distinguish session lapse, access denial, source-shape error and exhausted transport without logging request secrets.
- [x] 5.2 Implement cursor-complete finance history, payout detail and order-level payout reads using portal-declared IDs and dates; verify fixtures cover multiple pages, FINAL Pending/Paid/On Hold and shortened cycle boundaries.
- [x] 5.3 Implement live/open-cycle reading with captured/as-of time and a bounded lookback including yesterday; verify a second read advances a provisional value idempotently and a multi-date aggregate is never assigned to one date.
- [x] 5.4 Investigate and fixture-prove a timestamped same-day source carrying the Net Sales/Net Bill Value basis, including the post-midnight cutover case; verify the reader refuses authoritative same-day ledger output unless it can assign each amount to the 04:00 business window.
- [x] 5.5 Build the Swiggy normalized cycle candidate from order gross/net plus dated and cycle-only components; verify real redacted fixtures reproduce the portal's final payout within tolerance without percentage math or pro-rata allocation.
- [x] 5.6 Implement mapping-aware Ops configuration loading and candidate posting for every enabled Swiggy restaurant reference; verify dormant Kalyani is skipped, active Kalyani posts to the correct outlet and Kanchrapara produces no run or zero row.
- [x] 5.7 Add browser-free no-write rehearsal and write modes to the Swiggy CLI/workflow entry point; verify rehearsal prints only secret-free outcome counts and write mode posts the same normalized candidate bytes.
- [x] 5.8 Prove scheduled-reader dependency hygiene by checking the runtime bundle/workflow contains no Playwright/browser/display-server launch path; verify the full reader suite runs in a Node-only CI job.

## 6. Headed Swiggy login job

- [x] 6.1 Implement the Swiggy identifier → OTP → verified-login capture with resilient selectors and one identifier submission/no automatic resend; verify fixture/UI tests open the mailbox only after the genuine OTP screen renders.
- [x] 6.2 Capture only the minimum replayable Swiggy session, write it directly to the Ops Vault boundary and destroy local state; verify logs, summaries and failure artifacts contain no token, cookie, storage value, OTP, restaurant money or customer data.
- [x] 6.3 Extend the manual `login.yml` dispatch for `channel=swiggy` under headed Playwright/Xvfb with one channel-specific concurrency group and failure-only short-lived structural artifacts; verify Zomato/Hyperpure workflow behavior remains unchanged.
- [x] 6.4 After capture, launch a fresh plain-HTTP client from Vault and complete the Swiggy probe/reader before reporting success; verify a capture that cannot replay remains failed and does not mark health live.
- [x] 6.5 Measure a real token's expiry/refresh behavior without recording the token, then encode the truthful metadata rule; verify missing evidence displays unknown expiry and is never replaced by an invented timestamp.

## 7. Official-file fallback

- [x] 7.1 Extend byte/MIME/size recognition to XLSX and deterministic PDF shapes without trusting name/extension; verify renamed valid fixtures pass while forged, oversized, encrypted, scanned, malformed and unknown-layout files fail with zero writes.
- [x] 7.2 Parse the payout-annexure workbook's Summary, Payout Breakup, Order Level and adjustment sheets into the shared normalized candidate; verify header drift fails closed and the real redacted fixture reconciles the exact final payout across the outlet cutover.
- [x] 7.3 Parse the Business Metrics Report's explicit restaurant rows and `Overview=SALES` / `Metric=Net Sales` date columns as portal-calendar evidence; verify unmapped/ambiguous restaurant rows are refused and a 04:00-cutover outlet is not given an authoritative business-date write from calendar totals alone.
- [x] 7.4 Parse only fixture-proved payment-advice PDF fields into a cycle-target candidate and treat tax-invoice/other PDFs according to facts they prove; verify a PDF with final payout but insufficient stored order/day evidence cannot settle or invent days.
- [x] 7.5 Drop customer identifiers, phone numbers, names and addresses before normalized output, logs or retained evidence, retaining only an opaque/non-reversible replay value when required; verify fixture scans and assertions find no PII.
- [x] 7.6 Store a digest, parser/version metadata and sanitized evidence under server-generated outlet/channel isolation rather than raw PII-bearing bytes; verify bucket policies refuse guessed/cross-outlet paths for all client roles.
- [x] 7.7 Make upload replay idempotent and settled-period restatement confirmation bind to the digest and structured before/after proposal; verify same upload is inert, a changed file asks, and an altered proposal cannot reuse confirmation.

## 8. Ops adapters, Swiggy tab and ledger

- [x] 8.1 Generalize sync adapter types and Supabase/mock implementations around a restaurant-channel configuration while preserving Zomato responses; verify existing Zomato adapter tests and new Swiggy health/event/action tests pass together.
- [x] 8.2 Extract the shared sync surface and event presentation, parameterizing channel labels, capabilities and filters; verify Zomato still shows Hyperpure and Swiggy never shows a Hyperpure line/action, with both shimmers matching any changed layout.
- [x] 8.3 Add `owner-swiggy-sync`, `/ledger/swiggy`, owner navigation and an independent attention key; verify the gate hides the route/nav when off, direct access is refused for non-owners and Zomato attention cannot clear or create Swiggy attention.
- [x] 8.4 Implement configured, not-connected, quiet, reading, lapsed, awaiting-code, stuck, provisional, final Pending/Paid, revised and disputed Swiggy states with Read again suppression, reconnect, upload, recheck and accept actions; verify focused surface tests cover every state and action.
- [x] 8.5 Generalize manual-ledger adapters/domain types to merge Zomato and Swiggy channel rows into one virtual day even without a manual row; verify day/month totals select one highest-authority value per channel/date and include negative net/cycle deductions correctly.
- [x] 8.6 Remove Swiggy revenue/rate/commission controls from current forms and payload types behind the staged migration flag, showing source/state/as-of/superseded history instead; verify no app path can directly write a measured or legacy Swiggy amount.
- [x] 8.7 Let assigned Franchise Admin ledger reads include both sourced channel-day aggregates while keeping owner sync UI/actions absent; verify role-shell, direct-route and hand-crafted adapter tests align with RLS.
- [x] 8.8 Add internally consistent demo fixtures/actions for provisional, settled, revised, disputed, lapsed, upload fallback and Kanchrapara not-connected states; verify the four-role demo makes no live request and both light/dark phone/tablet walkthroughs remain legible.

## 9. Lossless handover and live rehearsal

- [x] 9.1 Add the first forward migration that copies every typed Swiggy revenue/rate/commission fact into immutable `legacy_typed` provenance without dropping source columns; verify transactional row counts, non-null fields, values and representative day/month totals match before and after.
- [ ] 9.2 Run the independent headed login job with an owner-supplied live OTP and verify a new CI job reuses only the Vault-captured session for a browser-free probe, current read and finance read.
- [x] 9.3 Run production no-write rehearsal for active Kalyani current data and at least two FINAL cycles, including one shortened boundary; verify cutover allocation, Net Sales basis, every payout component, exact final reconciliation, final/bank-status separation and no financial writes.
- [x] 9.4 Produce an outlet/date coverage audit comparing every legacy Swiggy date with API/annexure candidates, explain every gap and verify dormant Kalyani and unconfigured Kanchrapara are not counted as missing trade or zero.
- [x] 9.5 Backfill accepted Kalyani candidates through the real ingest boundary and verify idempotent replay, authoritative supersession, retained legacy values and unchanged unaffected dates/months.
- [x] 9.6 Exercise failure rehearsals for lapse, timeout, 429/5xx exhaustion, GraphQL error, pagination interruption, source-shape drift, unmapped RID, unattributed order and payout mismatch; verify every case emits the right event and leaves prior money unchanged.

## 10. Freeze, scheduling and promotion

- [x] 10.1 Only after tasks 9.3–9.5 pass and the owner accepts the coverage audit, add the second forward migration removing Swiggy money/rate columns and database writers from `manual_ledger_days`; verify stale payloads fail loudly, carried history remains readable and all pre-handover totals are unchanged.
- [x] 10.2 Remove the staged compatibility flag and every remaining Swiggy typed field from generated types, adapters, forms, mocks and tests; verify repository search finds no writable Swiggy ledger field and TypeScript rejects the old payload shape.
- [x] 10.3 Add the serialized Swiggy schedule at UTC cron `30 5,17 * * *` and make Read again share its concurrency boundary; verify workflow syntax/actionlint and a branch dispatch show API-only current plus recent-cycle discovery.
- [ ] 10.4 Enable production Swiggy writes for the verified mapping and run two consecutive jobs from the CI-captured session; verify the second is idempotent, same-day provisional/as-of advances correctly and final payouts/deductions reach ledger and reconciliation views.
- [ ] 10.5 Promote `owner-swiggy-sync` from demo to live only after the two successful scheduled reads; verify the production owner tab, ledger day/month and Kanchrapara not-connected state all agree without a manual Swiggy input.

## 11. Verification, docs and roadmap

- [ ] 11.1 Run the Ops non-Docker gates — `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e` — and record exact passing evidence.
- [ ] 11.2 Run the full Docker gates — `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`, `npm run db:types`, then the generated-type clean-diff check — and record exact passing evidence.
- [ ] 11.3 Run the sync repository's unit/integration tests and workflow validation, including fixture-only network-disabled parsers, paise math, pagination, auth/error classification, secret scanning and no-Playwright scheduled bundle; record exact passing evidence.
- [ ] 11.4 Walk Zomato and Swiggy owner tabs plus ledger day/month on phone and tablet in light and dark themes, and walk all four demo roles; verify no Zomato/Hyperpure regression, no layout/shimmer reflow and no real request in demo.
- [ ] 11.5 Update `docs/PROJECT_OVERVIEW.md`, `docs/BUSINESS_CONTEXT.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/TESTING.md` and `docs/LIMITATIONS.md`; verify docs describe current behavior, exact source limitations, login/runbook, privacy and fallback semantics without history prose.
- [ ] 11.6 Reconcile the aggregator-settlement and flat-navigation todos plus roadmap dependencies so #47 follows #44, precedes #46 and blocks #12 while navigation redesign remains separate; run `npm run roadmap:sync` and verify no hand-stamped status drift.
- [ ] 11.7 PHASE GATE — Swiggy settlement sync: Kalyani's Swiggy sales appear in the ledger from two browser-free reads each day; a portal-declared closed payout cycle settles those days against the exact payout after every fee, tax, ad charge, complaint, cancellation, refund and adjustment; a headed login is used only when the independent Swiggy session genuinely needs repair; a real Swiggy annexure can reproduce the same result offline; legacy typed Swiggy history survives the handover; Kanchrapara is shown as not connected rather than zero; Zomato and Hyperpure are unchanged; all Ops, Docker, sync-CI and four-role demo gates pass.
