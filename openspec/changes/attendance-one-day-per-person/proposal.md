## Why

A person assigned to two outlets does not work two shifts in a day. They work at
Kalyani on some days and Kanchrapara on others. Change #28 assumed the opposite
and modelled attendance as one row per person **per outlet** per day, so a person
who worked at one outlet is derived **absent at the other** on the same date.
That phantom absence appears on the manager's day, on the person view, and on the
employee's own history, and it makes a month unusable for the one thing a month is
read for: counting the days somebody worked so they can be paid.

The reading surfaces make it worse. Attendance is filtered by outlet first and by
day-or-person second, so there is no way to ask the question the owner actually
has, which is "how many days did this person work in August", across every outlet
they worked at.

Production is clean: seven attendance rows, zero split days, one person holding
live staff assignments at both outlets. The wrong model is live but has not yet
produced a wrong row, so this can be fixed without a backfill.

## What Changes

**The record model**

- **BREAKING** A person holds at most one attendance row per business date,
  across all outlets. The unique constraint returns from
  `(person_id, outlet_id, business_date)` to `(person_id, business_date)`.
  Recording a genuine split day across two outlets becomes impossible.
- Absent is derived once per person per day, not once per person per outlet per
  day. A person with a row anywhere on a date is not absent anywhere on that date.
- The whole one-day-per-person rule lives in a single module, so restoring split
  shifts later means changing one function and two lines of migration rather than
  five screens.

**Check-in**

- A person assigned to several outlets whose device supplies no position at all
  is currently refused. They are now offered an outlet picker instead, and the
  row is recorded against their choice with no position, waiting for that
  outlet's manager exactly as any unlocated check-in does today.
- The picker appears only in that case. When a position exists, the fence still
  chooses and is never overridden.
- The "Check in at another outlet" action on the Employee home screen is removed.

**The reading surfaces**

- Attendance is read **By Outlet** or **By Staff**, and the outlet choice moves
  inside By Outlet. By Outlet keeps today's roll-call. By Staff keeps today's
  person view.
- The outlet selector becomes a multi-select for anybody who may see more than
  one outlet. Selecting several shows one combined roll-call, and a person who
  works at two selected outlets appears once, at the outlet they attended.
- A person who attended another outlet reads as working elsewhere on the outlets
  they did not attend, without naming where. That line disappears when the
  selection already covers the outlet they went to.
- By Staff spans every outlet the reader may see: one outlet for a single-outlet
  Franchise Admin, their own outlets for a multi-outlet one, all of them for the
  owner. The set is derived from the reader's live assignments in the database,
  never from what the client asks for.

**The surfaces themselves**

- Changing outlet, staff member, or range clears the old data and shows a
  loading placeholder that holds its layout. Today the previous outlet's
  roll-call stays on screen under the new outlet's name until the fetch lands.
- The attendance row card is redesigned: fewer words, chips instead of
  sentences, tighter spacing, and an outlet label when more than one is in
  scope. Every fact the spec requires stays on the card and stays available to
  a screen reader.

## Capabilities

### New Capabilities

None. This changes how existing capabilities behave.

### Modified Capabilities

- `attendance-and-location`: one row per person per business date rather than
  one per outlet; absent derived per person rather than per outlet; the no-position
  multi-outlet check-in gains an outlet picker instead of a refusal; the manager's
  reads span a set of outlets rather than one; the roll-call gains a working-elsewhere
  reading.
- `app-shell`: the outlet-scoped selector may select several outlets at once,
  while still conferring no authority.
- `design-system`: a loading placeholder that reserves the layout of what is
  loading, replacing bare "Loading…" text.

## Impact

**Database**

- One migration: swap the attendance unique constraint, and scope the
  person-range read to the reader's live assignments rather than to a single
  named outlet. No backfill (production holds no violating rows).
- RLS isolation tests must prove a Franchise Admin still cannot reach an outlet
  they hold no live assignment at, through the surface or a hand-crafted request.

**Code**

- `src/features/attendance/` throughout: `attendance-record.ts` (the collapse
  rule), `outlet-attendance.tsx` (both axes), `my-attendance.tsx`,
  `check-in-card.tsx`, `evidence.tsx` (the shared card, which redesigns all
  three surfaces at once), `attendance-range.ts`.
- `src/data-access/adapters.ts` and `src/data-access/supabase-adapters/attendance.ts`:
  `listOutletDay` and `listPersonRange` take a set of outlets.
- `src/features/outlet-scope`: multi-select.
- `src/components/ui/`: a new loading placeholder component.
- Mock adapters and demo mode must match the new model, or the demo shows the
  bug this change removes.

**Docs updated before archive**

- `docs/DATA_MODEL.md`: the attendance uniqueness rule.
- `docs/SCREENS.md`: the By Outlet / By Staff hierarchy, multi-select, the
  employee check-in picker.
- `docs/DESIGN_SYSTEM.md`: the loading placeholder.
- `docs/ROLES_AND_PERMISSIONS.md`: which outlets each role reads By Staff across.
- `docs/LIMITATIONS.md`: split shifts across outlets are not recordable.

## Non-goals

- **Payroll.** By Staff counts days so somebody can compute pay by hand. It does
  not hold rates, compute amounts, or produce a payslip.
- **Split shifts.** Deliberately made impossible. The reversal path is kept cheap
  and documented, and is not built now.
- **An outlet picker when a position exists.** The fence remains the only chooser
  whenever there is a reading to choose from.
- **Changing the approval rules.** Who may approve, when a reason is required, and
  what an approval records are all unchanged. Only where the approval is judged
  from moves, from the view's single outlet to each row's own outlet.
- **Backfilling or repairing existing rows.** Production has none to repair.
- **A general design-system overhaul.** The card redesign is scoped to attendance,
  plus the one shared loading placeholder it needs.
