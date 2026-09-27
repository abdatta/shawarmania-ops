# Tasks: each-outlet-chooses-how-it-serves

> **Sequencing.** `outlets-one-at-a-time` builds the one-outlet page these
> settings sit on. Walk its checkpoint first. #57 `a-gold-member-is-a-label`
> was archived on 2026-09-26, so nothing in it blocks this archive any longer, because this change modifies a
> requirement #57's delta adds. It need not be archived before this one *starts*:
> the tier snapshot and the counter's star are already live.

> **UI first, and the owner is a hard stop.** Same instruction as #56 and #57.
> **Section 2 is a gate, not a note.** No migration, no function, no policy, no
> payload version and no spec reconciliation begins until the owner says the
> settings page and the counter are settled. The four questions `design.md`
> once left open were answered on 2026-09-26 and are built into section 1.
> Build to those answers, and change them only if the owner does while walking
> the demo.

> **The live counter must not move until section 5.** The live settings adapter
> returns all-off until then (design D10), so production renders exactly what it
> renders today while the demo is reworked.

> **Money, offline and the command boundary are all in play here.** None of it is
> quickfix-lane work, and the full local gate set, including the Docker job, runs
> before anything is pushed. Remember the owner picks the deploy window: commit
> locally and let them choose when it ships.

## 1. The Settings And The Counter, Against The Mock Only

- [ ] 1.1 Add the settings to the typed adapter interface and the mock: the seven fields in design D1, with the mock enforcing the same consistency rules the database will. Add two demo outlets' worth of fixtures: one with every switch on (per bag ₹5, gold waiver, 8 tables) and one with every switch off. The live adapter returns all-off (D10).
- [ ] 1.2 The **Orders** and **Packaging** sections, as sketched in the proposal, **on the outlet's page** that `outlets-one-at-a-time` settled: each an `OutletSection` (`src/features/outlets/outlet-section.tsx`) placed between Details and Tablets, as tiles rather than sentences (that change's design D2 and D3 record why the owner turned sentences down): one switch each, and settings beneath that appear only while it is on. At least one type stays offered while the section is on. The table count is shown only with dine-in and tables. Per bag / flat switches the price label. Registered as a `demo`-gated part of the page so real users see nothing until section 5.
- [ ] 1.3 A manager's page shows both sections **read-only**, for the outlets they manage and no others [owner, 2026-09-26]: each section states its current answers with no switches, chips or inputs, and a section that is off reads as off.
- [ ] 1.4 The composer: type chips beside the customer control, only when offered. *Can skip* behaviour and the first-offered default (D9). Chips never block Save or Mark Paid.
- [ ] 1.5 The table **popup** (D9) [owner, 2026-09-26], opened the way the customer keypad dialog opens: 1 to N, busy tables dimmed from the pipeline the tablet sees, tapping a busy table opens that order when this tablet owns it and otherwise says which tablet holds it, and *No table* closes it with dine-in and no table. The chip then reads *Dine-in · Table 4*, and tapping it reopens the popup.
- [ ] 1.6 The packaging line, named *Packaging* in both modes [owner, 2026-09-26]: added to every order not dine-in, last among the lines, *Packaging × 1* to start (per bag) or one flat line, removable, removed when the order becomes dine-in and added when it becomes takeaway. It captures the price in force when added and never reprices.
- [ ] 1.7 The gold waiver: struck-through price and *Free* when the customer the tablet knows is gold and the outlet waives. It follows customer changes while the order is open.
- [ ] 1.8 *Table 4* **replaces** the order number [owner, 2026-09-26] on the composer's editing header, the pipeline card and the shift bill list, with the number not shown beside it. Manager history and bill detail show the type and table beside the order and bill numbers.
- [ ] 1.9 The demo walkthrough covers: turning each switch on at the all-off outlet and seeing the page grow; a dine-in order at a table; adding to a busy table; a takeaway with two bags; a gold member's takeaway with the waiver; clearing that customer; switching an order from takeaway to dine-in.
- [ ] 1.10 SECTION GATE: at `/demo`, on phone and tablet widths in both themes, every step in 1.9 walks. At the all-off demo outlet the counter is indistinguishable from today's.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [ ] 2.1 Hand the owner the demo and let them walk it. Expect several rounds, and iterate on section 1 as they ask.
- [ ] 2.2 Record in `design.md` what the owner settled, with the date, and what changed between the sketches and the settled UI. Update the spec deltas where a settled answer changes a requirement's wording.
- [ ] 2.3 CHECKPOINT GATE: the owner states the settings page and the counter are settled. Nothing below begins before this.

## 3. The Settings In The Database

- [ ] 3.1 Write the failing tests first (pgTAP): an outlet defaults to all-off; each inconsistent combination in D1 is refused; the price bounds and whole-rupee rule hold; the owner writes, and a Franchise Admin of that outlet, a Biller, an Employee and a counter device are each refused by hand-crafted request.
- [ ] 3.2 The migration: the enum and seven columns on `outlets` with their checks (D1). Existing outlets take the defaults. Assert inside the migration that no production outlet ends it with anything on.
- [ ] 3.3 How a counter device reads its own outlet's settings (D6). Check the device's current access to `outlets` first. If a read function is needed, it returns these columns for the device's own outlet and nothing else. Add isolation cases: a device of the other outlet gets nothing, and an Employee gets nothing.
- [ ] 3.4 Regenerate schema types and commit the diff.
- [ ] 3.5 SECTION GATE: `test:db` and `test:rls` green from a fresh reset; the owner round-trips every setting and every other principal is refused every write.

## 4. Orders And Bills Carry How They Were Served

- [ ] 4.1 Write the failing tests first: service facts are snapshotted and fixed at payment; `table_number` is refused without dine-in; the bill copies the order's; `kind` defaults to item; at most one packaging line per order and per bill; a packaging line with a menu id, a category, or a partial discount is refused; a full waiver counts in the parent's discount and passes every existing parts-equal-the-whole guard; a second open order on the same table **is accepted** (D5).
- [ ] 4.2 The migration: the service-type enum, `service_type` and `table_number` on `orders` and `bills`, the line-kind enum and `kind` on `order_items` and `bill_items`, and the partial unique indexes (D2, D3).
- [ ] 4.3 The command boundary (D7, D8): accept payload v3; check service facts for shape only; check a new packaging line's name and price against the outlet's packaging charge by the same rule and timing as a new menu line. **Read what the menu path does when an offline tablet's captured price no longer matches, apply the same, and record it in `docs/LIMITATIONS.md`.** Existing packaging lines are compared by identity.
- [ ] 4.4 `shared/billing-command.ts`: `BILLING_COMMAND_SCHEMA_VERSION` to 3, and the v3 shape. The boundary still accepts v1 and v2 as *neither, no table, every line an item*. Add cross-runtime canonical-JSON and hash vectors for v3, and keep the v1 and v2 vectors passing.
- [ ] 4.5 `lint:discount-rows`: add the waiver case (a full-line discount on a packaging line, alongside a bill discount) to the shared cases, so both runtimes agree. Confirm `lint:totals` needs no new case because the identity did not move (design, Money arithmetic).
- [ ] 4.6 Isolation cases for the new columns: a neighbouring outlet's manager and device cannot read another outlet's orders' type and table or its lines' kind.
- [ ] 4.7 Regenerate schema types and commit the diff.
- [ ] 4.8 SECTION GATE: a v3 order with a table, two bags and a waiver round-trips create, revise and pay at the database. A v1 and a v2 command queued before the release each settle exactly once. The full DB and RLS suites are green from a fresh reset.

## 5. The Counter Goes Live

- [ ] 5.1 Swap the live settings adapter for the real one, and promote the Outlets sections' gate from `demo` to `live`. Per AGENTS.md this **does not redesign the screen**: if it has to, the mock was the wrong shape, so fix the mock and record why.
- [ ] 5.2 Settings reach the counter on its menu refresh and in the resume record (D6). A cold-started offline tablet serves its outlet's types, tables and packaging.
- [ ] 5.3 The client computes the packaging line and waiver in `billTotals()` territory with integer paise only, and the float guard still throws.
- [ ] 5.4 Offline path, exercised for real rather than asserted: go offline, ring a dine-in order at table 3, a takeaway with two bags, and a gold member's takeaway with the waiver. Revise one, pay two, come back online, and confirm each settles exactly once with its type, table, lines and waiver, and no duplicates.
- [ ] 5.5 Two tablets: seat table 4 on each while one is offline, reconnect, and confirm both orders are recorded and both read Table 4 on the pipeline (D5).
- [ ] 5.6 Run the full gate list from `AGENTS.md`, including the Docker job and `test:e2e:auth`.
- [ ] 5.7 SECTION GATE: every suite green. At an outlet with everything off, the live counter is unchanged. At one with everything on, 5.4 and 5.5 hold against the real backend.

## 6. Demo, Docs And Phase Gate

- [ ] 6.1 Walk the four-role demo end to end.
- [ ] 6.2 Update every page named in the proposal's *Docs to update*: `docs/BUSINESS_CONTEXT.md`, `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/GLOSSARY.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/LIMITATIONS.md`, `docs/OPERATIONS.md`, `docs/DEMO_MODE.md`.
- [ ] 6.3 Add a note to #58 `the-receipt-names-its-customer` for the receipt renderer: name the waiver *Gold member · packaging free*, and show *Dine-in · Table 4* / *Takeaway*.
- [ ] 6.4 Update the Configuration Surfaces row in `ROADMAP.md` if the settled UI moved where these settings are made.
- [ ] 6.5 🧍 The owner turns the settings on for the real outlet, and a biller serves real dine-in and takeaway orders with them. Tasks complete is not the archive trigger; real use is. Archive only after #57 has archived.
- [ ] 6.6 PHASE GATE (#60): each outlet chooses, on its own settings page, whether its orders are marked dine-in or takeaway, whether dine-in orders take a table number, and whether a packaging charge is added per bag or per order, with packaging optionally free for gold members. A new outlet starts with every switch off and bills exactly as today. With the switches on, a biller marks an order in one tap, a dine-in order is called by its table instead of its order number, a busy table opens the order already on it, and a takeaway order carries its packaging as a line on the bill that the biller can change or remove. Every one of those orders rung offline settles exactly once. The owner settled the settings page and the counter in the demo before any of it reached production, and the four-role demo walkthrough still walks.
