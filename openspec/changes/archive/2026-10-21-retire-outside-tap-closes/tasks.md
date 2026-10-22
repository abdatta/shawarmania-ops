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
- [x] 1.5 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run build`; the browser suites on Staging.
  *(Green on `stage` as `56d103cb`, and in Deploy `f0b4c7c6`'s full suite on 16
  October.)*
- [x] 1.6 Release: push to `stage`, Staging green, the owner promotes. The gate's row
  is left alone and keeps reading on, so a tablet on an older build keeps closing
  pop-ups on an outside tap.
  *(Promoted: first live in Deploy `f0b4c7c6`, 07:07 UTC on 16 October.)*

## 2. Wait for every tablet

- [x] 2.1 Every tablet's build, on the Change gates page, is the retirement build or
  later, continuously for a week. Record the date it was first true and the evidence.
  *(Read-only on 21 October: both registered devices report `0b06e73`, which
  contains `56d103cb`, after Cafe Laptop was removed; five services on it, 16–20
  October. The owner set three services in place of a week on 18 October, and
  reloaded the app on their phone.)*

## 3. The contract migration

- [x] 3.1 A migration headed `-- release: contract outside-tap-closes` that sets the
  gate's `retired_at` and turns it off. Nothing else in the schema belongs to this
  gate.
  *(`20261031000000_contract_outside_tap_closes.sql`. Nothing in production or a
  fresh reset reads the key.)*
- [x] 3.2 Every database gate on a fresh reset; release it.
  *(On a fresh reset with the other three contracts, 21 October; see
  retire-dish-ticks 3.4. Released with them.)*

## 4. Archive

- [x] 4.1 Report what was retired and when, then archive.
  *(Archived 21 October. The four contract migrations ran in production at 11:56 IST
  (Deploy of `da900d55`), setting `retired_at` on all four rows. Both registered
  devices, Kalyani Counter 2 and Shawarma Kitchen, were reporting `167bd0f1`, which
  contains it, by the evening.)*
