# Tasks: preparing-order-pipeline

Ordered so each section ends in something provable in one sitting. Sections 1–4
are the data and adapter spine; 5–8 are the counter experience; 9 is the
close-out sweep. Tests precede implementation in section 1 per the house rule
for contract-touching work.

## 1. Schema and database rules

- [x] 1.1 Failing pgTAP first: `orders.prepared_at` accepts null and timestamptz; `set_order_preparation` marks and reprepares under a live shift; reprepare of a paid order is refused with a not-open category; preparation on a cancelled order is refused.
- [x] 1.2 Failing pgTAP first: `void_order_payment` inside the window voids kind `counter_unpay` and reopens the order atomically; `cancel_paid_order` voids kind `cancelled_after_paid` and cancels atomically; both refused outside five minutes of stored `paid_at`; both refused to a foreign tablet of the same outlet; both idempotent on exact replay; direct-table void still impossible for every role.
- [x] 1.3 Migration: `orders.prepared_at timestamptz null`.
- [x] 1.4 Migration: `bills.void_kind text null check (void_kind in ('manager_void','counter_unpay','cancelled_after_paid'))`; legacy rows stay NULL and read as manager voids.
- [x] 1.5 Migration: three apply functions mirroring the existing command shape — envelope validation, historical device/shift context, claim, row lock, guards, effects, receipt — plus `command_type` check-list additions and dispatch entries.
- [x] 1.6 pgTAP: mark-prepared on a paid-but-unprepared order succeeds (the upfront payer path); pay-then-prepare produces one bill and prepared state together readable.
- [x] 1.7 pgTAP: an unwind's void preserves every sale field byte-for-byte except status/kind/attribution, and shift-total queries exclude it.
- [x] 1.8 Regenerate `src/data-access/database.types.ts`; typecheck green.

## 2. Shared command layer

- [x] 2.1 `shared/billing-command.ts`: three new types with payload interfaces; explicit-null argument completeness; canonical JSON/hash coverage.
- [x] 2.2 Cross-runtime hash vectors for every new payload shape in `src/lib/billing-command.test.ts`, SQL mirror asserted equal.
- [x] 2.3 Result categories named for new refusals (not-open, paid-state conflict, unwind-window-expired, wrong-device) flow through existing retry classification.

## 3. Live adapter and offline overlays

- [x] 3.1 `markOrderPrepared(orderId, prepared)`, `unpayOrder(orderId, billId, reason)`, `cancelPaidOrder(orderId, reason)` on `BillingAdapter`; both implementations compile against mocks typed from schema.
- [x] 3.2 Local acceptance at the IndexedDB boundary; chainId = orderId so unwinds queue behind their payment; replay-safe.
- [x] 3.3 `readOrders` overlay projects preparation commands (prepared/unprepared), unwinds (order reappears open or vanishes as cancelled), and keeps paying overlays intact.
- [x] 3.4 `overlayDurableBills` projects counter-kind voids so shift totals drop an unwound bill before delivery.
- [x] 3.5 Unit tests: offline sequence order → prepare → pay → unpay → prepare again lands exactly once online in chain order.

## 4. Mock adapter parity and demo seeds

- [x] 4.1 All commands queue uniformly: saveOrder/payOrder/settleBill/preparation/unwinds accept → pending → delivered (~400ms), numbers assigned at delivery.
- [x] 4.2 Provisional `Local · XXXX` references until simulated delivery, matching live wording exactly.
- [x] 4.3 Drain on subscribe like the live coordinator; seeded pending bill delivers without a network event.
- [x] 4.4 Outlet-wide pipeline lists; second fabricated tablet contributes seed orders (creator chips exercised); subtitle states outlet scope.
- [x] 4.5 Mock enforces the same guards (reprepare-after-paid refusal, unwind window, foreign-device refusal) so demo cannot show what production refuses.

## 5. Workspace rearrangement

- [x] 5.1 Middle column hosts Bills this shift: PaymentTotalCards top, collapsed bills below with countdown chip on eligible ones; reshaped shimmer silhouettes for both middle and rail content.
- [x] 5.2 Composer overlays the middle column on first item tap and during edits; returns on save/settle/cancel-edit; draft suspension semantics unchanged.
- [x] 5.3 Right rail becomes Preparing over divider over Unpaid Prepared Orders; whole-outlet scope; a settle hands the middle column back to Bills this shift with the bill queued in it � no confirmation bar is inserted.
- [x] 5.4 Rename applied everywhere user-visible (rail headings, standalone surface + its outlet-wide subtitle, manager labels, test ids' accessible names); slugs and DB vocabulary unchanged.
- [x] 5.5 Column resize keys keep working for the two resizable columns.

## 6. Pipeline cards

- [x] 6.1 Compact ticket card: meta line, bold quantity prefixes without per-line prices, total top-right, PAID chip beside total on paid-unprepared cards.
- [x] 6.2 Card actions by band, verb-only labels (Prepared + Paid in Preparing; green Paid + Reprepare in Unpaid Prepared); docked-edit variant unchanged in kind.
- [x] 6.3 Kebab overflow with touch-safe labelled rows: Edit + Cancel (unpaid), Un-pay + Cancel after paid (paid, within window); Edit absent/refused on paid cards; Reprepare promoted out of the overflow onto the prepared card.
- [x] 6.4 Un-pay confirmation naming amount and tender; cancel-after-paid dialog warning that money leaves the drawer, reasoned, loud styling.
- [x] 6.5 Density proof: ≥6 one-item cards visible in the rail at landscape-tablet height without scrolling (browser-checked: 725px rail ÷ 98px card = 7).
- [x] 6.6 Owner feedback round: no section headings and no inserted info bars — bands are colour-coded (ember Preparing, green Unpaid Prepared via a contrast-gated --on-success/--success pair) with the labelled divider as their only words; the reference number renders bright in the primary colour; paying a preparing order holds the money without creating a bill until preparation settles it (spec: Bills only when prepared AND paid).

## 7. Motion

- [x] 7.1 FLIP layer + portal ghost flight between sections and columns; origin collapse; destination shimmer placeholder expanding then collapsing; ~300ms budget.
- [x] 7.2 Coalescing rapid moves (last-state-wins); realtime-originated refreshes animate identically.
- [x] 7.3 Reduced-motion crossfade; no position depends on animation having run.
- [x] 7.4 No animation dependency added to package.json.

## 8. Manager surface

- [x] 8.1 Billing history renders Cancelled after Paid marker from stored kind; actor/time/reason readable in detail; totals unaffected.
- [x] 8.2 Manager open-orders view reflects the two sections and the rename.

## 9. Close-out sweep

- [x] 9.1 Full local suite green: lint, format:check, typecheck, test, contrast (both themes), build, e2e; Docker job — db reset, test:db, test:rls, test:e2e:auth, db:types diff clean.
- [x] 9.2 Offline exercise through the real UI: offline → order → prepare → pay → unpay → online → exactly once.
- [x] 9.3 Demo walk: four roles still walk; demo makes no request beyond app origin; banner undismissable.
- [x] 9.4 Phone + tablet viewports, light and dark, zero console errors.
- [x] 9.5 ROADMAP row #45 reconciled via roadmap:sync.

## 10. Production follow-up: history that predates preparation

The deploy put a nullable axis onto nine days of rows and taught the pipeline
to read paid-but-unprepared as work still owed — so every settled order since
the counter's first day re-entered the rail (269 in production within hours).
The data was never wrong: payment has always settled bills. What was missing
was the decision that history counts as prepared at its paid moment.

- [x] 10.1 Failing pgTAP first (`40_prepared_history_backfill.sql`): a paid order with null `prepared_at` — the exact legacy shape — is stamped prepared at its stored `paid_at`; open orders stay preparing; cancelled stays terminal; bills keep status and total byte-for-byte; a second run moves nothing.
- [x] 10.2 Migration `20260823000000_prepared_history_backfill.sql`: guarded maintenance helper (`backfill_prepared_history`, execute revoked from anon/authenticated/public) plus one invocation so every environment built from the chain agrees with production.
- [x] 10.3 Manager history tab keeps its plain `Open orders (N)` name (owner's call against "Pipeline") and now counts the whole board honestly; `Unpaid prepared (N)` had labelled one section while counting both bands.
- [ ] 10.4 Post-deploy check on prod: the owner's pipeline tab reads single digits at both outlets, demo mode still walks, and no bill totals moved.

Deliberately not done here: bounding pipeline reads by business date. Stale
unpaid work must stay visible for a manager to cancel it (spec: an order
stranded on an unavailable tablet); hiding it would strand it forever. The
backfill removes the flood's cause; accumulation from genuine upfront payers
is daily-visible work, not drift.

## 11. Counter follow-up: the board shares its height

Production day one exposed the rail's last stacking assumption: a busy
Preparing band scrolls the whole column, and the money band — the section a
counter most needs in view — slides off screen behind it. The board now
shares its panel: each band grows with its work, scrolls its own list once
the work exceeds that share, and keeps a measured floor under itself so at
least one complete card stays visible however short the viewport.

- [x] 11.1 Failing component test first (`pipeline-board.test.tsx`): populated bands claim `flex-grow` equal to their order count from a zero basis; each band's list is its own `overflow-y-auto` region; an empty band claims nothing; every populated band carries a floor class standing in for measurement.
- [x] 11.2 The embedded board becomes two floored, proportionally-grown bands over a non-shrinking divider; floors are measured from each band's first rendered card (resize-aware), falling back to the spec's 120px one-ticket figure pre-measurement; standalone page keeps document flow.
- [x] 11.3 The rail's docked-card region stops being a scroller entirely — the pin sits above both bands in an unmoving region, so no scroll anywhere can take an order under edit out of view.
- [x] 11.4 Shimmer reviewed against the rework per the standing placeholder rule: what arrives at rest is unchanged (cards over a hairline), so the silhouette stands; scroll containment is invisible until a band overflows.
- [x] 11.5 Browser proof at short viewports (620px and 500px, light and dark, production build via the Playwright rig): with Preparing at nine orders, the bottom band's divider and first complete card stay visible; scrolling the top band moves only top-band orders; zero console errors.
- [x] 11.6 Tighten the creator-chip test the browser proof exposed: it asserted a relative age that only holds while the wall clock shares the seed's calendar date, so it was green all day and red past midnight. The test now freezes the clock before the store seeds, pinning the fixture order at five minutes old — proved by running it in the very hour it failed.
