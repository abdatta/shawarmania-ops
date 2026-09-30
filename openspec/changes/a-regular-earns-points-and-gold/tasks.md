# Tasks: a-regular-earns-points-and-gold

> **One release, before the trial** (`design.md` D0). All of it ships before
> the Cafe's trial on 2026-09-30, is fixed the same day, and is deployed before
> it opens on 2026-10-01 (owner, 2026-09-28: customers have been promised points
> and gold from day one).

> **UI first, and the owner is a hard stop.** Section 3 is a gate, not a note.
> No migration, function, policy or spec reconciliation begins until the owner
> says the UI is settled, and the timeline needs that on 2026-09-29. Build
> sections 1 and 2 together so the owner walks all of it at once.

> **The database is built in two layers, points then gold** (D0), so a short day
> leaves a shippable points tree rather than half of both.

> **Stands on #60** (payload v3, the outlet page's Orders section,
> `set_outlet_service_settings`, settings travelling with the menu). Its
> migrations are in production as of 2026-09-28. Build on them; do not
> re-derive them.

> **The local Supabase container is shared** with other sessions. Re-reset before
> trusting a DB gate. If Docker will not start, see the stale-socket note in the
> owner's memory before losing an hour to it.

## 1. Points, against the mock only

- [x] 1.1 Mock adapter: per-outlet points settings, a per-(outlet, customer) ledger, earning at settlement (D6), a points bill-discount row (D7), reversal on void (D11), and the lookup's `points_balance` net of open orders (D10). The mock refuses what the boundary refuses (D8) as `malformed`, so the demo cannot accept what the database will not.
- [x] 1.2 The outlet page's **Loyalty** section, **Points half only**, beside #60's Orders and built the same way: one switch until on, options inside their tile, one Save with #60's saved treatment. Earn (points per ₹), gold rate (*Same rate* / *Their own rate*), and the two caps. Defaults on first switch-on: 5 per ₹200, same rate, 10% / 50%. Behind a part gate `outlet-points` in `src/gates/registry.ts`, as #60 did with `outlet-service-choices`.
- [x] 1.3 The counter: the balance on the customer's card in the dialog, large on the right (owner, 2026-09-29; the first cut also put it on the composer's customer row, which the owner removed). A remembered balance reads as remembered.
- [x] 1.4 **Use N points** beside **Add discount** on the composer (owner, 2026-09-28/29), saying the points this bill can take, opening its own pad pre-filled with them: *Balance* and *Max this bill* (with its share, *10% off*) as plain figures, **Back** and **Use points**, and over-the-max said inside the readout. The row reads *Points (20)*. Disabled with a one-line reason when the balance is not fresh from the server (D10). Lowered automatically when the order shrinks below it, back up to what was asked when it grows; removed when the customer changes or is skipped. *(A clickable Max tile and a one-tap Use max were built and dropped at the checkpoint.)*
- [ ] 1.5 *(Sketched for the checkpoint in chat; built with section 4, since the page renders fields the reader does not return until 4.11.)* The receipt, **in the landing repository** as a sibling change (D14): the *Points (20)* discount row and *Points used*, *Points earned*, *Points balance* beneath the discount rows when the bill has them, on the page and in the PDF. Widen the Worker's `source` type to include `'points'` (and `'packaging'`, which #60 already sends). Show the owner a rendered sample at the checkpoint.
- [x] 1.5a *(Done 2026-09-29: the owner left the wording to the agent; published from the landing repository, `6a4729d`.)* **The privacy page amendment, in the landing repository** (D16): points and gold as uses of the number, per outlet; the *"costs more or less"* sentence replaced; gold described as a spending rule; removal forfeiting balance and gold. Draft it for the owner to approve at the checkpoint.
- [x] 1.6 Demo fixtures: an outlet with points on and one with them off; a customer with a balance, a gold member (by #57's hand grant) to show the higher cap, a customer at nought, and one with a negative balance from a void.
- [x] 1.7 Both themes; the settings at phone width, the counter at tablet width, the receipt on a narrow phone.
- [ ] 1.8 SECTION GATE: at `/demo`, switch points on, ring a bill for an identified customer and read what it earned on the receipt; use points up to the cap on a second bill and up to the gold cap on a gold member's; void one and watch the balance return. *(Walked 2026-09-28 at `/demo` except the receipt, which is 1.5's: the settings, Moumita's 36 points, Upgrade to Gold, and 36 points on a ₹278 bill for a gold member. Earning, reversal and the refusals are pinned in `src/data-access/mock/loyalty.test.ts`.)*

## 2. Gold per outlet, against the mock only

- [x] 2.1 Mock: memberships per outlet with `expires_at` and `granted_via`; eligibility (D3, **at least** the threshold, paid bills at this outlet, business dates); the counter grant (D4) refused when not eligible, idempotent on a second tap; management grant and revoke for any customer the outlet served; rename keeping #57's whole-history rule.
- [x] 2.2 The Loyalty section's **Gold members** half, its own switch: *Valid for N months*, *Allow billers to upgrade to Gold* and its *Gold eligibility* (min monthly spend, 30 days fixed), and a copy of every gold-only setting from the other sections as one value (owner, 2026-09-29). Defaults: 6 months; ₹2,000 a month.
- [x] 2.3 The counter: *Eligible for gold* and **Upgrade to Gold** on an eligible customer's card, with no figure beside it; a confirmation reading *Check with the customer first. Once upgraded, their Gold is valid until* **date**, with **Upgrade**; nothing offered offline, with the reason; no revoke.
- [x] 2.4 The Customers page, outlet-scoped with the remembered outlet chips; the card's *Gold until …*, balance here, and how gold was given; the gold list's end dates and its *Recent visits* order.
- [x] 2.5 Fixtures: an eligible customer, a lapsed gold member who is eligible again, a counter-granted member, a hand-granted one.
- [x] 2.6 Both themes; phone width for the owner, tablet width for the counter.
- [ ] 2.7 SECTION GATE: at `/demo`, a customer crosses the threshold, the biller upgrades them to Gold, the owner sees the end date and who gave it, the clock moves past it, the star goes and the offer returns. *(Walked 2026-09-28 up to the end date; the lapse is Moumita's seeded spell and `goldInForce` in `src/domain/loyalty.test.ts`, not a clock moved in the demo.)*

## 3. 🧍 OWNER CHECKPOINT — STOP HERE

- [x] 3.1 Hand the owner the whole demo on 2026-09-29: the Loyalty settings, the counter's balance, **Use points** and **Upgrade to Gold**, a rendered receipt sample, the outlet-scoped Customers page, **and the privacy page wording** (1.5a). Iterate on sections 1 and 2 as they ask.
- [x] 3.2 Record in `design.md` what changed from the sketch. *(First round, 2026-09-29: gold is its own switch, a multiplier, a gold cap line never below everybody's, the relabels and the fixed 30 days — recorded in D12 and the Decisions.)*
- [x] 3.3 CHECKPOINT GATE: the owner says the UI is settled. **Settled 2026-09-29** after rounds on the settings (gold as its own switch, a points multiplier, gold settings shown twice, the relabels), the counter's customer card (balance on the right, *Eligible for gold*, *Upgrade to Gold*) and the Use points pad. The privacy page wording (1.5a) is still the owner's to approve.

## 4. Points in the database

- [x] 4.1 Failing tests first, in a new `supabase/tests/` file: earning (proportional, rounded down, on the bill after other discounts and before points, the gold rate when set), using, reversal on each `void_kind`, retries earning once, negative balances, `balance_after` under two concurrent bills, and the open-orders deduction in the lookup. *(`supabase/tests/66_a_regular_earns_points_and_gold.sql`, 94 assertions. `balance_after` under concurrency is in the REST race suite, `zz-billing-command-races.test.ts`, since one pgTAP session cannot race itself: a manager's void racing a sale for the same customer, checked as an unbroken chain of `balance_after`. It fails with the advisory lock removed and passed 3 of 3 with it. Two sales cannot race there at all — each holds the outlet's bill-number counter row until commit.)*
- [x] 4.2 Settings columns on `outlets` with their checks (D12, points half) and `set_outlet_loyalty_settings`, authorised as #60's function is. Assert every existing outlet is all off. `outlets_update` is not widened. Refusal cases: another outlet's FA, a Biller, an Employee and a device, each by hand-crafted request.
- [x] 4.3 `discount_row_source` and the `source` column on `order_discounts` and `bill_discounts`, default `'biller'`, with the points-row checks (D7): amount basis, whole rupees, `value_paise = amount_paise`, at most one per parent, only with a customer.
- [x] 4.4 `customer_points_entries` (D5): table, kind enum, `unique (bill_id, kind)`, the append-only guard, the (outlet, customer) index, RLS with the select policy, and **its isolation test** (the other outlet's FA, Biller and device read nothing, by hand-crafted request). Classify it in `01_schema_coverage.sql`.
- [x] 4.5 The deferred earning trigger on `bills` (D6): `used` then `earned`, under the advisory lock, storing the rule it used. Settings read at acceptance.
- [x] 4.6 The void trigger (D11): `earned_reversed` and `used_returned` in the voiding transaction.
- [x] 4.7 The boundary (D8): accept payload v4, check a points row's shape and refuse as `malformed` otherwise; **do not** check balance or cap. Accept v1 to v3 unchanged.
- [x] 4.8 Payload v4 (D9): `source` on bill-level discount entries, `BILLING_COMMAND_SCHEMA_VERSION = 4`, new shared vectors for the canonical JSON and hash across both runtimes, existing vectors still passing, and a points case in `lint:discount-rows`. *(The vector is in `src/lib/billing-command.test.ts` and section 0 of test 66. `lint:discount-rows`' case table is line-level menu grouping, which a points row never enters, so the points row's receipt sum is asserted in test 66 section 5 instead. Every version-4 entry states its source, the biller's included: a key left undefined would not survive canonical JSON.)*
- [x] 4.9 The lookup (D10): `customer_lookup_by_phone`, `customer_suggest_at_outlet` and `customer_create_or_get` add `points_balance` for the caller's outlet, net of points on that customer's open orders there, null when points are off. The gold column keeps #57's name, `is_member`, and section 5 makes it this outlet's. Nothing else in either boundary moves.
- [x] 4.10 The live adapters: settings read and write, the lookup's new field, the v4 payload, and the receipt's figures from the bill's ledger rows. The resume record carries the balance and the settings.
- [x] 4.11 The public reader: `bill_public_receipt` returns the bill's three ledger figures and nothing else about the customer; `bill_public_discount_rows` returns a points row with `source = 'points'` among the bill's own rows, so the printed rows still sum to the stored discount. Extend `supabase/tests/51_the_public_receipt_reader.sql`.
- [x] 4.12 Regenerate schema types and commit the diff.
- [x] 4.13 SECTION GATE: a bill earns once however often it is retried; a points row the boundary accepts is reflected in the ledger; a void reverses both; two concurrent bills leave a consistent `balance_after`; the other outlet reads nothing; and a till holding v3 work settles it exactly once.

## 5. Gold in the database

- [x] 5.1 Failing tests first: a spell per outlet; current by `expires_at`; one current spell per customer per outlet under concurrent grants; eligibility at exactly the threshold, one paisa under, a voided bill, a bill outside the window; the counter grant refused when not eligible and when it is another outlet's customer; the tier snapshot reading the order's own outlet.
- [x] 5.2 Migration: assert `customer_memberships` is empty (it is in production as of 2026-09-28, and `seed.sql` runs after migrations), then add `outlet_id not null`, `expires_at not null`, `granted_via`, `counter_device_id`; reclassify the table as outlet-scoped; add its select policy and **its isolation test**.
- [x] 5.3 Gold settings columns (D12, gold half) and their checks, written by `set_outlet_loyalty_settings`.
- [x] 5.4 `customer_tier_at(customer, outlet, instant)`, and the snapshot trigger passing the row's outlet. Prove an order at one outlet does not read gold granted at another.
- [x] 5.5 `customer_gold_grant_at_counter` (D4): outlet from the caller, eligibility re-derived in the transaction, operator and device recorded, idempotent by outcome. Refusal cases by hand-crafted request: ineligible, another outlet's device, an Employee, a revoke attempt from any counter principal.
- [x] 5.6 Management grant and revoke take an outlet; the owner and that outlet's FA; any customer that outlet served. Rename keeps its whole-history condition.
- [x] 5.7 The lookup: `is_member` becomes this outlet's, and `gold_eligible` is added. Nothing else moves.
- [x] 5.8 Management reads take one outlet (D13); the card's end date, balance and grant source; the gold list's end dates and *Recent visits* order. The index on `bills (outlet_id, customer_id, business_date)`.
- [x] 5.9 Live adapters; resume record carries the tier and `gold_eligible` for display; behind a part gate `counter-gold` alongside `outlet-points`.
- [x] 5.10 Regenerate schema types and commit the diff.
- [x] 5.11 SECTION GATE: gold at one outlet is invisible at another; it lapses on its stored date; the counter grants only to the eligible and never revokes; the manager changes gold for their outlet's customers and renames only those served nowhere else; every refusal proved by hand-crafted request.

## 6. Ship it before the trial

- [x] 6.1 Run `npm run format`, then `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`, `npm test`, `contrast`, `build`, `test:e2e`.
- [x] 6.2 `npm run db:start && npm run db:reset`, then `test:db`, `test:rls`, `test:e2e:auth`, in that order; `db:types` and a clean diff. *(2026-09-29: 2902 pgTAP, all REST suites, 33 auth end-to-end. Two auth specs were written against business-wide gold and were brought to per-outlet gold: `customers.spec.ts` opens the page on Kalyani by address and switches its gold on for the round trip, and `billing-served.spec.ts` grants gold to the seed's customer Kalyani has served.)*
- [ ] 6.3 Offline, on the preview: identify a customer, go offline, ring and pay bills; confirm **Use points** and **Upgrade to Gold** are refused offline; reconnect; confirm every bill settles once and earns once.
- [ ] 6.4 *(Both gates promoted 2026-09-29; the demo walk and the owner's push remain.)* Promote `outlet-points` and `counter-gold` to live, and walk the demo once more to confirm it still walks. Hand the owner the push; **the owner picks the moment** (no outlet trades until 2026-10-01, which is why this window is the safe one).
- [ ] 6.4a Deploy the landing sibling (receipt rendering and the amended privacy page) **after** the ops migration is live, and open a real trial receipt to confirm the points row reads *Points (…)* and the figures match the bill.
- [ ] 6.5 🧍 The owner reloads the Cafe tablet onto the new build and switches points and counter gold on at **Kalyani Cafe only**, with the owner's numbers. Kalyani stays off.
- [ ] 6.6 🧍 Trial, 2026-09-30: earn, use, void, receipt, offline, and a customer crossing the threshold and upgraded to Gold at the counter, on the real tablet. To see the gold path without ringing ₹2,000, the owner may lower the threshold for the trial and restore it afterwards. Use phone numbers that will not be real customers, or delete the trial's ledger rows before the first real bill (`design.md` D15). Fix anything found the same day, rerun 6.1 and 6.2 on the fixes, and hand the owner the push before the Cafe opens on 2026-10-01.

## 7. Docs, demo and phase gate

- [x] 7.1 Walk the four-role demo end to end; update `docs/DEMO_MODE.md`. *(2026-09-29, on the preview: the owner's Customers on Kalyani, a card's balance, an upgrade reading *Gold until 30 Mar 2027*; the counter's balance, *Eligible for gold*, the counter upgrade and its confirmation, *Use 48 points* for a gold member and the *Points (48)* row. The walkthrough was corrected where it named the wrong customers.)*
- [x] 7.2 Update `docs/BUSINESS_CONTEXT.md`, `docs/GLOSSARY.md`, `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/SCREENS.md`, `docs/OFFLINE_AND_SYNC.md` and `docs/LIMITATIONS.md` as the proposal lists. `LIMITATIONS.md` gains: the unverified phone; settings read at acceptance for an offline bill; a negative balance after a race; the stale `balance_after` after deleting a customer's early rows.
- [x] 7.3 Add a **Configuration Surfaces** row to `openspec/changes/ROADMAP.md`: an outlet's loyalty rules, set in the Loyalty section by the owner or the outlet's manager, all off by default.
- [x] 7.4 Narrow `openspec/todos/customer-loyalty-and-cross-outlet-insights.md` to what remains, and confirm `lint:todos` passes.
- [ ] 7.5 Add the `customer-points` entry to `openspec/specs/README.md` **at the archive step**, when the directory exists, so `lint:specs` passes.
- [ ] 7.6 Rerun every gate in 6.1 and 6.2 against the final tree.
- [ ] 7.7 🧍 A real customer earns and uses real points at Kalyani Cafe, and a real eligible customer is upgraded to Gold at the counter. Tasks complete is not the archive trigger; real use is.
- [ ] 7.8 PHASE GATE (#62): a customer who gives their number at an outlet that has switched points on earns points on every bill they pay there, in proportion to what they paid before any points were used, and sees what they earned, what they used and what they hold on their own receipt; a biller sees that customer's balance at this outlet, uses some or all of it on the bill in front of them up to the outlet's cap (a higher cap for gold members), and cannot use points the tablet has not just read from the server; a biller sees that a customer is eligible for gold here, without seeing how much they spent, and upgrades them to Gold at the counter once the customer agrees; gold belongs to one outlet and ends on the date its grant stored; a voided bill takes back what it earned and returns what it used; every earn, use, reversal and grant is a stored row naming the bill, the till and the person; the owner and the outlet's own managers set every number on the outlet's own page, and a new outlet starts with all of it off and bills exactly as today; every such bill rung offline settles exactly once; the owner settled the counter and the settings in the demo first; and the four-role demo walkthrough still walks.
