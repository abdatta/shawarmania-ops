## Context

See [proposal.md](proposal.md) for the motivation and rollout gate. The existing Zomato path already has the right broad shape: a browser-free reader posts normalized integer-paise cycles to an authenticated Edge Function; Postgres applies the outlet cutover, reconciles the cycle atomically and stores channel days, deductions, reconciliations and owner-facing events; a separate headed workflow repairs login; a file upload can invoke the same ingest boundary.

The seams are not yet channel-neutral. Money-table constraints, ingest identities, sync configuration, auth mailboxes, reader dispatch, adapter filters and the owner surface contain Zomato allow-lists. Swiggy remains typed on `manual_ledger_days`. The active #44 change introduces the independent channel-session capability on which this change depends.

Portal investigation established these Swiggy facts:

- Business Metrics exposes live same-day **Net Sales**. Its definition is item subtotal plus packaging less restaurant discounts, taxes and platform fee; it is the intended pre-commission ledger gross, not Total Customer Paid and not the restaurant payout. The dashboard/report is calendar-day based and therefore cannot by itself satisfy the outlet's 04:00 business cutover.
- Finance exposes an estimated **Current Payout** for an open cycle and a full A–F breakdown. Closed cycles are labelled **FINAL PAYOUT**, sometimes while bank status is still Pending. Cycle boundaries come from Swiggy and split around month boundaries; they are not fixed seven-day weeks.
- Finance APIs expose final `netPayout`, order-level restaurant payout, timestamps, component summaries and attachment links. The downloaded payout annexure contains Summary, Payout Breakup, Order Level, complaints, growth/other deductions, discount summary and glossary sheets. Order Level contains the timestamp, Net Bill Value before taxes and Net Payout for Order after taxes needed for cutover-safe daily settlement. Ads and some other adjustments exist only at cycle level.
- Business Metrics XLSX is date-column aggregate evidence with an explicit restaurant ID. Payment advice and tax invoice PDFs do not necessarily contain order/day facts. Attachments can be absent for a FINAL Pending cycle and appear after payment.
- The account exposes more than one restaurant identity for Kalyani, including one with no observed trade. No Swiggy identity or financial history has been verified for Kanchrapara.
- Swiggy login is identifier plus OTP and returns an API access token. The token can drive GraphQL without a browser. Exact token lifetime remains to be measured.

This change touches money arithmetic, forward-only migrations, RLS, credentials, two repositories, a live third-party protocol and the demo seam. It therefore uses evidence gates rather than promoting the first response that parses.

## Goals / Non-Goals

**Goals:**

- Give Swiggy channel parity with the Zomato owner and ledger experience while retaining Swiggy-specific source semantics.
- Refresh same-day trade and discover final payouts twice daily using API-only CI jobs.
- Store exact integer-paise daily gross/order payout and reconcile the exact final cycle payout without allocating unsupported adjustments.
- Make login an independent, manually initiated, headed recovery workflow whose stored result is proven by a fresh API-only client.
- Preserve every typed Swiggy value through a staged, audited freeze and then remove all writable Swiggy money fields.
- Make official Swiggy files a deterministic, private, PII-free fallback whose authority is limited to facts each shape proves.

**Non-Goals:**

- No Hyperpure work and no coupling Swiggy repair to the Zomato/Hyperpure ladder.
- No percentage-based payout estimate, fuzzy outlet mapping, fabricated Kanchrapara configuration or zero-on-failure behavior.
- No browser in scheduled readers, automatic OTP from a schedule, OCR or arbitrary-PDF support.
- No item analytics, navigation redesign or retirement of the wider manual-ledger tables.

## Decisions

### 1. Extend the normalized settlement model; do not clone the Zomato stack

The shared persistence and command boundary becomes channel-aware for restaurant aggregators (`zomato`, `swiggy`), while Hyperpure remains a supply channel and is rejected by money tables. The normalized order contract carries:

- channel, Ops outlet and external restaurant reference;
- operator cycle identity plus portal start/end and bank status;
- external order replay reference, placement timestamp and status;
- gross, order-level reduction and net order payout in integer paise;
- dated adjustments with kind/service date; cycle-only adjustments with kind and no invented date;
- stated final payout, source kind/reference, captured/as-of time and settlement state.

Daily records store gross, reduction and net explicitly. Cycle reconciliation stores the exact stated payout and the component total. Accepted-difference identities include the channel and operator cycle identity, not only dates, so coincident Zomato and Swiggy periods cannot collide.

The ingest command validates the channel-specific parser output and then calls one transaction which maps orders through the outlet cutover, upserts eligible daily rows, writes deductions and reconciliation, and emits the result. A mismatch above ₹1, an unmapped restaurant, incomplete pagination or unattributed required order aborts the whole candidate.

**Rejected:** build parallel `swiggy_*` tables and functions. That duplicates reconciliation and state-transition invariants and guarantees later divergence.

**Rejected:** force Swiggy into the existing Zomato constants. Shared shapes do not justify shared credentials, mappings or source assumptions.

### 2. Use explicit channel-scoped restaurant mappings

Replace the scalar operator-ID assumption with a normalized mapping keyed by `(channel, external_ref)` and pointing at one outlet, with enabled/dormant status and audit timestamps. One outlet can own multiple references; an external reference cannot map to two outlets in the same channel. Automation and uploads resolve through this table before any financial command.

Seed only verified account facts: the active and dormant Kalyani references, with only the proven trading reference enabled. Kanchrapara receives no row and renders Not connected. Mapping is an owner-controlled configuration boundary in the database, not a runtime name/amount guess; this change need not expose a generic mapping editor.

**Rejected:** choose the closest outlet name or ledger total. Approximate financial matching can silently put money behind the wrong tenancy boundary.

**Rejected:** add another `swiggy_res_id` scalar to `outlets`. It cannot represent aliases/dormant identities and repeats a model already shown insufficient.

### 3. Separate provisional sales, provisional payout and final settlement

Three observations have distinct authority:

1. **Live daily sales:** eligible for a provisional channel day only when an order-level/API source provides placement timestamps and the proved Net Sales/Net Bill Value basis, or when the query window is proved to align exactly with the outlet business date. Each row carries `as_of_at`.
2. **Current Payout:** stored/displayed only as a provisional cycle estimate with its A–F component snapshot and as-of time. It never changes a settled day merely because its arithmetic currently closes.
3. **FINAL payout:** eligible for settlement as soon as Swiggy labels the cycle final and supplies enough evidence to reconcile, even when bank status is Pending or On Hold. Bank status is separate and may later become Paid.

The business-metrics calendar-day card/report remains a live health and cross-check only. The reader first obtains the active Finance cycle through `getRestaurantPayoutDetailsV3` with its portal-observed null selectors, then uses that exact period to page timestamped order rows. A missing active-cycle payload is a source-shape failure, never a quiet current-day omission. The captured `getOrderLevelPayoutDetails` response supplies a placement timestamp and its `payoutSummary` A header (`Total Customer Paid`) plus `GST Collected` sub-header. Its exact per-order gross is `A - GST Collected`; the initial normal-order probe matched the final annexure's `Net Bill Value (before taxes)` at paisa precision. The one proved exception is a response explicitly marked cancelled that omits the GST row: although it can display customer-payment and discount components, its final annexure Net Bill Value is zero, so the reader stores zero gross and may retain a negative payout. Any other omitted, duplicate or impossible field fails the complete candidate. The reader requests this detail for every non-annexure order and never falls back to the GST-inclusive `customerPaidAmount` field from the list response. The fresh-session, multi-cycle reconciliation remains a promotion gate; until it passes, this source makes no production daily write. This keeps same-day reading cutover-safe without relabelling the calendar aggregate as a business-day source.

The final-cycle builder uses Order Level Net Bill Value before taxes as gross and Net Payout for Order after taxes as daily net. Their difference is the order-level commission/fee/tax reduction. Cancelled rows may produce negative net at zero gross and remain valid. Undated ads, recoveries and other owner-level adjustments stay on the cycle and enter the exact reconciliation; they are not smeared over days. Where a real service/spend date exists, the existing dated-deduction path records it.

**Rejected:** Total Customer Paid by itself as gross. It includes GST; only `Total Customer Paid - GST Collected` is the proved ledger/annexure basis.

**Rejected:** derive exact payout from a fixed commission rate. Observed fees and deductions are multi-component and vary.

**Rejected:** distribute cycle differences pro rata across days. It makes daily commission appear exact when the source never dated the charge.

### 4. Trust portal cycle identity and finality, not a calendar-week rule

Store Swiggy's payout ID (or stable operator cycle reference), declared start/end, payout date and bank status. The reader paginates payout history and rereads the two most recent closed cycles on every scheduled run so a newly FINAL or revised cycle is found promptly. Settlement state is monotonic, while a changed later final snapshot follows the existing revision/audit contract.

One rupee remains the maximum reconciliation tolerance because rendered source values are two-decimal currency. The tolerance is applied once to the cycle equation, never per row. Recheck refetches/reparses; Accept difference records the channel-scoped discrepancy without changing any daily value.

**Rejected:** a separate weekly payout cron or generated Monday/Sunday ranges. Observed cycles split at month boundaries and finality can precede bank payment.

### 5. Run one serialized API-only workflow at 11:15 and 23:15 IST

The sync repository's Swiggy workflow uses UTC cron `45 5,17 * * *`, matching 11:15 and 23:15 IST year-round. One channel-specific concurrency group serializes scheduled, Read again and settlement work so two candidates cannot race. Each run:

1. loads the narrow Swiggy session and enabled mappings from the Ops reader boundary;
2. makes a browser-free authenticated probe;
3. reads the current business window plus a bounded daily lookback including yesterday;
4. paginates current and recent finance data, including at least the two most recent closed portal cycles;
5. builds normalized candidates only after full pagination and source-shape validation;
6. posts candidates idempotently and reports one user-meaningful event per outlet/outcome;
7. saves only legitimate refreshed session metadata, never raw material to logs or artifacts.

Transient 408/429/5xx responses use bounded exponential retry. Auth failure, access denial, shape change, reconciliation dispute, unmapped reference and transport exhaustion are distinct outcomes. None writes zero. Scheduled work never dispatches login.

**Rejected:** separate daily and weekly workflows. Both need the same session, mapping and serialization, and every run should discover finality as soon as the portal exposes it.

**Rejected:** Playwright for finance/report downloads. The GraphQL contracts and returned attachment URLs are available to the authenticated HTTP client; a browser would multiply failure modes.

### 6. Make Swiggy login independent and prove replay before success

After #44 has established channel-specific credential/mailbox behavior, extend it with `swiggy`. The owner reconnect action asks Ops to probe Swiggy only. A healthy session stops. A lapsed/missing session dispatches `login.yml(channel=swiggy)` under headed Playwright/Xvfb. The runner submits the configured identifier once, opens the Swiggy mailbox only when the OTP UI appears, claims one code, captures the verified-login token response and stores the minimum replay envelope in Vault.

The runner then destroys the browser context and proves the saved session with the plain HTTP client. Only that proof marks credential health live. If expiry cannot be derived, metadata says unknown and probes establish health. Failure artifacts are opt-in on failure, short-lived, structural and scrubbed of inputs/storage/network secrets and restaurant/customer data.

**Rejected:** transplant the owner's current browser state into production credentials. It is useful only for read-only protocol discovery and has no reproducible renewal, provenance or safe CI handoff.

**Rejected:** reuse Zomato OTP/session records. The portals and token lifecycles are independent; shared state would let one repair disturb the other.

### 7. Freeze manual Swiggy only after lossless carry and authoritative coverage proof

The forward migration first carries every non-null typed Swiggy revenue/rate/commission fact into immutable legacy provenance. It verifies row counts, values and day/month totals inside the transaction. Legacy data is never labelled `supplied_by_hand`, which is reserved for an operator-issued statement.

The deployment then completes a no-write rehearsal, backfills the intended date range from real APIs/annexures and produces a coverage report comparing every legacy outlet/date with an authoritative candidate. A timestamped portal daily read may supersede `legacy_typed` even while provisional: typed carry is not operator proof. This is the sole exception to settled-row monotonicity; genuine operator settlements and supplied statements remain terminal until a later final settlement. Every replacement retains the typed values and time of supersession. Dates without source coverage retain their legacy reading, marked legacy and excluded only after replacement.

Only after the owner-visible coverage gate passes does a later forward migration remove Swiggy columns, generated types, adapter/form fields and every writer from `manual_ledger_days`. Database command signatures reject stale payloads that still contain those keys. A failed future sync leaves measured/legacy values untouched and never reopens input.

**Rejected:** delete typed values as the earlier Zomato rollout did under a one-off instruction. Swiggy has not received such authorization and the proposal explicitly promises preservation.

**Rejected:** keep hidden writable columns for rollback. Old clients could continue changing money invisibly, defeating the freeze.

### 8. Share the owner sync surface through channel configuration

Extract the Zomato-specific health/event/action presentation into a channel-configured feature beneath the typed adapter interface. Zomato remains behaviorally unchanged. Add an independent `owner-swiggy-sync` gate, `/ledger/swiggy` route, nav item and attention key. Swiggy configuration omits the Hyperpure line and all supply actions; it owns only Swiggy health, Read again, reconnect/OTP, events, upload and reconciliation controls.

The ledger adapter reads both restaurant channels into one virtual day even when no manual day row exists. Day and month totals choose the highest-authority unsuperseded value per channel/date. Franchise Admin adapters can read assigned daily aggregates but cannot call sync actions or load owner internals. Demo adapters cover all required states without Supabase access. If shared extraction changes layout, both tab shimmers change in the same task.

Adding another flat nav child triggers the recorded navigation-capacity todo, but redesigning the owner shell is sequenced separately.

**Rejected:** copy the Zomato surface directory and replace strings. It would preserve hard-coded channel filters and let behavior drift.

### 9. Normalize official uploads by proved content and limit their authority

The Edge upload decoder validates bytes, size and structure with no network access, then selects a fixture-proved parser:

- **Payout Annexure XLSX:** read Summary, Payout Breakup, Order Level and adjustment sheets. Validate restaurant mapping, period, totals and required headers; drop customer columns at parse time; emit the same normalized order/cycle contract as API settlement.
- **Business Metrics Report XLSX:** select rows where Overview is SALES and Metric is Net Sales, partition by explicit restaurant ID and parse date columns. Because these are portal-calendar totals, retain them as cross-check evidence unless the target cutover aligns or additional order timestamps prove attribution.
- **Payment advice PDF:** deterministic text extraction only. If its stable fixture proves restaurant, cycle and final payout, emit a cycle-target candidate which can settle only against already complete order/day evidence.
- **Tax invoice or other PDF:** accept only after a real fixture demonstrates which reconciliation facts it proves. Never assume it represents the whole payout.

Unknown, scanned, encrypted, malformed and oversized files fail closed. No OCR or portal lookup runs. The server retains a digest, parser/version metadata and PII-free normalized evidence, not a raw file containing customer data. Object paths are server-generated beneath outlet/channel isolation. Replay by digest or normalized identity is inert. A changed candidate for a settled period returns a structured before/after proposal and a digest-bound confirmation token.

**Rejected:** trust extension, filename or reported MIME. Portal downloads and browser names vary, while hostile bytes can claim an accepted extension.

**Rejected:** accept every PDF as equivalent to the annexure. Payment advice can prove a payout amount but usually cannot reconstruct daily gross or deductions.

### 10. RLS follows the ledger boundary, while controls remain owner-only

`aggregator_channel_days` gains SELECT for a live Franchise Admin assignment at that outlet, matching the manual-ledger full-view contract. Super Admin retains cross-outlet read. Biller and Employee have no daily access. Cycle reconciliations, deductions, mappings, sync runs, credentials, auth requests, evidence objects and sync controls remain Super Admin-only except for server-reader access.

All financial tables deny direct client mutation, including Super Admin. The ingest/rehearsal boundary authenticates the sync shared secret in constant time and allowlists the mapped outlet/channel; owner commands re-derive Super Admin authority from the caller token. Storage object paths are server-generated and policies enforce outlet/channel ownership. Database tests exercise assigned, cross-outlet, deactivated and hand-crafted cases for all four roles.

**Rejected:** leave daily rows owner-only after freezing inputs. It would make the Franchise Admin's already-promised full assigned-outlet ledger omit both aggregators.

## Risks / Trade-offs

- **[The per-order detail field is unavailable or changes shape]** → Fail the whole daily candidate, retain the prior reading and expose the source-shape event. Keep Business Metrics as labelled portal-calendar telemetry; do not fall back to GST-inclusive list values or weaken `business_date`.
- **[FINAL Pending later revises]** → Store bank status separately, reread two recent closed cycles and use settled restatement/audit rules; never mutate without retained prior values.
- **[Token lifetime is shorter than the 12-hour interval]** → Measure a real login/replay, report unknown expiry truthfully, probe every run and make reconnect quick. Scheduling does not auto-login.
- **[GraphQL or workbook shape changes]** → Required-field/label guards classify a shape event and preserve prior values. Redacted fixtures pin every accepted shape and parser version.
- **[One cycle contains owner-level cross-outlet recovery]** → Represent it at the explicitly named outlet/cycle only when the source identifies allocation; otherwise dispute rather than guessing.
- **[Legacy backfill is incomplete]** → The coverage gate blocks field removal. Legacy values remain readable and totals do not change until replaced.
- **[PDF parsing increases attack surface]** → Enforce byte/size/page limits, deterministic local parsing, no scripts/network/OCR, process in the privileged function and retain only sanitized evidence.
- **[Shared UI refactor regresses Zomato]** → Pin Zomato behavior before extraction and run both channel/demo suites; configuration adds Swiggy without changing Zomato defaults.
- **[Third-party automation violates portal expectations]** → Keep request volume to two serialized runs plus explicit owner actions, use bounded lookbacks/retries and avoid scraping UI outside manual login.

## Migration Plan

1. **Dependency gate:** finish and archive #44 so channel sessions, probe-first reconnect and just-in-time OTP are the main contract. Rebase this delta if #44 changes its final names.
2. **Contract widening:** add `swiggy` only to restaurant-money/auth/sync allow-lists where appropriate; add normalized external mappings; make accepted-difference/source identities channel-safe; add RLS and generated-type updates. Do not enable writes or schedule.
3. **Parser and reader fixtures:** capture/redact the timestamped `getOrderLevelPayoutDetails` shape as well as real API responses, the Business Metrics workbook, payout annexure and eligible PDFs; implement offline parsers, bounded detail enrichment, `Total Customer Paid - GST Collected` paise conversion, source-shape failures and no-zero tests in both repositories.
4. **Independent login proof:** configure the identifier through the owner-safe boundary, run the headed Swiggy login with an owner-supplied OTP, store Vault material and prove a fresh browser-free probe and reader. Record measured expiry behavior without exposing secrets.
5. **No-write financial rehearsal:** run current data and at least two closed cycles for the active Kalyani mapping. Prove that timestamped `Total Customer Paid - GST Collected` equals final Net Bill Value, cutover attribution, component arithmetic, portal cycle boundaries, Current versus FINAL semantics, and no writes on mismatch/shape/lapse. Keep the dormant mapping disabled and Kanchrapara absent.
6. **Lossless legacy carry:** migrate typed Swiggy values to legacy provenance with transactional row/value/total assertions. Produce the outlet/date coverage audit and backfill authoritative data. Do not remove fields while any unexplained loss remains.
7. **Enable ingest and owner UI:** enable channel-safe writes, reconciliation, private upload evidence and the gated Swiggy tab. Exercise provisional, final Pending, Paid, revised, disputed, upload and not-connected states; confirm assigned Franchise Admin daily visibility and every cross-outlet refusal.
8. **Freeze and schedule:** after the coverage gate, remove Swiggy manual columns/writers, regenerate schema types, enable the two cron entries and promote `owner-swiggy-sync` to live. Verify one successful scheduled API-only run from CI-captured auth.
9. **Documentation and roadmap:** update the listed docs, affected todos and dependencies; make #12 depend on #47 and sequence #46/navigation follow-up; run roadmap reconciliation.

Because migrations and the removal of writable money fields are forward-only, rollback disables the schedule and Swiggy gate and leaves all new/audit rows intact. It does not recreate hidden writable columns. A corrective migration and adapter release are required if a post-freeze defect is found; prior measured and legacy values remain available for that recovery.

## Open Questions

- What exact expiry or refresh behavior does a production Swiggy token exhibit? The live login task measures it; unknown-expiry health and probe-first repair already cover either answer.
- Which field/header variants appear across older payout annexures and payment-advice PDFs? Each variant remains unsupported until added as a redacted fixture, so discovering one changes parser coverage rather than the contract.
- Can a FINAL Pending snapshot revise before Paid in practice? The two-cycle reread and settled-restatement contract handles either outcome without changing the design.
- Does a multi-restaurant Business Metrics workbook repeat the proved metric-row shape once per restaurant? The parser rejects ambiguity until a fixture proves partitioning; explicit mapping remains mandatory either way.
