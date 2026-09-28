# Tasks: each-outlet-chooses-how-it-serves

> **Sequencing.** `outlets-one-at-a-time` built the one-outlet page these
> settings sit on, and #57 `a-gold-member-is-a-label` is archived; nothing
> upstream blocks this change.

> **UI first, and the owner was the hard stop.** Sections 1 and 2 are done: the
> owner settled the settings page and the counter on 2026-09-27, in two rounds
> (`design.md`, Decisions). Build sections 3 onward to that design, and change it
> only if the owner does.

> **The live counter must not move until section 5.** Until then the live
> outlets adapter reads all-off and refuses the write, and the Orders section is
> behind the `demo` part gate `outlet-service-choices`.

> **Money, offline and the command boundary are all in play here.** None of it is
> quickfix-lane work, and the full local gate set, including the Docker job, runs
> before anything is pushed. The owner picks the deploy window: commit locally
> and let them choose when it ships.

## 1. The Settings And The Counter, Against The Mock Only

- [x] 1.1 The six settings of design D1 on the typed adapter interface and the mock, with the mock enforcing the checks the database will. Demo fixtures: Kalyani, where the demo counter stands, has chosen nothing; Kanchrapara has everything on (both types, table numbers, ₹5 per bag, free for gold). The live adapter reads all-off (Demo first).
- [x] 1.2 The **Orders** section on the outlet's page, between Details and Tablets (D10): one switch for a newcomer; each option opening inside its own tile on alternating tones; at least one type stays offered; *Table numbers* while dine-in is offered; *Packaging charge* inside takeaway's reach, flat per order first and default, a whole-rupee price, free for gold. One Save for the section, with its acknowledgement. Behind the `demo` part gate `outlet-service-choices`.
- [x] 1.3 A manager changes the section for the outlets they manage, as the owner does [owner, 2026-09-27, reversing the 2026-09-26 read-only answer]; Details stays the owner's.
- [x] 1.4 The composer's type chips, on a row above the customer control, only where there is a choice (D9); nothing preselected; the answer owed before Order or Paid; tapping a chosen chip takes it back. No chip at a one-type outlet, whose every order is that type.
- [x] 1.5 The table pad (D9), opened the way the customer keypad opens: 1 to 999, no `.`, `00` or leading nought, *No table* and *Done*. A table already open is refused in red in one line, with **Edit here** to its order behaving exactly as the card's Edit (D5). The chip then reads *Table 4* or *No table*, and tapping it reopens the pad.
- [x] 1.6 The packaging line, *Packaging* in both modes: on every takeaway order and no other, last among the lines, one bag to start (per bag) or one flat line; never removed or repriced by the biller, the bag count going down to one; taken off when the order stops being takeaway. It captures the price in force when added.
- [x] 1.7 The gold waiver: struck-through price and *Free* when the customer the tablet knows is gold and the outlet waives. It follows the customer while the order is open.
- [x] 1.8 *Table 4* **replaces** the order number on the composer's editing header, the pipeline card and Bills this shift; a card without a table says *Takeaway* or *Dine-in*. Two open orders at one table read *1 of 2* / *2 of 2*. Manager bill detail shows the type and table beside the order and bill numbers.
- [x] 1.9 The demo walkthrough (`docs/DEMO_MODE.md`) covers: turning each switch on at Kalyani and seeing the page grow; a manager changing it; a takeaway with two bags; a gold member's takeaway with the waiver, then skipping that customer; a dine-in order at a table; keying a busy table and taking *Edit here*; paying the table's order and the table freeing.
- [x] 1.10 SECTION GATE: at `/demo`, on phone and tablet widths in both themes, every step in 1.9 walks. At the all-off demo outlet the counter is indistinguishable from today's.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [x] 2.1 Hand the owner the demo and let them walk it. Expect several rounds, and iterate on section 1 as they ask.
- [x] 2.2 Record in `design.md` what the owner settled, with the date, and what changed between the sketches and the settled UI. Update the spec deltas where a settled answer changes a requirement's wording.
- [x] 2.3 CHECKPOINT GATE: the owner states the settings page and the counter are settled. Nothing below begins before this.

## 3. The Settings In The Database

- [x] 3.1 Failing tests first (pgTAP, `supabase/tests/62_each_outlet_chooses_how_it_serves.sql`): every outlet defaults to all-off, a new one included; each inconsistent combination of D1 is refused by the table itself (table numbers without dine-in, packaging without takeaway, a charge without a price, a price without a charge, part-rupees, below ₹1, a gold waiver without a charge) and a whole-rupee price has no ceiling; the owner writes any outlet's settings and a manager their own outlet's, through `set_outlet_service_settings`; the other outlet's manager, a biller, an employee and a counter device are each refused it; a manager's direct update of the row — the settings, the cutover, the fence — still touches nothing.
- [x] 3.2 The migration: the `packaging_mode` enum and the six columns on `outlets` with their checks (D1), and `set_outlet_service_settings` (RLS) as the one write path a manager has. `outlets_update` is not widened. Existing outlets take the defaults, and the migration asserts none ends it with anything on.
- [x] 3.3 The counter device's read (D6). Checked: `outlets_select` already lets a device read its own outlet row, so no read function is needed. Isolation cases: a device reads its own outlet's settings and nothing of the other outlet's; a person reads nothing of an outlet they do not work at. (The first draft of this task said an employee reads nothing; the spec gives the settings the outlet row's readers, and an employee reads their own outlet's row.)
- [x] 3.4 Regenerate schema types and commit the diff. The mock's outlet fixtures are typed from the schema, so they now carry the six columns: Kalyani and the closed outlet all-off, Kanchrapara everything on (the one departure from `supabase/seed.sql`). The demo store's slice is seeded from those rows through `serviceSettingsFromRow` (`src/data-access/outlet-service-row.ts`), which the live adapter reuses in 5.1. `vitest.rls.config.ts` gained the `@` alias the other adapter phases already declared: the outlets adapter now resolves `@/domain`, and without it three adapter probes failed to load.
- [x] 3.5 SECTION GATE: `test:db` and `test:rls` green from a fresh reset; the owner and a manager of that outlet each round-trip every setting, and every other principal is refused every write.

## 4. Orders And Bills Carry How They Were Served

- [x] 4.1 Failing tests first: service facts are snapshotted and fixed at payment; `table_number` is refused without dine-in and outside 1 to 999; the bill copies the order's; `kind` defaults to item; at most one packaging line per order and per bill; a packaging line with a menu id, a category, or a partial discount is refused; a full waiver counts in the parent's discount and passes every existing parts-equal-the-whole guard; a second open order on the same table **is accepted** (D5).
- [x] 4.2 The migration: the `service_type` enum, `service_type` and `table_number` on `orders` and `bills`, the `line_kind` enum and `kind` on `order_items` and `bill_items`, and the partial unique indexes (D2, D3).
- [x] 4.3 `orders.table_shared` (D11): failing tests first — two open orders seated at one table by create, by revision and by a payment taken back each set it on both orders and on no other; paying or cancelling never unsets it; the same table number at another outlet never sets it. Then the column, set by the command boundary in the write's own transaction. Add both D11 queries to `docs/OPERATIONS.md`. Done as a trigger on `orders` (`orders_mark_shared_table`), which the create, the revision and the payment taken back all reach inside their own transaction; see design, Decisions 2026-09-28 item 4.
- [x] 4.4 The command boundary (D7, D8): accept payload v3; check service facts for shape only; check a new packaging line's name and price against the outlet's packaging charge by the same rule and timing as a new menu line. **Read what the menu path does when an offline tablet's captured price no longer matches, apply the same, and record it in `docs/LIMITATIONS.md`.** Existing packaging lines are compared by identity. Read: a new line not matching the current menu is a terminal `arithmetic_invalid`, and the live counter re-sends every line as new on every save, so a price change refuses edits and offline work carrying the old price. Recorded in `docs/LIMITATIONS.md`; design D8.
- [x] 4.5 `shared/billing-command.ts`: `BILLING_COMMAND_SCHEMA_VERSION` to 3, and the v3 shape. The boundary still accepts v1 and v2 as *neither, no table, every line an item*. Cross-runtime canonical-JSON and hash vectors for v3; the v1 and v2 vectors keep passing.
- [x] 4.6 `lint:discount-rows`: add the waiver case (a full-line discount on a packaging line, alongside a bill discount) to the shared cases, so both runtimes agree. Confirm `lint:totals` needs no new case because the identity did not move. `groupMenuDiscounts` itself now leaves packaging out, so the counter no longer filters before calling it; the receipt gives the waiver its own `packaging` row.
- [x] 4.7 Isolation cases for the new columns: a neighbouring outlet's manager and device cannot read another outlet's orders' type, table or `table_shared`, or its lines' kind.
- [x] 4.8 Regenerate schema types and commit the diff.
- [x] 4.9 SECTION GATE: a v3 order with a table, two bags and a waiver round-trips create, revise and pay at the database. A v1 and a v2 command queued before the release each settle exactly once. The full DB and RLS suites are green from a fresh reset. `supabase/tests/63_orders_carry_how_they_were_served.sql` (103 assertions) holds it. Building this section found three defects already in production (design, Decisions 2026-09-28), each fixed and pinned.

## 5. The Counter Goes Live

- [x] 5.1 The live outlets adapter reads the six columns and writes through `set_outlet_service_settings`, mapping each check's refusal to its problem code; the live menu read carries `service`; promote the part gate `outlet-service-choices` from `demo` to `live`. Per AGENTS.md this **does not redesign the screen**: if it has to, the mock was the wrong shape, so fix the mock and record why. The refusal mapping reads the check constraint Postgres names; `supabase/tests/rest/outlet-service-settings.test.ts` drives the real adapter as owner and manager and pins that name as a contract. The screen did not change.
- [x] 5.2 The live billing adapter writes and reads the v3 facts: `serviceType`, `tableNumber`, line `kind`, the waiver, and the table sharing the pipeline marks. Reads carry `service_type`, `table_number` and `kind`; every local view drawn from the queue now goes through one `lineDrafts` helper. That fixed a fourth, display-only defect: a restarted tablet redrew an offline-revised order without its line and bill discounts.
- [x] 5.3 Settings reach the counter on its menu refresh and in the resume record (D6). A cold-started offline tablet serves its outlet's types, table numbers and packaging. The live menu read already fetched the outlet row for its presets; `service` rides the same read and the resume record persists `OutletMenu` whole. The tablet's read is pinned over REST.
- [x] 5.4 The client computes the packaging line and waiver in `billTotals()` territory with integer paise only, and the float guard still throws. Already pinned in section 1: `packagingLine` computes through `lineTotalPaise`, and a part-paise price throws `NotPaiseError`.
- [x] 5.5 Offline path, exercised for real rather than asserted: go offline, ring a dine-in order at table 3, a takeaway with two bags, and a gold member's takeaway with the waiver. Revise one, pay two, come back online, and confirm each settles exactly once with its type, table, lines and waiver, and no duplicates. `e2e-auth/billing-served.spec.ts`, against the local stack.
- [x] 5.6 Two tablets: seat table 4 on each while one is offline, reconnect, and confirm both orders are recorded, both read *Table 4* marked *1 of 2* / *2 of 2*, and both carry `table_shared` (D5, D11). Same spec; the two-till helpers moved to `e2e-auth/tills.ts` so both specs share one copy.
- [x] 5.7 Run the full gate list from `AGENTS.md`, including the Docker job and `test:e2e:auth`. Green run alone on 2026-09-28: lint, format, typecheck, functions typecheck, unit (2026), contrast, build, demo e2e (284), and the Docker job from a fresh reset: test:db (2748), every test:rls phase, test:e2e:auth (34), and a clean types diff.
- [x] 5.8 SECTION GATE: every suite green. At an outlet with everything off, the live counter is unchanged. At one with everything on, 5.5 and 5.6 hold against the real backend. At an all-off outlet the live counter asks nothing and adds nothing (every pre-#60 e2e passes unchanged); at Kalyani with everything on, `billing-served.spec.ts` holds 5.5 and 5.6 against the real backend, and reruns without a reset.

## 6. Demo, Docs And Phase Gate

- [x] 6.1 Walk the four-role demo end to end. The demo e2e suite walks all four roles and passed whole (284).
- [x] 6.2 Update every page named in the proposal's *Docs to update*: `docs/BUSINESS_CONTEXT.md`, `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/GLOSSARY.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/LIMITATIONS.md`, `docs/OPERATIONS.md`, `docs/DEMO_MODE.md`. Plus the proposal's LIMITATIONS items: the waiver as #57's one exception, a table seated twice, the price race, and the receipt page's interim wording.
- [x] 6.3 Add a note to #58 `the-receipt-names-its-customer` for the receipt renderer: name the waiver *Gold member · packaging free*, and show *Dine-in · Table 4* / *Takeaway*. Also records what the live receipt page prints for the waiver until #58 lands.
- [x] 6.4 Update the Configuration Surfaces row in `ROADMAP.md` to where the settings are made and by whom.
- [ ] 6.5 🧍 The owner turns the settings on for the real outlet, and a biller serves real dine-in and takeaway orders with them. Tasks complete is not the archive trigger; real use is.
- [ ] 6.6 PHASE GATE (#60): each outlet chooses, on its own settings page, whether its orders are marked dine-in or takeaway, whether dine-in orders take a keyed table number, and whether a packaging charge is added per bag or per order, with packaging optionally free for gold members. A new outlet starts with every switch off and bills exactly as today. With the switches on, the counter asks where the food goes only where there is a choice, and a biller answers it in one tap before the order is saved or paid, a dine-in order is called by its table instead of its order number, a table already open is refused, and a takeaway order carries its packaging as a line on the bill that the biller cannot remove or reprice. Every one of those orders rung offline settles exactly once. The owner settled the settings page and the counter in the demo before any of it reached production, and the four-role demo walkthrough still walks.
