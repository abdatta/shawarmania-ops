# Tasks: a-customer-name-is-capitalised

Read `proposal.md` and `design.md` first. The rule (D1), the counter line (D2)
and the one-time correction's procedure (D5) are settled with the owner; the
owner's ruling that a biller must be able to keep a name as typed is the
constraint every step serves.

## 1. The gate, off

- [ ] 1.1 Declare `customer-names-capitalised` (*NC*) in
  `src/change-gates/gates.ts`: kind `change`, change
  `a-customer-name-is-capitalised`, `retireBy` 2027-02-28, `roundTrip` `none: a
  capitalised name is ordinary text in the fields the off path already writes
  and reads; nothing is queued or stored in a new shape`.
- [ ] 1.2 Migration: the `change_gates` row, off, with the proposal's On and Off
  sentences, title `Customer names capitalised`, `change_number` null (not a
  roadmap change). Run `npm run lint:migrations` and `npm run lint:change-gates`.

## 2. The rule

- [ ] 2.1 `src/domain/customer-name.ts`: `capitalisedName(typed): string | null`
  per design D1, with unit tests covering every row of D1's table, plus empty,
  whitespace-only, digits-only and a name already capitalised (returns `null`).

## 3. The counter (demo first)

- [ ] 3.1 Unit tests in `customer-dialog.test.tsx` with
  `describeChangeGate('customer-names-capitalised', …)`, written first and seen
  to fail on: on, `rahul das` shows `Saves as Rahul Das` and confirm sends
  `Rahul Das`; Keep as typed sends `rahul das`; Capitalise sends `Rahul Das`
  again; the choice survives an edit to the name; `MD Rahim` and `AA` show no
  line and send as typed; a matched customer with a saved name shows no field
  and no line. Off: no line, sends the trimmed text, as today.
- [ ] 3.2 Implement D2 in `src/features/billing/customer-dialog.tsx` behind
  `useChangeGate('customer-names-capitalised')`, the off path untouched. Rewrite
  the comment above the name field: the 2026-09-19 decision, what the owner
  revised on 2026-11-22, and why mixed case is still saved as typed.
- [ ] 3.3 Find every existing test, unit or browser, that types an
  all-lowercase or all-capitals name of three or more letters and asserts it
  back verbatim; tag a browser test `@cg-off:customer-names-capitalised`, the
  only edit it may receive.
- [ ] 3.4 A browser test tagged `@cg-on:customer-names-capitalised` in the demo
  suite: ring an order, attach a new number with `rahul das`, see the line,
  confirm, pay, and read `Rahul Das` on the order card and in the bill; a second
  order with Keep as typed reads `SANJAY`. Screenshot the box at the counter's
  viewport with the line showing and check nothing above it moves.
- [ ] 3.5 Walk it in demo with the gate on and off; show the owner the box.

## 4. Docs and verification

- [ ] 4.1 Update `docs/SCREENS.md` (counter customer entry: "what is typed is
  what the bill snapshots" becomes what is saved and why) and
  `docs/DATA_MODEL.md` (the `customers.name` paragraph).
- [ ] 4.2 `npm run format`, typecheck, the touched tests, `npm run lint`; push to
  `stage` and read the Staging run for both gate states.
- [ ] 4.3 On staging: gate off, a lowercase name saves as typed; on, it saves
  capitalised and Keep as typed keeps it; off again, the counter is as before
  and the names saved while on still read capitalised.

## 5. The one-time correction (after release, on the owner's word)

- [ ] 5.1 After the gate has been turned on in production and pulled once,
  discovery read per design D5 step 1: counts only (to change, left alone,
  differing from `initcap`). Expect about 747 to change; explain any gap before
  going on.
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
  every item checked against the running app: with the gate on, a one-case name
  for a new number is shown and saved capitalised, Keep as typed saves it as
  typed, mixed-case and short names are untouched; with it off the counter is as
  today; the saved one-case names are corrected through the owner's rename with
  every bill's name unchanged, and the before-image undoes any of them. Release,
  the pull and archive follow the owner's word.
