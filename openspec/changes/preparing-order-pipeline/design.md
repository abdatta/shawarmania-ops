# Design: Preparing Order Pipeline

## D1 — Preparation is an axis, not an enum value

The billers' flow asks two independent questions of every order: *is the food made?* and *is it paid?* A paid order can still be cooking (upfront payer), and a prepared order is unpaid until the money arrives. One `order_status` column cannot hold four quadrants without combinatorial values.

So `orders` gains `prepared_at timestamptz` — null means preparing, a timestamp means prepared, and clearing it back to null is reprepare. The status enum stays exactly `open | paid | cancelled`: the money lifecycle. The sections are then pure derivations, needing no new query shape:

| Section | Predicate |
|---|---|
| Preparing | `status = 'open' ∧ prepared_at IS NULL` |
| Unpaid Prepared Orders | `status = 'open' ∧ prepared_at IS NOT NULL` |
| Bills this shift | billed (`status = 'paid'`, settled bill) |

A timestamp rather than a boolean because the kitchen screen this design deliberately leaves room for wants *when it was fired*, and the append-only command log already retains every prepare/reprepare transition for audit.

The table's paired-field constraint style extends: preparation carries no attribution columns of its own — actor, tablet and shift live on the command receipt — so there is nothing to pair. Reprepare sets the column null; history is the log's job.

## D2 — Three new command types, one vocabulary

`set_order_preparation { orderId, prepared, at }` — marks prepared when `prepared` is true, reprepares when false. Guards: order exists, belongs to the commanding tablet's outlet and device, `at ≥ ordered_at`, historical shift validity as everywhere else; the order must be `open`; **reprepare is refused once the order is paid** — the bills border is terminal in that direction. Marking prepared on a paid-but-unprepared order is allowed: that is the upfront payer's path into Bills.

`void_order_payment { orderId, billId, reason }` — voids the bill with kind `counter_unpay`, then reopens the order: `status → open`, paid-attribution cleared, `bill_id` null. `prepared_at` untouched, so the card returns to whichever section it came from.

`cancel_paid_order { orderId, billId, reason }` — one atomic compound: voids the bill with kind `cancelled_after_paid` **and** cancels the order with that reason. Never two commands, so no state can observe a voided bill under a still-paid order.

Both unwinds guard: same device and shift created the payment (historical validity per the delayed-command rule), bill settled and not yet voided, order `paid`, reason non-blank, and **the commanding time within five minutes of the stored `paid_at`** — the same clock, enforced from the stored column rather than any rendered timer, that tender corrections already use. Replay semantics are the standard ones: exact replay returns the original result; identity conflict otherwise.

Schema version stays 1: canonicalisation of existing payloads is unchanged, new payload shapes join the cross-runtime hash vectors in `src/lib/billing-command.test.ts`, and the SQL mirror gains the three types in its check lists.

## D3 — Append-only grows exactly one clause, by command only

The requirement's spine holds: totals, items, clocks and attribution on a settled bill remain immutable to every writer. What changes is who may perform the existing void transition, through what door:

- Direct table updates stay impossible for every client role — including the new unwinds' authors. Only the commands perform them, inside their transaction.
- Within the window, the originating tablet's operator may fire the two unwind commands. Outside it, voiding remains the manager's reasoned act from billing history, unchanged.
- The old *"counter attempts to void"* refusal scenario splits: a counter command inside the window succeeds; a counter command outside it, or any direct write ever, is refused.

This is the change's one deliberate contract softening, and it is bounded twice over: five minutes, and originating-tablet-only.

## D4 — Structured void kinds, stamped at write time

`bills.void_kind text null`, checked against `('manager_void','counter_unpay','cancelled_after_paid')`. Legacy rows keep NULL and read as manager voids. The kind is stamped by the performing transaction — never inferred at read time from timestamps or reasons — because inference is how display logic drifts from truth.

Manager billing history renders the marker from the kind: `cancelled_after_paid` reads **Cancelled after paid** beside its existing Cancelled badge, with actor, time and reason already present from the void attribution. Totals need no change: they sum settled bills only, so every voided bill — however kinded — already drops out of Cash, UPI, combined takings and average bill.

## D5 — The workspace rearranges around what each column is *for*

```
┌──────────┬─────────────────┬─────────────────┐
│          │ BILLS TODAY     │ ● PREPARING     │
│  MENU    │ [Cash] [UPI]    │   tickets…      │
│          │ bill cards + ⏱  │ ─────────────── │
│          │                 │ ● UNPAID        │
│          │ (composer       │   PREPARED      │
│          │  overlays)      │   ORDERS        │
└──────────┴─────────────────┴─────────────────┘
```

- **Middle column**: Bills this shift by default — PaymentTotalCards on top, collapsed bills below, the five-minute countdown chip on eligible bills. The composer replaces it whenever an item is tapped (composition starts on first tap, per the billers' described flow) or an order opens for edit, and gives way again on save, settle or cancel-edit. Current Bill stops being a place and becomes a mode.
- **Right rail**: the pipeline, whole outlet visible. Preparing above the labelled divider, Unpaid Prepared Orders below. Money history leaves the rail entirely.
- Column resize persists via the existing width keys; both resize separators keep their behaviour. Both columns' shimmers reshape in this change per the standing layout rule.
- The settled confirmation toast follows the money: the paying card's arrival animation in the bills column replaces the composer-era toast's position, while keeping the self-clearing behaviour and local-reference wording.

The circular flow this produces — menu → compose (middle) → fly right to Preparing → drop to Unpaid Prepared → fly left to Bills on payment — keeps every hop between adjacent columns.

## D6 — Pipeline cards become tickets

One card component serves rail, standalone page and docked-edit variant, as today. The redesign:

- **Meta line**: customer name · reference · relative age (+ creator when not the shift holder). Total prominent top-right.
- **Items**: plain bold `N×` prefixes, full names, no truncation; **per-line prices leave the pipeline card** — the total is what gets collected, line amounts live in the composer and on the bill. Owner-flagged decision; recorded here so it can be reversed without archaeology.
- **Actions**: exactly one primary button naming the section's next step — Mark prepared on Preparing cards, Mark paid on Unpaid Prepared cards (and Mark prepared again on paid-unprepared cards, whose PAID chip sits beside the total). Everything uncommon lives behind a kebab whose menu presents 44px-tall labelled rows: Edit (unpaid only), Reprepare (unpaid prepared only), Cancel, and within the window on paid cards Un-pay / Cancel after paid.
- **Density**: p-2 padding, tightened gaps, type sizes unchanged. Target ≈100px for a one-item card so at least six stand in the rail unscrolled at landscape-tablet height.
- Line editing refuses on paid orders — database guard already implied by revise requiring `open`; the interface greys Edit and says un-pay first if items changed.

## D7 — Motion generalises the dock animation

The edit-dock already solves cross-container travel (`--dock-overhang`, non-clipping scroller, 200ms keyframe, reduced-motion suppression). This change generalises it into a FLIP layer:

1. State commits optimistically — offline-first already guarantees instant truth.
2. Origin card lifts (scale ~1.03, shadow); its slot collapses; siblings glide.
3. Destination inserts a shimmer placeholder sized to the incoming card, expanding from zero height.
4. A fixed-position ghost flies origin rect → destination rect (~280ms total budget).
5. On landing the ghost swaps for the real card, the placeholder collapses, siblings settle.

Hand-rolled with WAAPI plus a portal layer — no animation dependency enters the bundle. Rapid successive moves coalesce (last-state-wins re-measure, never a queued traffic jam), realtime-originated refreshes animate identically since the trigger is the list diff, and `prefers-reduced-motion` swaps flight for a plain crossfade, matching house convention. Placeholder shimmer is the existing `Shimmer` component reshaped to card silhouettes.

## D8 — Rename the section, not the domain

Display text becomes **Unpaid Prepared Orders** everywhere user-visible: rail heading, standalone surface, manager views, tests' labels. The URL slug `/open-orders`, the DB `status = 'open'` value, and "open order" as spec/domain vocabulary stay — the name describes the section, not the row state. The standalone subtitle stops saying "this tablet's" and states outlet scope, matching what live adapters have served all along.

## D9 — Demo parity rides along, as tasks

Four fidelity gaps close with the adapter work: mock commands all queue uniformly with provisional `Local · XXXX` references until a simulated delivery assigns numbers; the seeded pending bill drains on subscribe like the live coordinator does; open-order lists go outlet-wide with a second fabricated tablet contributing seed orders (exercising creator chips and cross-device cards); and `payOrder`/`saveOrder` stop being instant while direct bills queue. Demo-sim quirkiness observed during exploration (fixture timestamps later than the viewer's clock) is left as-is deliberately: the scenario spanning a trading day is the point.
