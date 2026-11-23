# Tasks: a-customer-name-is-capitalised

Read `proposal.md` and `design.md` first. The rule (D1), the field correcting
itself as each word is finished and stopping once a corrected word is edited
(D2), and the one-time correction's procedure (D5) are settled with the owner.
**There is no new line or button at the counter**: the owner refused one on
2026-11-23.

## 1. The gate, off

- [x] 1.1 Declare `customer-names-capitalised` (*NC*) in
  `src/change-gates/gates.ts`: kind `change`, change
  `a-customer-name-is-capitalised`, `retireBy` 2027-02-28, `roundTrip` `none: a
  capitalised name is ordinary text in the fields the off path already writes
  and reads; nothing is queued or stored in a new shape`.
- [x] 1.2 Migration: the `change_gates` row, off, with the proposal's On and Off
  sentences, title `Customer names capitalised`, `change_number` null (not a
  roadmap change). Run `npm run lint:migrations` and `npm run lint:change-gates`.

## 2. The rule

- [x] 2.1 `src/domain/customer-name.ts`: `capitalisedWord` and
  `capitalisedName` per design D1, with unit tests covering every row of D1's
  test table, plus empty, whitespace-only, digits-only, a word whose case
  mapping changes its length (left alone), and a name already capitalised
  (unchanged).

## 3. The counter (demo first)

- [x] 3.1 Unit tests for a `useCapitalisingName` hook (D2, D4), written first and
  seen to fail: a space corrects the word before it; a pause (fake timers)
  corrects the word at the cursor; confirm returns `capitalisedName`; `RAH`,
  pause, `UL` gives `Rahul`; a backspace into a corrected word stops all further
  correction, confirm included; deleting only the space after it does not;
  fixing a typo in an uncorrected word does not; a paste is corrected at the
  next pause.
- [x] 3.1a **Cursor safety, before anything else in section 3 is called done**
  (design D2, "The cursor never moves"). One test per guard: a correction keeps
  `selectionStart`, `selectionEnd` and `selectionDirection`; a keystroke landing
  between the decision and the change drops the correction; nothing changes
  between `compositionstart` and `compositionend`, nor in the word being
  composed; a pause with the cursor inside the text changes nothing; a space
  typed mid-text corrects only the word behind the cursor. Then the invariant
  test: generated runs (at least a thousand, seeded so a failure replays) of
  keystrokes, spaces, pauses, cursor moves, selections, compositions,
  backspaces and pastes, asserting after every step that the cursor and
  selection equal a correction-off run of the same steps and the text equals it
  ignoring case. A failure here is fixed by skipping the correction, never by
  relaxing the assertion.
- [x] 3.2 Tests in `customer-dialog.test.tsx` with
  `describeChangeGate('customer-names-capitalised', …)`: on, typing `rahul das`
  shows `Rahul Das` in the field and confirm sends it; `MD rahim` sends
  `MD Rahim`; `McKenzie` is unchanged; going back over `Sanjay` to `SANJAY`
  sends `SANJAY`; no new text or button renders. Off: the field is never
  changed and confirm sends the trimmed text, as today.
- [x] 3.3 Implement the hook and wire it into
  `src/features/billing/customer-dialog.tsx` behind
  `useChangeGate('customer-names-capitalised')`, the off path's `onChange` and
  confirm untouched. Rewrite the comment above the name field: the 2026-09-19
  decision, what the owner revised on 2026-11-22 and 2026-11-23, and why a
  mixed-case word is still kept as typed.
- [x] 3.4 Find every existing test, unit or browser, that types a name the rule
  would correct and asserts it back verbatim; tag a browser test
  `@cg-off:customer-names-capitalised`, the only edit it may receive.
- [x] 3.5 A browser test tagged `@cg-on:customer-names-capitalised` in the demo
  suite: ring an order, attach a new number, type `rahul das` key by key, read
  `Rahul Das` in the field, confirm, pay, and read `Rahul Das` on the order card
  and in the bill; a second order typing `SANJAY`, backspacing into it and
  retyping, reads `SANJAY`. A third types `rahul`, waits past the pause, then
  types ` das` without a break and reads `Rahul Das`, with the caret at the end
  after every keystroke; a fourth moves the caret back into `Rahul Das` and types
  a letter, which lands exactly there.
- [ ] 3.6 The owner walks it in demo on the counter tablet itself, gate on and
  off, with the tablet's own keyboard (composition and autocapitalise are only
  real there), typing fast, pausing mid-word and going back to fix letters; tune
  the pause delay from what they feel. **Any cursor jump or misplaced letter seen
  there blocks the change**: skip more corrections (as a last resort, drop the
  pause correction and correct only at a space and on confirm) and walk it
  again.

## 4. Docs and verification

- [x] 4.1 Update `docs/SCREENS.md` (counter customer entry: "what is typed is
  what the bill snapshots" becomes what is saved and why) and
  `docs/DATA_MODEL.md` (the `customers.name` paragraph).
- [x] 4.2 `npm run format`, typecheck, the touched tests, `npm run lint`; push to
  `stage` and read the Staging run for both gate states.
- [ ] 4.3 On staging: gate off, a lowercase name saves as typed; on, it is
  capitalised in the field and saved so, and going back keeps a casing; off
  again, the counter is as before and the names saved while on still read
  capitalised.

## 5. The one-time correction (after release, on the owner's word)

- [ ] 5.1 After the gate has been turned on in production and pulled once,
  discovery read per design D5 step 1: counts only, by kind. 725 matched on
  2026-11-23; explain any gap beyond new customers since before going on.
- [ ] 5.2 Save the before-image outside the repository (D5 step 2); never commit
  it.
- [ ] 5.3 Dry run in one transaction as the owner through `customer_rename`,
  rolled back, the changed count asserted.
- [ ] 5.4 With the count in front of the owner and their yes, commit. Read back:
  the matched count is now zero, and no bill's or order's `customer_name`
  changed (count bills by `customer_name` before and after).
- [ ] 5.5 Keep the undo ready (D5 step 5) and tell the owner how to ask for a
  name back.

## 6. PHASE GATE

- [ ] 6.1 Not a roadmap change, so its checkpoint is the proposal's Gate line,
  every item checked against the running app: with the gate on, the name field
  capitalises each one-case word as it is finished with no new line or button,
  leaves mixed-case words and two-letter capitals alone, and stops for the name
  once a corrected word is edited; with it off the counter is as today; the
  matched saved names are corrected through the owner's rename with every
  bill's name unchanged, and the before-image undoes any of them. Release, the
  pull and archive follow the owner's word.
