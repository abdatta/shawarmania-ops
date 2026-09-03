> **Sequencing.** #35 `multiple-billing-devices` must be archived before section 5
> writes its `counter-billing` delta, because that delta reverses a requirement
> #35 restated on 2026-09-02 and both changes edit the same paragraph. Nothing in
> sections 1 to 4 depends on it.

> **Test-first, per the roadmap's protocol for money work.** Every database rule
> in sections 1 and 2 is written as a failing test before the migration, function
> or policy that satisfies it.

## 1. The Arithmetic, Once, In All Three Places

- [x] 1.1 Write the failing tests first: the identity `total = subtotal − discount + tax + rounding` on both `orders` and `bills`, the discount cap at subtotal, the whole-rupee total, the ₹1 floor, and the per-line ceiling `discount_paise <= line_total_paise`.
- [x] 1.2 Extend `billTotals()` in `src/domain/billing.ts` with the discount cap, the rounding line and the ₹1 floor, keeping every value integer paise and keeping the existing refusal of a fractional input. Replace the current unconditional `RangeError` on an oversized discount with the cap, and keep a refusal for a discount that is negative or not integer paise.
- [x] 1.3 Add `rounding_paise` to `orders` and `bills`, `not null default 0 check (rounding_paise between 0 and 100)`, and **assert in the migration that every existing row satisfies the new identity** before dropping and recreating `orders_total_arithmetic` and `bills_total_arithmetic`.
- [x] 1.4 Extend `billing_validate_totals` with the rounding term, the whole-rupee rule and the ₹1 floor, and prove it agrees with `billTotals()` on a shared table of cases including a fractional percentage, a full discount and an exact rupee.
- [x] 1.5 Prove the three definitions cannot drift: one fixture of orders exercised through the pure function, through a direct insert, and through a command, all three agreeing. **Two of the three legs are here; the command leg moved to 3.4.** `src/domain/billing-totals-cases.json` is the one case table, read directly by `billing-totals-agree.test.ts` and copied into `47_bill_discount_arithmetic.sql` between generated markers, where the same rows are put through both the check constraints and `billing_validate_totals`. `scripts/check-totals-cases.mjs` (wired into `npm run lint` as `lint:totals`, and recorded in `AGENTS.md`) fails when the copies drift and prints the block to paste; it also refuses a case that does not satisfy the identity, because a broken fixture is worse than none. The command leg needs the payload to carry `roundingPaise` at all, which is 3.1, so it is proved there against both payload shapes rather than stubbed here.

## 2. What A Discount Is, In The Database

- [x] 2.1 Add `category_name`, `discount_paise` and `discount_percent_bp` to `order_items` and `bill_items`, with the per-line ceiling check. Backfill `category_name` where the live menu still resolves it and leave it null where it does not, rather than guessing. **Landed in the arithmetic migration**, since the line ceiling is part of the same identity.
- [x] 2.2 Add `order_discounts` and `bill_discounts` modelled on `bill_payments`: append-only, insertable only through a billing command, immutable afterwards, with the basis and value paired by check so a percentage row cannot carry a rupee value or the reverse.
- [x] 2.3 Add the constraint trigger asserting that line discounts plus bill-level discount records equal the parent's `discount_paise`, deferred like `bill_payments_total_guard` so a multi-row write commits or fails whole.
- [x] 2.4 Add `menu_discounts` and `menu_discount_categories`, with the active flag and the category set.
- [x] 2.5 Add the two price-floor triggers: a rupee menu discount refused above the cheapest item in its categories, and an item refused a reprice or a category move that would put it below an active rupee discount reaching it.
- [x] 2.6 Add `outlets.discount_preset_bp integer[] not null default '{1000,1500,2000}'` with a length check of at most four and a range check on each element.
- [x] 2.7 **Isolation-suite cases for every table added here** — `order_discounts`, `bill_discounts`, `menu_discounts`, `menu_discount_categories` — proving an FA, a Biller and an Employee are each refused another outlet's rows by a hand-crafted request, and that a Biller is refused every menu-discount write at their own outlet.
- [x] 2.8 Regenerate schema types and commit the diff.
- [x] 2.9 SECTION GATE — the model holds at the database: a discounted order and a discounted bill round-trip with their parts summing to their whole, a rupee discount above the cheapest item is refused both ways, a full discount produces a ₹1 bill, and every new table refuses the neighbouring outlet.

## 3. The Command Boundary, Across The Change

- [x] 3.1 Add `discounts` and `roundingPaise` to `OrderContentPayload` and `PayNowPayload` in `shared/billing-command.ts`, and take `BILLING_COMMAND_SCHEMA_VERSION` to 2.
- [x] 3.2 Teach the boundary to accept **both** payload shapes and **both** schema versions, reading the earlier shape as no discounts and no rounding, and extend the reconciliation checks to the transmitted discount records.
- [x] 3.3 Extend the cross-runtime canonical-JSON and SHA-256 vectors in `src/lib/billing-command.test.ts` to cover both shapes, since client and database are two implementations of one rule.
- [x] 3.4 Prove the offline crossing directly: capture commands under the earlier shape, apply the migration, then drain — each settles exactly once, none is refused as malformed or unsupported, and a replay returns its original result.
- [x] 3.5 SECTION GATE — a till offline since before the release settles its whole day afterwards, unchanged and exactly once.

## 4. Setting Discounts On The Menu Screen

- [x] 4.1 Menu adapters for creating, listing and removing menu discounts, and for reading and writing the outlet's presets, on both the mock and the Supabase side, typed from the generated schema.
- [x] 4.2 The **Set Discounts** dialog: basis, value, and a category multi-select with select-all, adding one discount at a time, with the existing ones listed and each separately removable. The words sale, offer and promotion appear nowhere.
- [x] 4.3 Preset configuration on the same surface, none to four, ordered, defaulting to 10/15/20, with the fifth refused.
- [x] 4.4 Surface the two price-floor refusals in the item form and the discount dialog in words that name the constraint, with the database still the boundary.
- [x] 4.5 Carry the outlet's active discounts and presets in the menu read, the realtime change signal and the persisted resume-record snapshot, so they reach both tills on the two existing triggers and survive a cold start offline.
- [x] 4.6 SECTION GATE — a manager sets two discounts at different values over different categories, both tills pick them up with no reload, and a till cold-started with no backend sells under the ones its snapshot carried.

## 5. The Counter

> Needs #35 archived. See the note at the top of this file.

- [x] 5.1 Write the `counter-billing` delta against the post-#35 text, reversing the no-discount clause and removing its `No discount is offered` scenario.
- [x] 5.2 The discount panel: readout starting at nought with its unit, unit switching without clearing, keypad of one to nine with a decimal point, a centred nought and a backspace, no double-nought, no resulting total, and the outlet's presets on one unwrapped row.
- [x] 5.3 The **Add discount** control below the lines in the bill column, on both the compose path and the edit-a-saved-order path.
- [x] 5.4 Discount rows in the bill column: menu rows grouped by value with their categories as subtext, `All Items` where every category is covered, bill rows saying `On this bill` and carrying edit and delete, and the rounding as its own row above the total.
- [x] 5.5 Menu discounts frozen at the counter: shown, never editable, never removable, refused at the database for good measure.
- [x] 5.6 Ownership: the neighbouring till reads a discount and is refused the control, locally and by a hand-crafted request, inheriting #35's rule rather than adding a predicate.
- [x] 5.7 Reshape the bill panel's shimmer for the rows the column now holds, per the standing rule that a placeholder reserves the shape of what is arriving. **Nothing to reshape.** The counter deliberately places a placeholder over the menu pane only — "the bill panel beside it is the write path and is never replaced by a placeholder" — and the rows this change adds live entirely in the bill column. The menu grid silhouette is unchanged because the tiles are. Recorded rather than skipped silently.
- [x] 5.8 SECTION GATE — a biller discounts an order in percent and in rupees, several times, edits and removes their own, cannot touch the owner's, and the resulting bill totals a whole rupee.

## 6. Reading What Was Given Away

- [x] 6.1 The day's discount section on the Ledger, derived on read, naming nought explicitly rather than being absent, and excluding voided bills as their sales are excluded.
- [x] 6.2 The month's discount section beside the revenue it qualifies, carrying the ceiling qualification where the revenue carries it, and absent where the month has no billed date.
- [x] 6.3 Manager bill detail and billing history show the discount lines, their bases and the rounding, so a queried bill explains itself.
- [ ] 6.4 The biller's own shift totals report what that shift gave away. **NOT BUILT — awaiting the owner's call, not blocked.** The argument for leaving it out: My shift exists so a biller can reconcile the cash in the drawer against the tender split, and a giveaway figure answers a question the owner asks rather than one the biller can act on. Every discount is already attributed to the shift that applied it, so the manager's history can report it either way. The argument against: it is a small addition and a biller may reasonably want to see what their own shift gave away. **Left unchecked deliberately, because a ticked box means built and this is not.**
- [x] 6.5 SECTION GATE — a day and a month each carrying discounts read as promotions rather than as slumps, and a three-month-old discounted bill explains itself with no menu consulted.

## 7. Demo, Docs And Phase Gate

- [x] 7.1 Mock adapter and demo fixtures carry menu discounts, bill discounts and rounding, so the demo shows the feature rather than hiding it, and a fixture the database could not serve still fails to compile.
- [x] 7.2 Update `docs/BUSINESS_CONTEXT.md` (the discount paragraph and the round-rupee price claim, both now false), `docs/DATA_MODEL.md` (the arithmetic invariant gains its rounding term), `docs/SCREENS.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md` — removing the discount half of **No discounts or partial payment in billing v1** and keeping the partial-payment half.
- [x] 7.3 Add the `bill-discounts` entry to the capability index in `openspec/specs/README.md` when archiving. **Deliberately left for the archive step**, because `lint:specs` checks the index against the directories under `openspec/specs/`, and that directory does not exist until the delta is merged. Adding the line now turns the lint red for as long as the change is open.
- [x] 7.4 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then look at the counter and the Menu screen on a tablet viewport and a phone viewport, in light and dark.
- [x] 7.5 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`, in that order.
- [x] 7.6 Exercise the offline path end to end: discount offline, queue, reconnect, settle exactly once with no duplicate.
- [x] 7.7 PHASE GATE — a biller adds a discount to the order in front of them from a keypad panel that opens the way Mark Paid does, in percent or in rupees, several times over, editing and removing their own and never the owner's; the owner sets a percent or rupee discount across any set of categories from the Menu screen, several such discounts at once, and every till selling under them picks them up without anybody reloading; each discount reads on the bill as its own line saying what it was, and stays readable that way for a bill settled three months ago with no menu history consulted; every bill ends on a whole rupee, rounded up on its own stated line, and never below ₹1, so a fully discounted meal is a ₹1 bill visible in the day's takings; a rupee menu discount cannot be set above the cheapest item it covers and that item cannot later be repriced beneath it, both refused by the database; the day and the month each report what was given away; commands queued by a till before this change still settle exactly once afterwards; and the four-role demo walkthrough still walks.
