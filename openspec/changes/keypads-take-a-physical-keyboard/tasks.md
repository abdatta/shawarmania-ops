## 1. Route physical keys to the pad

- [x] 1.1 Add a keyboard hook to the shared `Modal` that presses a pad's `data-keypad-key` buttons for digits, `.`, Backspace and Enter, only in the innermost open dialog, never while a text field has focus, never with a modifier, and leaving Enter alone on a control reached with Tab.
- [x] 1.2 Swallow an auto-repeated Enter, and take Enter from a key the mouse left focused, so one press is one action.
- [x] 1.3 Read the number pad by position, so it types digits with Num Lock off too. Found in a real browser, where Num Lock off sends Page Up and arrows.
- [x] 1.4 Mark the keys and the primary action on the payment, points, discount, table and customer dialogs.

## 2. Pin it

- [x] 2.1 Points dialog: typed digits, Backspace and Enter reach the pad, and a held Enter confirms once. Shown to fail before 1.1.
- [x] 2.2 Customer dialog: digits typed into the name field stay in the name field. Shown to fail without the text-field guard.
- [x] 2.3 Probed once in real Chromium, desktop and tablet, and not committed: a mouse-focused key never answers Enter, a control reached with Tab keeps its own Enter, and a held Enter on the payment pad records exactly one bill, the same as paying by taps.
- [x] 2.4 `docs/SCREENS.md`: every number pad takes a physical keyboard, and a new pad joins by marking its keys.

## 3. Gate

- [x] 3.1 **Gate**: every billing pad takes typed digits, Backspace and Enter as it takes taps; a held Enter confirms once; no pad gains a text field. `npm run typecheck`, the touched test files, `npm run lint`, `npm run format:check`.
