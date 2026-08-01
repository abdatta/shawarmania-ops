Ordered so each layer is verifiable before the next depends on it. The database
holds the invariant first, the collapse rule gets one home second, and no surface
is built until both are true. If anything is cut for time it comes off section 6,
never off 1 to 3.

## 1. The record model, in the database

- [x] 1.1 Pre-flight against production, read-only: confirm zero rows violate
  `(person_id, business_date)` before adding the constraint. Re-read
  2026-08-01: **7 rows, 5 people, 2026-07-29 to 2026-07-31; 0 split days; 0
  duplicate `(person_id, business_date)` pairs of any kind; 1 person with live
  staff assignments at both outlets**; Kalyani and Kanchrapara both 04:00
  cutover, 13:00 deadline, 150 m, surveyed, active. No backfill needed.
- [x] 1.2 Migration: drop `attendance_one_per_person_outlet_day`, add
  `attendance_one_per_person_day unique (person_id, business_date)`. No backfill.
- [x] 1.3 Same migration: add the `elsewhere` `security definer` function (design
  D3) returning, for an outlet and a business date, the person ids on **that
  outlet's own staff list** who hold an attendance row at a different outlet that
  day. Person ids only: no outlet, time, status, evidence, approver or approval.
  Shipped as `attendance_elsewhere(uuid[], date)`: it takes the *set* the
  roll-call multi-select produces and intersects it with what the caller may
  see, rather than being called once per outlet.
- [x] 1.4 Same migration: drop the single-outlet requirement from the
  person-range read path so its scope comes from policy (design D4). Confirm the
  existing attendance select policy already yields exactly the reader's live
  assignment outlets, and change it only if it does not. **It does**: owner /
  `app_outlets_for('franchise_admin')` / `person_id = auth.uid()`. No policy
  change made; the confirmation is recorded in the migration and asserted in
  `supabase/tests/18_attendance_elsewhere.sql`.
- [x] 1.5 `test:db`: the constraint refuses a second row for the same person on
  the same date at a **different** outlet, and accepts rows at different outlets
  on **different** dates.
- [x] 1.6 `test:rls` isolation for the new function: a Franchise Admin at one
  outlet gets the elsewhere fact for their own staff, gets nothing for somebody
  who is not on their staff list, and is still refused the underlying row at the
  other outlet by a hand-crafted request.
- [x] 1.7 `test:rls`: a Franchise Admin's person-range read returns their own
  outlets and no others; a multi-outlet Franchise Admin gets exactly their two;
  a Super Admin gets all. Prove the third-outlet case from the spec.
- [x] 1.8 Regenerate `src/data-access/database.types.ts` from the local stack.

Also in this section, not foreseen when the tasks were written: the seed's
split-day pair violated the new constraint, so `Synthetic Split Shift` became
`Synthetic Two Outlets` with a day at each outlet on **different** dates,
readable from both sides. The pgTAP suites that asserted the split day were
rewritten to assert its refusal.

## 2. The collapse rule, in one module

- [x] 2.1 In `src/features/attendance/attendance-record.ts`, make the day reading
  answer per person per business date rather than per person per outlet per date.
  It is the only exporter of how a day reads; no view derives absence itself
  (design D2).
- [x] 2.2 Add the elsewhere reading to the day-reading type, distinct from
  absent, not-yet-arrived and recorded, carrying no outlet identity.
- [x] 2.3 Make the range tally count each business date once regardless of how
  many outlets contributed, so the by-staff summary is a day count.
- [x] 2.4 Unit tests: a person with a row at one outlet is not absent at the
  other on that date; a person with no row anywhere past the deadline is absent
  once; a recorded leave day still wins; days outside the assignment window are
  still uncounted.
- [x] 2.5 Write down in the module header what reversing this costs, so the path
  back to split shifts is discoverable from the code and not only from design D2.

## 3. Data access

- [x] 3.1 `listOutletDay` takes a set of outlet ids and returns the combined day,
  each record already carrying its outlet.
- [x] 3.2 `listPersonRange` drops its single `outletId` argument; its scope comes
  from policy (design D4). Update the adapter interface in
  `src/data-access/adapters.ts` and both implementations.
- [x] 3.3 Add the elsewhere read to the adapter interface and the Supabase
  adapter, returning person ids for an outlet set and a business date.
- [x] 3.4 Mock adapters match the new model exactly, including the elsewhere
  answer, so demo mode stops showing the phantom absence this change removes.
- [x] 3.5 Adapter-level tests for the combined day and the person range,
  including a person who worked at one of two selected outlets.

## 4. Check-in

- [x] 4.1 Replace the `unresolvable` refusal in `check-in-card.tsx` with an outlet
  question, offered only when there is no position at all **and** the person holds
  more than one assignment. Nothing is recorded until they choose.
- [x] 4.2 The chosen outlet's row is written with no coordinates and waits for
  that outlet's manager, on the same terms as any unlocated check-in.
- [x] 4.3 Leave the fence as the sole chooser wherever a reading exists,
  including out-of-fence: no picker appears there (design D5).
- [x] 4.4 Remove the "Check in at another outlet" action and the
  `canStartElsewhere` path, and remove its callers.
- [x] 4.5 Tests: multi-outlet plus no position asks and records against the
  choice; single assignment plus no position is never asked; out-of-fence
  multi-outlet still resolves to the nearest with no question; a recorded day
  offers no second check-in.

## 5. Shared UI

- [x] 5.1 Add a loading placeholder to `src/components/ui/` that reserves the
  space of what is loading, reads semantic tokens only, announces a busy region,
  and stays identifiable under reduced motion. No component like this exists in
  the repo today.
- [x] 5.2 Tests for it: announced busy, no hex literals, readable in both themes.
- [x] 5.3 Redesign the attendance row card in `evidence.tsx`: chips instead of
  sentences for distance, accuracy and source; the approval collapsed to one
  line; tighter spacing. This is the shared component, so it changes the
  manager's day, the person view and the employee's own history together, which
  the spec requires (design D9).
- [x] 5.4 Every fact the spec requires stays on the card, and every icon-only
  fact keeps an accessible name. Colour remains never the only signal.
- [x] 5.5 Add the outlet chip, rendered only when more than one outlet is in
  scope.
- [x] 5.6 `npm run contrast` and `npm run lint:tokens` pass with no new colour
  pair and no hex literal.

## 6. The surfaces

- [x] 6.1 Multi-select in `src/features/outlet-scope`: several outlets for
  anybody who may see several, none for anybody who may see one, the last one
  not deselectable, the whole selection remembered and validated against what the
  person may currently see.
- [x] 6.2 Restructure `OutletAttendance` to choose **By Outlet** or **By Staff**
  first, and move the outlet selector inside By Outlet.
- [x] 6.3 By Outlet renders the combined roll-call across the selection: one list,
  each row naming its outlet, a person appearing once.
- [x] 6.4 Judge the approval fence per row against its own outlet's position and
  radius, and key the 60-second position reuse per outlet so no reading vouches
  for two places (design D6).
- [x] 6.5 Take each row's radius, arrival deadline and lateness from its own
  outlet. Take "today" and the next-day control from the selection, showing the
  day as each outlet reckons it where cutovers disagree (design D7).
- [x] 6.6 The manual entry sheet asks which outlet only when the person is staff
  at more than one selected outlet (design D10).
- [x] 6.7 Render the working-elsewhere row from the elsewhere read, without
  naming the outlet, and suppress it when the selection already covers where they
  went.
- [x] 6.8 Scope the waiting badge, the earlier/later day marks and the owner's
  stranded-outlet chips to the selection rather than to a single outlet.
- [x] 6.9 By Staff reads across every outlet the reader may see, with the day
  count as its summary. No outlet picker on this axis.
- [x] 6.10 `MyAttendance` shows one combined history with each date once, never
  present at one outlet and absent at another.
- [x] 6.11 Wire the loading placeholder to every scope change: outlet selection,
  axis, person and range. Key loaded data by the scope that produced it and treat
  a mismatch as loading, following the pattern already correct in the by-person
  axis (design D8).
- [x] 6.12 Component tests for each of the above, including the stale-data case:
  changing outlet never renders the previous outlet's rows under the new name.

## 7. Demo mode

- [x] 7.1 Update demo fixtures so a multi-outlet person's month reads correctly
  under the new model, with days at both outlets and no phantom absence.
- [x] 7.2 The four-role demo walkthrough still walks end to end.

## 8. Docs

- [x] 8.1 `docs/DATA_MODEL.md` — attendance is unique per person per business
  date, and why.
- [x] 8.2 `docs/SCREENS.md` — By Outlet and By Staff, the multi-select, the
  working-elsewhere row, and the employee's no-position outlet question.
- [x] 8.3 `docs/DESIGN_SYSTEM.md` — the loading placeholder and when to use it.
- [x] 8.4 `docs/ROLES_AND_PERMISSIONS.md` — which outlets each role reads By Staff
  across, and the one bit that crosses the outlet boundary with its bounds.
- [x] 8.5 `docs/LIMITATIONS.md` — a split day across two outlets cannot be
  recorded, by anybody, including manually; the reversal path is two migration
  statements plus one module.
- [x] 8.6 `docs/SECURITY_AND_PRIVACY.md` — the elsewhere disclosure: what it
  reveals, what it deliberately does not, and why it exists.

## 9. Verification

- [ ] 9.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [ ] 9.2 Docker-backed: `npm run db:start && npm run db:reset`, then
  `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`. The auth suite
  is in the blast radius: this change moves what an outlet-scoped read resolves to.
- [ ] 9.3 Run the app on a phone viewport and a tablet viewport, in both themes:
  the employee's no-position outlet question, the combined roll-call across two
  outlets, By Staff for a multi-outlet person, and the loading placeholder on
  every filter change.
- [ ] 9.4 Confirm the migration applies to production with no backfill and no
  constraint violation, on the owner's authorisation.

## 10. PHASE GATE

- [ ] 10.1 **Gate**: a person staffed at two outlets checks in at one of them and
  is nowhere shown absent at the other, on the manager's day, on the by-staff
  view and in their own history; the other outlet's Franchise Admin sees them as
  working at another outlet with no outlet name, time or evidence, and is refused
  the underlying row by a hand-crafted request; a second row for that person on
  that date at either outlet is refused by the database, proved by a hand-crafted
  request; the same person with no GPS and two assignments is asked which outlet
  and their choice is recorded there waiting for that outlet's manager, while a
  single-outlet person is never asked; the owner selects both outlets and reads
  one combined day in which that person appears once, approving a row at each
  outlet with the fence judged per row; the owner reads that person's month and
  the day count reconciles exactly with the same days read by day; every filter
  change shows a placeholder rather than the previous outlet's rows under the new
  name; no new colour pair enters the contrast validator; and the four-role demo
  walkthrough still walks.
