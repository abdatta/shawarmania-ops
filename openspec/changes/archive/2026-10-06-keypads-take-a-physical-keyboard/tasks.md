## 1. Route physical keys to the pad

- [x] 1.1 Add a keyboard hook to the shared `Modal` that presses a pad's `data-keypad-key` buttons for digits, `.`, Backspace and Enter, only in the innermost open dialog, never while a text field has focus, never with a modifier, and leaving Enter alone on a control reached with Tab.
- [x] 1.2 Swallow an auto-repeated Enter, and take Enter from a key the mouse left focused, so one press is one action.
- [x] 1.3 Read the number pad by position, so it types digits with Num Lock off too. Found in a real browser, where Num Lock off sends Page Up and arrows.
- [x] 1.4 Mark the keys and the primary action on the payment, points, discount, table and customer dialogs.

## 2. Pin it

- [x] 2.1 Points dialog: typed digits, Backspace and Enter reach the pad, and a held Enter confirms once. Shown to fail before 1.1.
- [x] 2.2 Customer dialog: digits typed into the name field stay in the name field. Shown to fail without the text-field guard.
- [x] 2.3 Probed once in real Chromium, desktop and tablet (a throwaway spec, since superseded by 4.1): a mouse-focused key never answers Enter, a control reached with Tab keeps its own Enter, and a held Enter on the payment pad records exactly one bill, the same as paying by taps.
- [x] 2.4 `docs/SCREENS.md`: every number pad takes a physical keyboard, and a new pad joins by marking its keys.

## 3. Keep every future pad on it

- [x] 3.1 `keypadGaps` in `useKeypadKeys`: a dialog with ten digit buttons must mark each digit, a Backspace key and an Enter action; a test that opens one that does not fails, naming what is missing. Shown to fail the points dialog's own tests with its 5 key unmarked.
- [x] 3.2 `npm run lint:keypads` (`scripts/check-keypads.mjs`), in the `lint` chain CI runs: a source file drawing a pad must mark it. Shown to fail with the table dialog's Enter mark removed.
- [x] 3.3 `AGENTS.md` lists the new lint check.

## 4. Delete the legacy PIN shift page

- [x] 4.1 Delete `shift-unlock.tsx` and its test, its `shift` route in `surfaces.tsx`, and the `counter-shift-unlock` gate entry, which was already `hidden`.
- [x] 4.2 Delete the PIN-only `openShift` from `BillingAdapter`, the live adapter's refusal stub, the mock's PIN check and its two tests, and `DEMO_BILLER_PIN`. `listBillers` stays: manager billing history reads it.
- [x] 4.3 The counter's no-shift screen loses its *Open a shift* link, which led to a page that said it did not exist, and says instead that the next operator confirms the tablet's code on their own phone. The existing test asserts there is no link.
- [x] 4.4 No spec delta: `counter-billing` already requires that no counter PIN exist. `docs/DEMO_MODE.md` says the PIN surface is gone, and the keypad check loses its one exemption.

## 5. End to end

- [x] 5.1 `e2e/counter.spec.ts`, *the counter from a physical keyboard*: customer, points and discount typed and confirmed with Enter; a keyed split payment where a mouse-focused Cash never answers Enter and a held Enter records one bill; a table keyed within the pad's rules, and Enter on a control reached with Tab staying that control's. Desktop and tablet.

## 6. Gate

- [x] 6.1 **Gate**: every billing pad takes typed digits, Backspace and Enter as it takes taps; a held Enter confirms once; no pad gains a text field. The whole of `verify.yml` run locally before pushing [owner, 2026-10-06]: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`, and the database job where this machine can run it.
