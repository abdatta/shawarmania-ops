# Tasks: retire-outside-tap-closes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), in its two
halves. No gate of its own and no migration until section 3.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-15-a-popup-closes-when-you-tap-outside-it`.
  *(It was turned on in production at 08:44 IST on 15 October, pulled once (off
  09:24, on 11:48), and ran through that evening's service on `da92417`.)*
- [x] 0.2 The gate is on in production and has stayed on since its pull. *(Read
  from `change_gate_events`, read-only, on 16 October: on 08:44, off 09:24, on
  11:48, and nothing since.)*
- [x] 0.3 No gate depends on `outside-tap-closes`.

## 1. The retirement change — code only

- [x] 1.1 `Modal` keeps its outside-tap handling and reads only `dismissOnOutsideTap`;
  the install button's iOS hint keeps its outside-pointer listener. Neither reads a
  gate.
- [x] 1.2 `outside-tap-closes` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`,
  and out of the demo's gate words and history. *OT* is free for a new gate.
- [x] 1.3 Tests: `modal.test.tsx` and `install-prompt.test.tsx` lose
  `describeChangeGate` and keep the on cases as plain tests; the off cases go, and so
  does *the dialog with no change-gate provider*, which pinned the off answer.
  `e2e/dialog-outside-tap.spec.ts` loses its `@cg-off:` test and its `@cg-on:` tags,
  so the rest run in both suite states. Escape stays proved by
  `e2e/dialog-escape.spec.ts`.
- [x] 1.4 The `design-system` delta and `docs/DESIGN_SYSTEM.md`.
- [ ] 1.5 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run build`; the browser suites on Staging.
- [ ] 1.6 Release: push to `stage`, Staging green, the owner promotes. The gate's row
  is left alone and keeps reading on, so a tablet on an older build keeps closing
  pop-ups on an outside tap.

## 2. Wait for every tablet

- [ ] 2.1 Every tablet's build, on the Change gates page, is the retirement build or
  later, continuously for a week. Record the date it was first true and the evidence.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract outside-tap-closes` that sets the
  gate's `retired_at` and turns it off. Nothing else in the schema belongs to this
  gate.
- [ ] 3.2 Every database gate on a fresh reset; release it.

## 4. Archive

- [ ] 4.1 Report what was retired and when, then archive.
