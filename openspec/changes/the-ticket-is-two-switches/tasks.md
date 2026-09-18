## 0. Before Anything

- [x] 0.1 Read `design.md` end to end. In particular **When a box cannot be unticked**, which explains why the two halves of this change are one change, and **Rejected alternatives**, which carries eight drawings and rules already considered and turned down — including three the owner turned down personally.
- [x] 0.2 Read both spec deltas before opening any file. Two requirements are **removed with named successors**; implementing against the living spec alone would rebuild the bands.
- [x] 0.3 **Sections 1–4 land before sections 5–7, and are verifiable on their own.** The rail is UI with no migration; the clock is money rules in the database. Keeping them in that order means a stall in the database half never holds the biller's fix hostage inside this branch.
- [x] 0.4 Nothing is half-built. `src/features/billing/` is exactly as `preparing-order-pipeline` (#45), `extended-offline-billing` (#34) and `multiple-billing-devices` (#35) left it.

## 1. One List

- [x] 1.1 Delete `splitPipeline` and `PipelineSections` from `src/features/billing/pipeline.ts`, and its tests. The file keeps `unwindWindowOpen` and nothing else; if that leaves one exported function, decide whether the module still earns its own file rather than leaving a stub.
- [x] 1.2 In `src/features/billing/open-orders-surface.tsx`, replace the two `renderSection` calls, the divider and the whole band apparatus with one list of every non-cancelled order in the order the adapter returns. Delete `bandStyle`, `floors`, `measureFloors`, the `useLayoutEffect` measuring frame and the resize listener that feeds it — the proportional height-sharing exists only to divide a panel between two bands.
- [x] 1.3 Keep the empty state and the loading shimmer, and redraw the shimmer as plain cards over one scroller with no hairline between them: the silhouette must be the shape that actually arrives.
- [x] 1.4 Drop the `section` prop from `PipelineCard` and every call site. Nothing about a card may depend on where it sits.
- [x] 1.5 Confirm the docked-edit card still leaves the list and docks against the composer exactly as before. It sat outside both band scrollers; it must now sit outside the one.
- [x] 1.6 Delete `src/features/billing/pipeline-board.test.tsx` — both its cases assert the height-sharing this change removes — and replace it with a test that a card keeps its position in the list across a prepare and an unprepare.

## 2. The Two Controls

- [x] 2.1 Build a `StateToggle` in `src/features/billing/` (not in `src/components/ui/`, until a second surface wants one): a button rendering a checkbox glyph and a constant label, with `aria-pressed`, an accessible name, and a `tone` of `primary` or `success`.
- [x] 2.2 Unchecked: the secondary button treatment with the box outlined in the tone's colour. Checked: the button filled with the tone's colour, box and mark in that tone's **foreground token** (`--on-primary`, `--on-success`). No literal grey anywhere — see `design.md`, Colour.
- [x] 2.3 Give the toggle a third, non-interactive rendering for a fact that cannot be changed: no border, no press affordance, not a `button`, and no `aria-pressed` to misreport. After section 5 its only user is another till's order; build it that way from the start rather than wiring an expiry case that section 5 deletes.
- [x] 2.4 Draw checked and unchecked so they differ in **shape**, not only in colour and fill, and keep the focus ring visible on the filled state — the ring on a filled primary is the case `design-system` already calls out.
- [x] 2.5 In `PipelineCard`, replace the four button variants with two toggles: Prepared then Paid, fixed order, equal width, on every card. Delete the `Reprepare`, `Un-pay` and secondary-`Paid` branches and the `PAID` chip with its `paid-chip-*` test id.
- [x] 2.6 Wire the Paid toggle: unchecked activates `onMarkPaid` (the tender dialog); checked activates the existing `UnpayDialog`. Wire the Prepared toggle to `onMarkPrepared` / `onUnprepare`. No adapter call changes in this section.
- [x] 2.7 Reduce the kebab to Edit and Cancel order on an unpaid card, and Cancel after paid on a paid card. Un-pay leaves the menu; it is the Paid toggle now.
- [x] 2.8 Register `--primary` and `--success` against `--surface-raised` in the contrast validator at the 3:1 control threshold, run `npm run contrast`, and **read both themes' output** rather than the exit code alone.
- [x] 2.9 Update every test that asserts on the old wording. `billing-counter.test.tsx`, `pipeline-card-till.test.tsx` and the e2e specs query by the words Reprepare, Un-pay and the paid chip; each becomes an assertion on a toggle's checked state. Do not delete a case to make it pass.

## 3. The Scroll Chip

- [x] 3.1 Add a chip component to the rail: a floating control at the clipped edge saying how many orders are hidden that way, with an accessible name naming the destination rather than the direction glyph.
- [x] 3.2 Derive "hidden above" and "hidden below" from the scroller's own geometry against each card's offset, recomputed on scroll and on resize and throttled to a frame. Never from a guessed card height — cards vary with their item lines.
- [x] 3.3 Show each chip only while orders are actually clipped that way, and hide both when the whole list fits.
- [x] 3.4 Activating a chip scrolls to that end of the list — the whole way, as a chat app does, not by a page and not to the next card.
- [x] 3.5 Mark the bottom chip whenever any order hidden below it is prepared and unpaid, with a marker that is not text and not colour alone.
- [x] 3.6 Scroll the list to its newest end when an order is saved on this tablet, and only then: another till's order arriving must not move the rail under the biller's thumb.
- [x] 3.7 Test the chip against a list long enough to clip in both directions, including the marker appearing and disappearing as the prepared-unpaid order crosses the fold.

## 4. Animation, And The Rail Proved

- [x] 4.1 Keep `useFlip` and the settlement flight into the bills column untouched, including its placeholder, its 300ms budget and its reduced-motion crossfade.
- [x] 4.2 Confirm that recording one fact animates nothing at all: with no section change, the FLIP hook must measure no movement. If it plays anything, the list is reordering and section 1 is wrong.
- [x] 4.3 Update `flip.test.tsx` for the one remaining destination.
- [x] 4.4 **Checkpoint.** Run the full CLI suite and look at the rail on a real counter viewport in both themes, at a short viewport clipped both ways, and under reduced motion. Everything the biller complained about is fixed at this line, and nothing below it has started.

## 5. The Clock, In The Database

- [ ] 5.1 Write one migration carrying every function below. Name the derived window in a comment where each function checks it, so the next reader does not have to reconstruct the rule from three copies of an expression.
- [ ] 5.2 `unpay_billing_order` and `cancel_paid_billing_order`: replace `p_created_at >= v_bill.paid_at + interval '5 minutes'` with the derived window — no deadline while `v_order.prepared_at` is null, otherwise `greatest(v_bill.paid_at, v_order.prepared_at) + interval '5 minutes'`. Keep the existing `p_created_at < v_bill.paid_at` clock-sanity refusal, and keep every authorization check ahead of the window check, in that order.
- [ ] 5.3 `correct_bill_payment`: the same window, reached through `bills.order_id`. That column is nullable and the null is the direct-sale case, which keeps `paid_at + interval '5 minutes'`. A join that silently drops the null would hand every direct bill an unbounded window — assert the opposite in a test rather than reading the SQL twice.
- [ ] 5.4 `finish_billing_day` (latest definition in `resilient-counter-departure-and-day-close`): extend the `unresolved_operations` check from `status='open'` to also catch `status='paid' and prepared_at is null`, and return a status the sheet can name distinctly from an ordinary open order.
- [ ] 5.5 Drop the `billing_end_of_day_payment_edit_guard` trigger and `reject_open_payment_edit_at_finish`. **Before dropping it, prove in pgTAP what replaces it**: that a take-back, a cancel-after-paid and a correction are each refused for a bill whose day has been finished, because the shift is ended and `billing_device_context` refuses. If any of the three is *accepted*, stop — keep the trigger and rewrite it to the derived window instead, and say so in `design.md`.
- [ ] 5.6 pgTAP for each of the three commands on both sides of the new deadline: accepted on an unprepared order long after payment; accepted inside five minutes of preparation; refused five minutes after preparation; refused five minutes after payment when payment came last; refused five minutes after payment for a bill with no order. Hand-crafted requests, not adapter calls.
- [ ] 5.7 Confirm `npm run test:rls` is unchanged and still passes. This change moves a deadline, not an authority; if an isolation case moves, something in 5.2–5.4 reached past the clock.

## 6. The Clock, In The App

- [ ] 6.1 Put the derived window in one place in `src/domain/` — a function over `paidAt` and `preparedAt` returning a deadline or none — and make every reader call it. Two copies of this rule is how the screen and the server come to disagree.
- [ ] 6.2 `paymentEditableUntil` in both adapters: computed from that function, including the locally projected bill the tablet builds at acceptance time.
- [ ] 6.3 `unwindOpen` in `pipeline-card.tsx`: the same function. Delete the expiry branch of the toggle's non-interactive rendering — in the pipeline list, a payment on this till's order is always reversible now.
- [ ] 6.4 The bills column: where no deadline exists yet, keep the pencil indicator and the edit affordance and **draw no countdown**, saying instead that it stays editable until the order is prepared. Never draw an unstarted countdown as expired.
- [ ] 6.5 `inspectFinishDay`: count payments whose deadline has not passed rather than bills paid inside five minutes, and add the paid-and-unprepared count as its own blocker.
- [ ] 6.6 The Finish Day sheet: a new blocker in the biller's words — *1 order is paid but not marked prepared* — with a resolution pointing at the pipeline. Leave the recent-payment note as an advisory note; it becomes true once 5.5 lands.
- [ ] 6.7 Mirror the whole rule in the mock adapter so demo mode and the mock tests answer exactly as the live one does, including the direct-bill exception.

## 7. Offline, Ownership And Demo

- [ ] 7.1 Walk the rail with the backend stopped: a locally accepted prepare, pay and take-back each redraw their toggle from the projected order, with no card moving and nothing waiting on the network. The offline deadline comes from the same domain function, over facts the tablet already holds.
- [ ] 7.2 Walk a second till's order: both toggles drawn as facts without chrome, the till still named beside the time, and the adapter's refusal still reached if a command is forced.
- [ ] 7.3 Walk demo mode: the same rail, the same toggles, the same clock, no real write.
- [ ] 7.4 Confirm the counter's resume path and the `pipeline-as-of` label are unaffected.

## 8. Docs And Board

- [ ] 8.1 `docs/SCREENS.md` — rewrite the Counter's **Open orders** paragraph for one list, two fixed controls and the chip; correct the three-column paragraph that names the rail's divider; restate the tender-correction deadline; and add the new Finish Day blocker. While there, the paragraph still says Open orders holds *this tablet's* orders; it has held the outlet's since #35.
- [ ] 8.2 `docs/DESIGN_SYSTEM.md` — the checkbox-in-a-button control, its two token pairs, the rule that the mark takes the fill's foreground token, and the rule that a fact which cannot be changed is drawn without control chrome rather than disabled.
- [ ] 8.3 `docs/OPERATIONS.md` — what now stops a day from closing, and what closing one does to an open edit window.
- [ ] 8.4 `docs/DATA_MODEL.md` — the payment-edit deadline as a derived value over two columns rather than one, and the direct-sale exception.
- [ ] 8.5 Run `npm run roadmap:sync`. Never hand-stamp a status. The #55 row is already in the inventory from this proposal.

## 9. Verification

- [ ] 9.1 Run what CI runs, from the workflow file rather than from this list, and read each job's output. At minimum: `npm run typecheck`, `npm run lint`, `npm run lint:tokens`, `npm run lint:specs`, `npm run lint:todos`, `npm run contrast`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:db`, `npm run test:rls`.
- [ ] 9.2 Reset the local database before trusting any DB gate — the container is shared and another session may have reset it mid-run.
- [ ] 9.3 Walk the whole thing by hand on a counter viewport: take an order, pay it upfront, wait past five minutes, take the payment back, pay it again, mark it prepared, watch it fly to Bills, then try to take it back from there before and after its five minutes.
- [ ] 9.4 Finish a day with an order paid and unprepared, and read the refusal. Then prepare it and finish the day within a minute of a payment, and confirm the day closes.

## 10. Phase Gate

- [ ] 10.1 **PHASE GATE.** A biller works the whole outlet's pipeline as one list, newest order at the top, where recording preparation or payment changes the card's colours and moves nothing; every card carries the same two controls in the same two places — Prepared then Paid, each a checkbox in a button, each keeping its word whatever the order's state — so nothing renames itself to Reprepare or Un-pay and no separate Paid badge is needed to say what a ticked box already says; an unchecked box is drawn in the colour its state would take and a checked one floods its button with that colour, legible in both themes and distinguished by shape as well as colour; a ticket leaves the rail only when both boxes are ticked, flying to Bills this shift as it does today; orders hidden above or below the fold are announced by a floating chip that scrolls to them, and the chip says when prepared work is waiting for money out of sight; a payment on an order whose food is still being made can be taken back, corrected or cancelled however long ago it was paid, the five-minute clock starting only when the ticket is finished — the later of paid and prepared — computed identically by the database, both adapters and the screen and refused outside it by the database, proved by a hand-crafted request, while a bill with no order behind it keeps its payment-time clock; Finish Day refuses while any order is paid and not prepared, naming it, and otherwise closes the day at once, ending any open edit window early, with a payment past its closed day refused; and the four-role demo walkthrough still walks.
