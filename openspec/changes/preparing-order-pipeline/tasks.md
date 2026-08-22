# Tasks: preparing-order-pipeline

Ordered so each section ends in something provable in one sitting. Sections 1–4
are the data and adapter spine; 5–8 are the counter experience; 9 is the
close-out sweep. Tests precede implementation in section 1 per the house rule
for contract-touching work.

## 1. Schema and database rules

- [ ] 1.1 Failing pgTAP first: `orders.prepared_at` accepts null and timestamptz; `set_order_preparation` marks and reprepares under a live shift; reprepare of a paid order is refused with a not-open category; preparation on a cancelled order is refused.
- [ ] 1.2 Failing pgTAP first: `void_order_payment` inside the window voids kind `counter_unpay` and reopens the order atomically; `cancel_paid_order` voids kind `cancelled_after_paid` and cancels atomically; both refused outside five minutes of stored `paid_at`; both refused to a foreign tablet of the same outlet; both idempotent on exact replay; direct-table void still impossible for every role.
- [ ] 1.3 Migration: `orders.prepared_at timestamptz null`.
- [ ] 1.4 Migration: `bills.void_kind text null check (void_kind in ('manager_void','counter_unpay','cancelled_after_paid'))`; legacy rows stay NULL and read as manager voids.
- [ ] 1.5 Migration: three apply functions mirroring the existing command shape — envelope validation, historical device/shift context, claim, row lock, guards, effects, receipt — plus `command_type` check-list additions and dispatch entries.
- [ ] 1.6 pgTAP: mark-prepared on a paid-but-unprepared order succeeds (the upfront payer path); pay-then-prepare produces one bill and prepared state together readable.
- [ ] 1.7 pgTAP: an unwind's void preserves every sale field byte-for-byte except status/kind/attribution, and shift-total queries exclude it.
- [ ] 1.8 Regenerate `src/data-access/database.types.ts`; typecheck green.

## 2. Shared command layer

- [ ] 2.1 `shared/billing-command.ts`: three new types with payload interfaces; explicit-null argument completeness; canonical JSON/hash coverage.
- [ ] 2.2 Cross-runtime hash vectors for every new payload shape in `src/lib/billing-command.test.ts`, SQL mirror asserted equal.
- [ ] 2.3 Result categories named for new refusals (not-open, paid-state conflict, unwind-window-expired, wrong-device) flow through existing retry classification.

## 3. Live adapter and offline overlays

- [ ] 3.1 `markOrderPrepared(orderId, prepared)`, `unpayOrder(orderId, billId, reason)`, `cancelPaidOrder(orderId, reason)` on `BillingAdapter`; both implementations compile against mocks typed from schema.
- [ ] 3.2 Local acceptance at the IndexedDB boundary; chainId = orderId so unwinds queue behind their payment; replay-safe.
- [ ] 3.3 `readOrders` overlay projects preparation commands (prepared/unprepared), unwinds (order reappears open or vanishes as cancelled), and keeps paying overlays intact.
- [ ] 3.4 `overlayDurableBills` projects counter-kind voids so shift totals drop an unwound bill before delivery.
- [ ] 3.5 Unit tests: offline sequence order → prepare → pay → unpay → prepare again lands exactly once online in chain order.

## 4. Mock adapter parity and demo seeds

- [ ] 4.1 All commands queue uniformly: saveOrder/payOrder/settleBill/preparation/unwinds accept → pending → delivered (~400ms), numbers assigned at delivery.
- [ ] 4.2 Provisional `Local · XXXX` references until simulated delivery, matching live wording exactly.
- [ ] 4.3 Drain on subscribe like the live coordinator; seeded pending bill delivers without a network event.
- [ ] 4.4 Outlet-wide pipeline lists; second fabricated tablet contributes seed orders (creator chips exercised); subtitle states outlet scope.
- [ ] 4.5 Mock enforces the same guards (reprepare-after-paid refusal, unwind window, foreign-device refusal) so demo cannot show what production refuses.

## 5. Workspace rearrangement

- [ ] 5.1 Middle column hosts Bills this shift: PaymentTotalCards top, collapsed bills below with countdown chip on eligible ones; reshaped shimmer silhouettes for both middle and rail content.
- [ ] 5.2 Composer overlays the middle column on first item tap and during edits; returns on save/settle/cancel-edit; draft suspension semantics unchanged.
- [ ] 5.3 Right rail becomes Preparing over divider over Unpaid Prepared Orders; whole-outlet scope; settled confirmation follows the money into the bills column.
- [ ] 5.4 Rename applied everywhere user-visible (rail headings, standalone surface + its outlet-wide subtitle, manager labels, test ids' accessible names); slugs and DB vocabulary unchanged.
- [ ] 5.5 Column resize keys keep working for the two resizable columns.

## 6. Pipeline cards

- [ ] 6.1 Compact ticket card: meta line, bold quantity prefixes without per-line prices, total top-right, PAID chip beside total on paid-unprepared cards.
- [ ] 6.2 One primary action per card by section (Mark prepared / Mark paid / Mark prepared on paid-unprepared); docked-edit variant unchanged in kind.
- [ ] 6.3 Kebab overflow with touch-safe labelled rows: Edit + Cancel (unpaid), Reprepare (unpaid prepared), Un-pay + Cancel after paid (paid, within window); Edit absent/refused on paid cards.
- [ ] 6.4 Un-pay confirmation naming amount and tender; cancel-after-paid dialog warning that money leaves the drawer, reasoned, loud styling.
- [ ] 6.5 Density proof: ≥6 one-item cards visible in the rail at landscape-tablet height without scrolling (browser-checked).

## 7. Motion

- [ ] 7.1 FLIP layer + portal ghost flight between sections and columns; origin collapse; destination shimmer placeholder expanding then collapsing; ~300ms budget.
- [ ] 7.2 Coalescing rapid moves (last-state-wins); realtime-originated refreshes animate identically.
- [ ] 7.3 Reduced-motion crossfade; no position depends on animation having run.
- [ ] 7.4 No animation dependency added to package.json.

## 8. Manager surface

- [ ] 8.1 Billing history renders Cancelled after Paid marker from stored kind; actor/time/reason readable in detail; totals unaffected.
- [ ] 8.2 Manager open-orders view reflects the two sections and the rename.

## 9. Close-out sweep

- [ ] 9.1 Full local suite green: lint, format:check, typecheck, test, contrast (both themes), build, e2e; Docker job — db reset, test:db, test:rls, test:e2e:auth, db:types diff clean.
- [ ] 9.2 Offline exercise through the real UI: offline → order → prepare → pay → unpay → online → exactly once.
- [ ] 9.3 Demo walk: four roles still walk; demo makes no request beyond app origin; banner undismissable.
- [ ] 9.4 Phone + tablet viewports, light and dark, zero console errors.
- [ ] 9.5 ROADMAP row #45 reconciled via roadmap:sync.
