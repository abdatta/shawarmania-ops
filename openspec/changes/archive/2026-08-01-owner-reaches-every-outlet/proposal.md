# Owner reaches every outlet

> **Model**: Opus · **Wave**: D · **Depends on**: #22, #26, #27 · **Gate**: a Super Admin holding **no** outlet assignment opens any outlet's attendance from their own navigation, approves a waiting day there, and records a manual entry there; the same session is offered neither a day close nor a withdrawal at that outlet and the database refuses both, proved by a hand-crafted request; no Super Admin or Franchise Admin appears on an outlet's attendance day unless they hold a staff assignment at it, while a manager who already has a recorded row on the day shown still appears so the count that named them can be cleared; an outlet chosen on one outlet-scoped surface is the outlet every other one opens on, after a reload, and is gone after signing out; and the four-role demo walkthrough still walks.

## Why

The owner has to appoint themselves manager of an outlet before they can see its
attendance. That is backwards. Running every outlet is what the owner role *is*,
and the database has agreed all along: every outlet-scoped policy carries an
owner branch, the waiting counts are scoped by those policies with no owner
filter written anywhere, and the attendance guard already treats the owner as an
admin at every outlet.

What blocks them is the shell. Navigation, routing and the role redirect are all
built from the roles a person **holds**, and Attendance is registered under
Franchise Admin. So the owner sees no Attendance entry, `/admin/attendance`
redirects them home, and the only way in is a self-granted manager assignment at
each outlet. Nobody designed that: [`docs/SCREENS.md`](../../../docs/SCREENS.md)
already says the owner reaches another outlet's operational surfaces through the
outlet selector in the header. The gate was simply never built for a person whose
authority comes from being the owner rather than from an assignment.

The workaround then causes a second problem. Those self-granted manager
assignments put the owner on the outlet's attendance roll-call, beside the
people whose attendance is actually being tracked. Managers are listed there too,
for the same reason: the roll-call counts a manager assignment as working at the
outlet. Neither is somebody whose arrival anybody records.

And the outlet selector forgets. It is per-surface state by an earlier decision,
so it resets on reload and every surface opens on its own default. For a manager
of two outlets that is mildly annoying. For an owner who now reaches four
surfaces at every outlet it is a choice re-made on every screen.

## What Changes

- **The owner reaches the outlet-level surfaces at every outlet, holding no
  assignment anywhere.** Navigation, routing and the role redirect stop asking
  only which roles a person holds and start asking which surfaces they can
  reach. For a Super Admin that is their own surfaces plus every Franchise Admin
  surface. Nothing is written to `assignments` to achieve it.
- **The roles a person holds stay a separate, honest question.** The account
  menu still lists exactly the roles their assignments confer. Reachability
  governs shells and navigation and nothing else, exactly as seniority does.
- **The cash drawer boundary does not move.** Whether the surface treats an
  outlet as one the reader *manages* stays a question about assignments, so at an
  outlet they do not run the owner still gets no day close and no withdrawal, and
  the database still refuses both. Reopening that is recorded as a design
  question in [`daily-cash-live`](../daily-cash-live/proposal.md) (#12), which
  builds the drawer.
- **An outlet's attendance day lists the people whose attendance is tracked**:
  those holding a live **staff** assignment at that outlet. A Super Admin or a
  Franchise Admin appears only if they also hold one, which is exactly the case
  where their attendance is a real thing.
- **Plus anybody carrying a recorded row on the day shown**, whatever role they
  hold. Waiting counts are computed from rows, so a row whose person is no longer
  listed would leave a badge nobody could ever clear. This keeps every count
  clearable and every recorded day visible where it happened.
- **BREAKING (surface only, no data)**: a Franchise Admin who holds no staff
  assignment disappears from their outlet's attendance day. Their recorded rows,
  if any, still appear on the day they belong to.
- **The chosen outlet persists and is shared.** One remembered choice per signed
  in person, used by every outlet-scoped surface, surviving a reload, validated
  on read against the outlets that person may see, and cleared on sign-out so a
  shared phone hands nothing to the next person.
- **BREAKING (decision reversal)**: `multi-outlet-people` (#22, design D6) ruled
  that the selection "SHALL NOT persist into any other surface" and "SHALL NOT
  survive as session state". The first half is reversed here deliberately. The
  part that mattered is untouched and restated: the selection is a filter, it
  is not session state, it is not an "acting as", and it confers no authority.
- **The demo keeps the owner's manager assignment at one outlet**, because that
  is what makes the drawer boundary walkable, and gains the walk this change is
  about: the owner opening the *other* outlet's operational surfaces, which is
  the walk the demo currently asserts is impossible.

## Non-goals

- **The drawer at an outlet the owner does not run.** Not widened here, by
  decision. See #12.
- **Curating the owner's navigation.** Reaching every outlet-level surface grows
  the owner's tab bar, and the phone bottom bar was already at its comfortable
  limit. Accepted for now (owner, 2026-08-01): only two of those surfaces are
  live today, so the real crowding arrives with #10 to #13, and the grouping
  decision belongs to whichever change first makes it hurt. Recorded in design
  rather than solved.
- **Billing from the owner's session.** Untouched. A bill belongs to an enrolled
  device and a shift.
- **Whether a Biller's attendance is tracked.** A Biller is not on the roll-call
  today and cannot check in, and this change does not alter that. It is now a
  design question in
  [`counter-devices-and-offline`](../counter-devices-and-offline/proposal.md)
  (#9), beside the open question of whether the Biller account role survives at
  all.
- **Rostering, leave and days off.** Still absent, still
  [`rostering-and-weekly-offs`](../../todos/rostering-and-weekly-offs.md).
- **Remembering anything else.** One outlet choice, not a general preferences
  store. No server-side setting, no sync across devices.

## Capabilities

### New Capabilities

None. Every requirement this change touches already exists.

### Modified Capabilities

- `app-shell`: navigation and routing derive from the surfaces a session can
  reach rather than only from the roles it holds, so the owner role reaches the
  outlet-level surfaces without an assignment; and the outlet a surface operates
  on persists across surfaces and reloads for one signed-in person while still
  conferring nothing.
- `identity-and-access`: the owner reaches every outlet's operational surfaces
  without being assigned there, stated beside the existing non-cash boundary,
  which is unchanged. A path for a role a session cannot reach still redirects.
- `attendance-and-location`: the outlet's attendance day is the outlet's staff,
  not everybody assigned there, plus anybody carrying a row on the day shown.
- `demo-mode`: the owner persona walks the outlet they manage *and* the outlet
  they do not, and the difference between them is the drawer rather than the
  door.

## Impact

**Code**

- `src/session/session.ts` — the roles a session can reach, alongside the roles
  it holds. The existing helper keeps its meaning.
- `src/shell/phone-shell.tsx`, `src/routes/gated-surface.tsx`,
  `src/auth/real-root.tsx` — the three gates that switch to reachability. The
  counter shell is untouched: a Biller shell is never the owner's.
- `src/features/outlet-scope.tsx` — the remembered choice, its validation and
  its fallback.
- `src/data-access/adapters.ts` — the staff-at-this-outlet question, separate
  from the outlet-person question the People surfaces ask.
- `src/features/attendance/outlet-attendance.tsx` — the day's roll-call, and the
  rows it keeps for people carrying records. `personName` is already on the
  record, so a row for somebody off the staff list needs no extra read.
- `src/data-access/mock/fixtures/personas.ts` and the demo attendance fixtures —
  the owner's walk at the outlet they do not manage.

**Database**

No migration. No policy change. The database already permits everything this
change makes reachable, and refuses everything it does not. The isolation suite
gains cases asserting exactly that, so the claim is proved rather than assumed:
an owner with no assignment reads and approves attendance at any outlet, and is
still refused a withdrawal and a day close there.

**Production data**

One thing to check before shipping, not after: whether any Franchise Admin or
Super Admin has a recorded attendance row in production. If any do, they are the
reason the day view keeps rows for people off the staff list, and the check
tells us the rule is load-bearing rather than theoretical.

**Docs to update before archiving**

- `docs/ROLES_AND_PERMISSIONS.md` — the owner's reach without an assignment; the
  capability matrix rows that currently say a Franchise Admin checks in for
  themselves; attendance as a staff-assignment fact.
- `docs/SCREENS.md` — the attendance day's roll-call, and the outlet selector
  being remembered across surfaces.
- `docs/ARCHITECTURE.md` — reachable roles beside held roles, and why the two are
  different questions.
- `docs/DEMO_MODE.md` — the owner's walk at both outlets.
- `docs/LIMITATIONS.md` — the remembered outlet is per device and per browser
  profile, and a non-staff person's recorded rows are reachable by day rather
  than through the by-person view.
