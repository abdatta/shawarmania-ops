## 0. Before Anything

- [ ] 0.1 Confirm `the-day-change-finishes-paid-orders` (#69) is applied. Without it a forgotten Prepared tick sits on the kitchen screen indefinitely.
- [ ] 0.2 Read `design.md` end to end. **D3** is the dangerous edit; **Rejected alternatives** records sixteen things already turned down, most of them by the owner in person — do not reintroduce a locked state, a kitchen role, a NEW label, browser-stored filters, or a business-day filter.
- [ ] 0.3 Read all four spec deltas. `counter-device-sessions` renames a requirement.
- [ ] 0.4 **Tests before implementation** for every database rule in sections 1–4: each is a failing pgTAP case or hand-crafted RLS request before the migration that satisfies it.
- [ ] 0.5 **Sections 1–4 (database) land and pass before section 5 starts.** The authority split is provable without any UI.
- [ ] 0.6 Reset the local database before trusting any DB gate; the container is shared.

## 1. Kinds, In The Database

- [ ] 1.1 Migration: `counter_devices.kind`, `counter_shift_requests.kind`, `counter_shifts.kind` (check `('counter','kitchen')`, default `'counter'`, backfill existing rows `'counter'`); add `'device_kind_changed'` to the `ended_reason` check.
- [ ] 1.2a `counter_device_setup_codes.kind` (same check, default `'counter'`); the issue path takes it; redemption creates the device with it. pgTAP: a kitchen code makes a kitchen; an omitted kind makes a counter; an FA issuing for an outlet they do not manage is still refused.
- [ ] 1.2 Shift requests copy the device's kind at creation; confirmation refuses when the device's kind no longer matches.
- [ ] 1.3 Find the server path the Tablets Edit dialog uses for `rename_counter_device`, and add the kind change to it per D1: SA any tablet, FA only at an actively managed outlet; cancel pending request, end live shift with `device_kind_changed`, set kind, one transaction.
- [ ] 1.4 Refuse becoming `kitchen` while the latest fresh device report states unresolved work (reuse the transfer's freshness rule — find it, do not restate it) or while any order with this `device_id` is open or paid-and-unprepared. Return what is outstanding, naming order numbers.
- [ ] 1.5 pgTAP: both directions with and without a live shift; each refusal; FA at another outlet refused by hand-crafted request; a pending request is cancelled; history rows untouched.
- [ ] 1.6 Outlet transfer clears `kitchen_category_ids`.

## 2. The Authority Split

- [ ] 2.1 **Enumerate** every policy and `security definer` function whose body calls `app_counter_shift_outlet()`, `billing_device_context()` or `app_device_ok()` (`grep -rn` across `supabase/migrations`, then take each object's latest definition). Record the list in the PR description with, for each, whether a kitchen shift must reach it. There are at least eight migrations to read.
- [ ] 2.2 Write a hand-crafted kitchen-shift request for every enumerated reach that must refuse, plus: create order, revise, pay, prepare, cancel, unwind, tender correction, customer lookup and create, cash expense write, select on `orders`, `order_items`, `order_discounts`, `bills`, `bill_items`, `bill_payments`, `billing_commands`, expenses and drawer tables. Add them to the RLS suite. They fail now (a kitchen shift is just a shift) — that is the point.
- [ ] 2.3 Narrow `app_counter_shift_outlet()` and `billing_device_context()` to live shifts of kind `counter`. Add `app_kitchen_shift_outlet()`.
- [ ] 2.4 Re-run 2.2: every case refuses. Re-run the whole existing RLS and pgTAP suites: no counter case changed.
- [ ] 2.5 Exclude kitchen shifts and kitchen tablets from Finish Day readiness's live-shift and participating-tablet rules. pgTAP: a day closes with a kitchen shift live, and the kitchen shift survives.

## 3. The Board, The Pulse, The Filter

- [ ] 3.1 Migration: `kitchen_filter_mode`, `kitchen_category_ids` on `counter_devices` per D6, plus who changed it and when.
- [ ] 3.2 `set_kitchen_filter(p_mode, p_category_ids)` per D6. pgTAP: own row only; foreign-outlet category refused; no kitchen shift refused; counter shift refused.
- [ ] 3.3 `menu_categories` select admits `app_kitchen_shift_outlet()`.
- [ ] 3.4 `kitchen_board()` per D4. pgTAP: filter applied in the query in both modes; packaging never returned; other-items count right; cancelled orders limited to the shift's business date and to those without this tablet's `cancel` ack; an acknowledged order that lost every visible line is returned as cancelled until acked; **no customer column and no amount anywhere in the result**, asserted on the JSON keys.
- [ ] 3.5 `kitchen_pulses` table, policy (kitchen shift at the outlet, outlet managers), isolation test, triggers on `orders` and `order_items`, publication. pgTAP: an order insert, a line change, a payment, a preparation and a cancellation each bump it.
- [ ] 3.6 Two-till concurrency: run the existing multi-device billing race suite before and after the pulse triggers and record both timings in the PR. If contention is measurable, replace the pulse with `realtime.broadcast_changes()` (D5) instead.
- [ ] 3.7 `explain` the board on a realistic order count; it must ride `orders_pipeline_idx`.

## 4. Acknowledgements

- [ ] 4.1 `kitchen_acknowledgements` per D7, append-only, with its RLS policy **and isolation test** (an FA at the other outlet, another kitchen tablet, a counter tablet, a Biller's personal session each see none of it).
- [ ] 4.2 `kitchen_acknowledge(...)` per D7: server-side snapshot of visible lines; stale `order_changed_at` refused; exact replay returns the stored row; no live kitchen shift refused.
- [ ] 4.3 pgTAP for the state table in D8, driven through the board: new → acked → edited (visible) → acked; edit touching only invisible lines stays quiet; all visible lines removed → cancelled; cancellation → cancel ack removes it from the board.

## 5. The Tablet

- [ ] 5.1 Device session resolves by kind: kitchen → `/kitchen`, counter → `/counter`, each redirecting the other (D13). Demo routes likewise.
- [ ] 5.2 `KitchenShell`: the existing shift-start screen and handshake, worded for the kitchen by kind; the board once a kitchen shift is live; the device heartbeat; **no** outbox drain.
- [ ] 5.3 Kitchen adapter in `src/data-access/adapters.ts` with live and mock implementations, typed from regenerated schema types (`npm run db:types`; check the diff for stray telemetry).
- [ ] 5.4 `src/domain/kitchen.ts`: the card-state derivation (D8) and the line diff, as pure functions with unit tests covering every row of D8's table and its listed consequences.
- [ ] 5.5 The board UI per D10: grid oldest first, number, service tag, large quantities, waiting time with 10/20-minute tones, *+N items for another kitchen*, header with tablet name, filter summary, shift holder, sync state and clock. Loading shimmer in the same shape.
- [ ] 5.6 Alert styling per D10: shake, glow, ACK in the card's tone; reduced-motion pulse. Register any new foreground/background pair in the contrast validator and read both themes' output.
- [ ] 5.7 The filter sheet: two-way mode, active-category checklist, Save through `set_kitchen_filter`.
- [ ] 5.8 Freshness per D5: subscribe to the outlet's pulse, re-read on nudge, every 20 s while visible and on foreground; the floating sync alert on offline / unsubscribed / >45 s stale; cards dimmed and ACK disabled while it shows.
- [ ] 5.9 The sound engine per D9 in its own module: synthesised tunes, the one-speaker queue with priority and shared rings, three rings, ACK cut-off, ring reset on content change, silent baseline on first read. Unit-test the queue with a fake clock, including the four scenarios in the `kitchen-display` delta.
- [ ] 5.10 Autoplay: resume the audio context on the shift-start gesture; the *Sound is off* floating alert when it is not running; first tap resumes.
- [ ] 5.11 Screen Wake Lock while visible, re-acquired on foreground; no error when unsupported.

## 6. Phones And The Tablets List

- [ ] 6.1 The phone's shift card becomes the per-shift list in D11 when a person holds more than one; *Leave kitchen* / *Open the kitchen?* wording by kind; confirmation names kind and tablet. Unchanged for one counter shift.
- [ ] 6.1a The setup-code form (`Set up a tablet at …` in `src/features/counter/outlet-tablets.tsx`): *Use this tablet for* with **Billing** preselected and **Kitchen**, passed through `issueSetupCode`. The tablet's setup screen is not touched; confirm a kitchen code lands on the kitchen shift-start screen.
- [ ] 6.2 Tablets Edit dialog: Type field, confirmation naming whose shift ends, refusal naming what is outstanding (D12).
- [ ] 6.3 Tablets list row for a kitchen: *Kitchen*, filter summary, live shift holder, no money figures; heartbeat and *out of touch* still shown.

## 7. Demo Mode

- [ ] 7.1 A Kitchen tablet entry in the demo walkthrough mounting the real `KitchenShell` at `/demo/kitchen` behind a synthetic device session.
- [ ] 7.2 Mirror the mock billing store's mutations across same-origin tabs with a `BroadcastChannel`, demo only, so a counter tab rings a kitchen tab. Start again resets both.
- [ ] 7.3 Confirm the four-role walkthrough still walks and the demo trading day still reconciles.

## 8. Gate, Docs And Board

- [ ] 8.1 Register the kitchen surface in `src/gates/registry.ts` as `hidden`; the Edit dialog's Type field is absent while hidden.
- [ ] 8.2 `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/OPERATIONS.md` (switching a tablet's type; recommend the *Only* / *Everything except* pairing; keeping the display on where Wake Lock is unsupported), `docs/DEMO_MODE.md`, `docs/GLOSSARY.md`, `docs/LIMITATIONS.md` (replace *Table management or KOT*; record the three accepted cases), `docs/BUSINESS_CONTEXT.md`.
- [ ] 8.3 Correct every first-read surface that says a tablet is only a counter, or that a person holds one shift (`grep -rn "Leave counter\|one shift\|billing tablet" docs openspec/specs`), not just the deep one.
- [ ] 8.4 Run `npm run roadmap:sync`. Never hand-stamp a status.

## 9. Verification

- [ ] 9.1 Run what CI runs, from `.github/workflows/verify.yml`, including the Docker-backed database and RLS jobs, and read each job's output.
- [ ] 9.2 Playwright, two browser contexts against the local stack, each set up as a tablet: one counter, one kitchen. Open both shifts (the same person, proving two live shifts). Save an order and see it shake on the kitchen; edit it and see the edit alert and diff; ACK both; cancel another and see it persist through a kitchen reload until ACK; tick Prepared and see it leave without ACK; drop the kitchen context's network and see the sync alert.
- [ ] 9.3 A second kitchen context with the complementary filter: an order with items for both appears on both, each with its *+N items for another kitchen* line, and each acknowledges independently.
- [ ] 9.4 Switch the counter tablet to Kitchen with an unpaid order on its rail and read the refusal; pay, prepare, switch, and see its shift end and the kitchen shift-start screen appear.
- [ ] 9.5 Leave the kitchen shift from the person's phone and confirm the counter shift survives.
- [ ] 9.6 Walk both themes, reduced motion, and the demo's two-tab walkthrough.
- [ ] 9.7 🧍 **On real hardware, when tablets exist:** sound after a reload, Wake Lock, the tunes audible over a working kitchen, and the cards legible from a cooking station. This does not block archive's tasks but does block calling the change used in production.

## 10. Promote

- [ ] 10.1 Promote the kitchen surface to `live` in `src/gates/registry.ts` once sections 1–9 pass.

## 11. Before The Push

- [ ] 11.1 **#69 shipped on its own on 2026-10-08**, ahead of this change (the owner reversed the earlier plan to release both together, because #69 does not depend on #70 and the counter was quiet). Confirm it is live — `orders.prepared_source` exists in production and the `day-change-finishes-paid-orders` cron job is scheduled — before relying on it here.
- [ ] 11.2 **Snapshot Supabase usage before pushing**, from the owner's signed-in dashboard (Organization → Usage, project `iefcidjbfnmsiqithqbj`): egress, database size, Realtime messages and peak connections, Edge Function invocations, storage, monthly active users, and API request counts if shown, each with the billing period it covers. Record it in `usage-snapshots.md` in this folder under the date, beside the readings already there. The 2026-10-08 08:37 IST baseline predates #69; this reading predates #70, so the two releases' deltas can be told apart. The point is the **delta** this release causes — the kitchen polls every 20 seconds and adds a Realtime subscription per kitchen tablet — so take the same readings again about a week after the push and add them as a third entry.

## 12. Phase Gate

- [ ] 12.1 **PHASE GATE.** An owner or Franchise Admin chooses Billing or Kitchen when creating a tablet's setup code, and the tablet opens as that kind on redeeming it with no change to its own setup screen; they switch a set-up tablet between the two from the outlet's Tablets list, keeping its identity, ending any live shift on it, and being refused a switch to Kitchen while that tablet still holds unsent work or orders it took that are still on the rail; a kitchen tablet opens a kitchen shift through the counter's own shift-start screen and phone code, held by the same people who may hold a counter shift, and the same person may hold a counter shift and a kitchen shift at once; with no live kitchen shift the tablet reads no order, proved by a hand-crafted request; a kitchen shift reads each order's number, service, lines and age and never a customer's name or phone, a price, a bill, a payment or an expense, proved by a hand-crafted request, and can issue no billing command; the kitchen screen shows the counter rail's unprepared orders oldest first, filtered by a category include or exclude list chosen on the tablet and saved on it, with a line saying how many items on an order belong elsewhere; a new order, an edit and a cancellation each shake and glow their card in their own colour and ring their own tune three times, one sound at a time, until ACK is pressed on that card; a cancelled card stays until it is ACKed or its business day ends; an order ticked Prepared at the counter leaves without an ACK; losing sync, or sound being blocked, is shown by a floating alert that cannot be missed; a person's phone lists each live shift with its own Leave; and the four-role demo walkthrough still walks, with a counter tab ringing a kitchen tab.
