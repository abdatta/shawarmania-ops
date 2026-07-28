# Tasks: blank-is-not-a-value

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first.
> Decision references (D1–D7) are to that design.

## 1. Production data, before anything else

> **This change cannot begin until `outlet-deletion` (#20) has shipped and the
> nameless outlet has been deleted through the app.** That is a hard dependency
> rather than a preference — the owner has ruled out renaming or editing the
> row, and a check constraint cannot be added while it exists. See D7.

- [ ] 1.1 **Confirm the nameless outlet is gone from production**, removed through the app by #20 rather than by hand.
- [ ] 1.2 Confirm no *other* outlet carries a blank or whitespace-only `name`, `code` or `location_label`. The constraint validates against every existing row; one survivor aborts the migration.
- [ ] 1.3 Re-check `employees.full_name` and `profiles.full_name`. Both were clean on 2026-07-28 — `employees` empty, both profiles named — so this is a re-measurement, not an open question (D7). It still matters: **a blank found here has no #20 equivalent to remove it**, since neither table has a delete path and none is planned. If one has appeared, settle correcting it with the owner *before* writing the migration.
- [ ] 1.4 Record what was found. If production was already clean, say so — a check that ran and found nothing is not the same as a check that was skipped. Local seeds are clean by construction, so a green local run is not evidence for any of this.

## 2. The migration

- [ ] 2.1 New migration `supabase/migrations/20260728000002_required_fields_not_blank.sql`. The number is second of three and is settled in D6's table, not chosen by counting — `…0001` is reserved for #20, which ships first.
- [ ] 2.2 `outlets_name_not_blank`, `outlets_code_not_blank`, `outlets_location_label_not_blank` — `check (length(btrim(<column>)) > 0)`, the identical shape to `employees_code_not_blank` in `20260727000004`. Do not invent a second form of this check (D4).
- [ ] 2.3 `employees_full_name_not_blank` and `profiles_full_name_not_blank`, same shape.
- [ ] 2.4 The same constraint on the columns whose surfaces are still ahead (D4): `menu_categories.name`, `menu_items.name`, `inventory_items.name`, `alerts.subject`, `alerts.message`, `alert_responses.message`, and `bill_items.item_name`. Naming convention `<table>_<column>_not_blank` throughout.
- [ ] 2.5 Before adding each of 2.4's constraints, confirm the table holds no violating row in production. All seven are empty or near-empty today, but the constraint validates against whatever is there at deploy time, not at authoring time.
- [ ] 2.6 A header comment naming the defect this closes — a nameless outlet reached production — and pointing at `20260727000004`, which is the same fix on a different column. The next person to add a `not null` text column should find this.
- [ ] 2.7 No column types change, no domain is introduced, no trigger is added. Constraints only (D4).
- [ ] 2.8 Regenerate database types if the generator reflects constraints; confirm nothing downstream breaks if it does not.

## 3. Database tests

- [ ] 3.1 New `supabase/tests/12_required_fields_not_blank.sql` — `11_` is reserved for #20 (D6). `supabase test db` globs the directory, so there is no registration step.
- [ ] 3.2 Inserting an outlet with `''` for `name`, for `code`, and for `location_label` is refused, one case each.
- [ ] 3.3 Inserting an outlet with `'   '` for each of those three is refused — whitespace is the case a `not null` column already accepted.
- [ ] 3.4 **Updating** an existing outlet's name to `''` and to `'   '` is refused. The create path is not the only way in (D4).
- [ ] 3.5 An outlet with ordinary values still inserts and updates — the constraint refuses blanks and nothing else.
- [ ] 3.6 The same insert/update/whitespace matrix for `employees.full_name` and `profiles.full_name`.
- [ ] 3.7 One insert-blank and one insert-whitespace case per column added by 2.4, so the guards on the not-yet-built surfaces are proven rather than assumed — they have no form test to back them up until #6, #7 and #11 arrive.
- [ ] 3.8 The existing isolation suite still passes unchanged. This change adds no table and alters no policy; that should be visibly true rather than assumed.

## 4. The Outlets surface

- [ ] 4.1 `src/features/outlets/outlets-surface.tsx` — `onSubmit` (line 165) checks `name`, `code` and `locationLabel` for `.trim() === ''` before calling the adapter, and returns early having set `error`. Follow `onProvision`'s existing shape (D2).
- [ ] 4.2 The message names the field that is missing, in this repo's voice — a sentence, not `Name is required`. One message per field, not one generic message for all three.
- [ ] 4.3 The guard runs on the edit path too, not only on create — it is one component for both, and clearing a name is the same mistake as never typing one.
- [ ] 4.4 **The submit button stays enabled** (D3). Do not add `disabled` to the outlet form's footer button; four required fields behind a dead button says nothing about which one is missing.
- [ ] 4.5 Leave `noValidate` on the form and `required` on the inputs (D1). Add a short comment saying why both stay, because their coexistence with an explicit guard reads as redundancy otherwise.

## 5. The Staff surface

- [ ] 5.1 `src/features/employees/employee-roster.tsx` — `onSubmit` (line 185) gains a `fullName.trim()` guard. The existing `employeeCode` guard at line 192 is **removed by #18**; do not restructure around it, and do not add a second guard to that field (D6 risk note).
- [ ] 5.2 The guard applies to the edit path as well as add.

## 6. The Access surface

- [ ] 6.1 `src/features/accounts/accounts-surface.tsx` — `onProvision` (line 201) gains a `fullName.trim()` guard, placed with the existing pre-write checks so all reasons to refuse sit together.
- [ ] 6.2 An `email.trim()` guard alongside it. `type="email"` is inert for the same reason `required` is, and a blank address provisions an account nobody can sign in to.
- [ ] 6.3 Do **not** touch the staff-code input or its guard at line 209 — #18 deletes both (task 6.1, 6.2 there).

## 7. Placeholders

- [ ] 7.1 `outlets-surface.tsx` lines 468, 480, 494 — prefix the three sample values with `e.g. ` (D5).
- [ ] 7.2 `src/features/attendance/outlet-attendance.tsx:342` — same treatment; it is a sample sentence presented as bare text.
- [ ] 7.3 **Do not touch** lines 520, 527, 534, 540, 549 of `outlets-surface.tsx`. Those placeholders are the accessible name of inputs carrying `aria-label` and no visible label; `e.g. City` would be incoherent (D5).
- [ ] 7.4 Do not touch `activate.tsx:166` (`XXXXX-XXXXX`, a format mask), the address-search placeholder (an instruction), or `employee-roster.tsx:458` (already open-ended, and optional).
- [ ] 7.5 No change to `Input` or to any token. The rule is copy, not styling (D5).

## 8. Coordination with the changes either side of this one

Build order is `#20 → #19 → #18` (D7). Numbering follows it, per D6's table.

#18's files were renumbered when this change was replanned, so these are
confirmations rather than edits. Verify rather than assume — a stale number is
found at deploy time, which is the worst moment (D6).

- [ ] 8.1 Confirm `outlet-deletion` (#20) has shipped and taken `20260728000001_*` and `11_*`. If it took different numbers, D6's table is what is wrong — correct it there first, then everything below.
- [ ] 8.2 Confirm #18's task 1.1 still reads `20260728000003_generated_staff_codes.sql` and its task 2.1 reads `13_generated_staff_codes.sql`.
- [ ] 8.3 Confirm no migration in `supabase/migrations/` sorts after this change's but was authored before it — the whole point of the numbering table.

## 9. Component tests

- [ ] 9.1 `outlets-surface.test.tsx` — submitting with a blank name creates nothing and shows a message naming the field; the same for a whitespace-only name.
- [ ] 9.2 A test that the outlet form's submit button is **not** disabled when fields are empty (D3) — it encodes the decision, which is otherwise indistinguishable from an oversight.
- [ ] 9.3 Editing an outlet to a blank name is refused by the form.
- [ ] 9.4 `employee-roster.test.tsx` — a blank full name creates no roster row.
- [ ] 9.5 `accounts-surface.test.tsx` — a blank full name and a blank email each refuse, and **no one-time code is issued** in either case.
- [ ] 9.6 A test asserting the three outlet placeholders begin with `e.g.` and that the address-block placeholders do not — the narrowness is the requirement (D5).

## 10. Docs

- [ ] 10.1 `docs/DATA_MODEL.md` — the invariants list (around line 15) gains the blank rule beside the existing soft-delete and explicit-grants conventions.
- [ ] 10.2 `docs/DESIGN_SYSTEM.md` — the placeholder convention and why it distinguishes sample values from label-substitutes.
- [ ] 10.3 `docs/SCREENS.md` — the Outlets paragraph, if it describes the form's fields in a way this changes.
- [ ] 10.4 `docs/LIMITATIONS.md` — remove any note claiming required fields are enforced only by the browser, if one exists.

## 11. Roadmap

> Row #19 was added to `openspec/changes/ROADMAP.md` at propose time. It is
> deliberately **not** a checkbox here: checking one task flips this change's
> derived status to `active`, which would claim implementation had begun.

- [ ] 11.1 Confirm row #19 still reads Wave B and that it matches this proposal's banner — the roadmap validator checks the two agree, and the wave letter is authored rather than derived.
- [ ] 11.2 `npm run roadmap:sync` after the last task is checked. Never hand-stamp a status.

## 12. Verification

- [ ] 12.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all green.
- [ ] 12.2 `npm run test:db` passes, including the new file and the untouched isolation suite.
- [ ] 12.3 `npm run test:e2e:auth` — this change touches provisioning, so the auth end-to-end path must be run rather than assumed.
- [ ] 12.4 Run the app on a phone viewport in both themes: try to create an outlet with a space for a name, and confirm the refusal names the field and is announced.
- [ ] 12.5 Confirm the migration applies cleanly against a database seeded from `supabase/seed.sql`, **and** state explicitly whether it was run against a copy of production data (D7).

## 13. PHASE GATE

- [ ] 13.1 **A blank or whitespace-only value cannot be written into any required field from any form in the app, and the database refuses it too** — the second clause proved by a hand-crafted request that bypasses the form, not by observing that the form refuses.
- [ ] 13.2 No placeholder in the app can be mistaken for a value already filled in, and no placeholder that substitutes for a label has been made incoherent in the process.
