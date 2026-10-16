# Tasks: a-popup-closes-when-you-tap-outside-it

## 1. The gate, off

- [x] 1.1 Declare `outside-tap-closes` (code `OT`, kind `change`, `retireBy` 2026-12-15, `roundTrip: 'none: …'`) in `src/change-gates/gates.ts`.
- [x] 1.2 Migration `20261022000000_a_popup_closes_when_you_tap_outside_it.sql`: one `insert into public.change_gates` row, off, with `-- change-gate: outside-tap-closes` in its header and no `change_number` (this change has no roadmap row). Its version follows #74's last migration, `20261021000000`: it was first written as `20261019000000`, which #74 had already taken. Run `npm run lint:migrations` and `npm run lint:change-gates`.
- [x] 1.3 The demo's words for the gate in `src/data-access/mock/change-gates.ts`; its roadmap number becomes optional there.
- [x] 1.4 Loosen the three demo e2e assertions that spell the full build code as `PB-TH` to `PB-TH` followed by any later gate codes, so a new gate does not fail an unrelated test. *(On rebasing onto #74 these were already loosened there, to `(-[A-Z]{2})*`, so this change carries no edit to that file.)*

## 2. The on path

- [x] 2.1 `Modal` closes on an outside press-and-release: position test against the dialog's rectangle, press must also have started outside, `target === currentTarget`, 400 ms grace after open read when the press begins, a stale press forgotten on each opening, closes through `onClose`; `dismissOnOutsideTap` prop, default true; nothing attached with the gate off.
- [x] 2.2 `ConfirmDialog`, the payment, points and discount dialogs, cancel order, unpay, cancel-after-paid, the category match and the gate-turn confirmation pass `dismissOnOutsideTap={!busy}`; `FormSheet` takes `busy` and passes it on, and every sheet with a save in flight gives it the state that disables its submit (design D4).
- [x] 2.3 The iOS install hint closes on an outside pointer, gate on only.
- [x] 2.4 Correct the comment in `why.tsx` that credits `<dialog>` with backdrop dismissal, and the same sentence in `modal.tsx`'s doc.

## 3. Tests, both states

- [x] 3.1 Unit, `describeChangeGate('outside-tap-closes', …)`: closes on a tap outside (gate on) and stays open (off); padding tap; press inside, release outside; grace, including a press begun in it and released after; a cancelled press forgotten on reopening; nested pop-up; guarded `onClose` keeps it open; `dismissOnOutsideTap={false}`; keyboard-initiated clicks never close.
- [x] 3.2 Unit: `ConfirmDialog busy`, the payment dialog and a `FormSheet` mid-save ignore the tap.
- [x] 3.3 Unit: the install hint closes on an outside pointer (gate on) and not (off).
- [x] 3.4 Browser (demo suite), real clicks on a real backdrop: `@cg-on:outside-tap-closes` closes a confirmation and a sheet, a tap on padding does not, a drag out of a field does not, and a phone-sized sheet closes from the strip it leaves; `@cg-off:outside-tap-closes` shows the same tap leaves the pop-up open. A pop-up over another is covered by the unit tests, which can lay the two out without a real screen.
- [x] 3.5 `e2e/dialog-escape.spec.ts`: a bare native dialog does not close on a backdrop click, so the platform fact this change corrects is pinned.
- [x] 3.6 No authenticated-suite test: the pop-up is the same shared `Modal` in the demo and the real app, and nothing in the authenticated suite aims at a backdrop; both of its states still run in CI.

## 4. Docs

- [x] 4.1 `docs/DESIGN_SYSTEM.md`, component conventions: how a pop-up closes and what is not outside.
- [x] 4.2 `docs/SCREENS.md`: one line on the counter's dialogs.

## 5. Verify

- [x] 5.1 `npm run format`, then `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test` (214 files, 2694 tests), `npm run contrast`, `npm run build`: all green.
- [x] 5.2 `npm run test:e2e:on`: 362 passed. `npm run test:e2e` (gates off): 352 passed and 2 failed, both `analytics.spec.ts` *Items charts… against earlier periods* on the phone project, a 90 s timeout at two different steps; the same spec passed 4 of 4 on a re-run with the gate off. Off attaches no handler, so these are read as a slow-run flake, not this change; Staging's run decides.
- [x] 5.3 The database gates on the local stack: `db:reset`, `test:db` (3542 tests), `test:rls`, `db:types` with no diff. `test:e2e:auth` and `test:e2e:auth:on` were not run locally: nothing in them aims at a backdrop, and Staging runs both.
- [x] 5.4 Looked at in the production build, with real mouse clicks: a confirmation at tablet size closed on an outside tap with the gate on and stayed open with it off; the gate-turn confirmation closed the same way; a phone-sized sheet closed from the strip it leaves. Looked at in the dark theme only: nothing here changes a colour or a size.
- [x] 5.5 Each guard proved by removing it: the unit test for it fails, and for the padding and drag guards the real-browser test does too.

## 6. PHASE GATE

- [x] 6.1 No roadmap row, so no roadmap checkpoint: the checkpoint is a green Staging run on the pushed commit, then the owner trying it on Staging's *Cafe Staging* with the gate turned on there. Release is the `release` workflow afterwards; archive waits for real use. *(Read 2026-10-15: Staging run `38666885574` passed on `9973dc55`; the owner turned `outside-tap-closes` on in staging at 08:05 IST, then promoted it with run `38674957424` and turned it on in production at 08:44 IST, which is read as their approval. Pulled 2026-10-15: off at 09:24 IST, on again at 11:48. In the owner's browser on production's Change gates page, a tap on the backdrop left the pop-up open with the gate off, and closed it, changing nothing, once the gate was on. It then ran through the service of 15 October on build `da92417` with both tablets booting it: by 20:00 IST, 35 bills and no failed request from either tablet, and no 5xx from the server all day. Archived that evening.)*
