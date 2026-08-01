## Context

Three complaints, one seam.

The owner cannot see an outlet's attendance without granting themselves a
Franchise Admin assignment at it. The database never asked for that: every
outlet-scoped policy carries an `app_is_owner()` branch, `attendance_guard`
resolves "is this person an admin here" as *owner, or manager at this outlet*,
and `countWaitingByOutlet` is a plain filtered select with no owner gate at all,
so the owner's badge counts already span every outlet. The refusal lives entirely
in the shell, in three places that all ask the same question:

- `visibleSurfaces(heldRoles(session), mode)` in both shells,
- the surface lookup in `GatedSurface`,
- `held.includes(asked)` in `RealRoot`, which redirects a role path home.

`heldRoles` answers *which roles do this person's live assignments confer*, and
Attendance is registered under `franchise_admin`. So an owner with no assignment
gets no entry and no route.

The self-granted assignment then causes the second complaint. `worksAt` treats a
`franchise_admin` assignment as working at the outlet, so the roll-call lists
managers, and lists the owner as soon as they self-assign. Nobody records a
manager's arrival, and a self-appointed owner is on the list twice over by
accident.

The third is smaller and older. `useOutletScope` holds the chosen outlet in
component state by decision D6 of `multi-outlet-people` (#22): the selection was
deliberately made not to outlive the surface. That was the right call when it was
about a two-outlet manager and one surface. It is the wrong call now that the
owner reaches four surfaces at every outlet.

The demo hid all of this, because the demo owner persona is given a Franchise
Admin assignment at Kalyani.

## Goals / Non-Goals

**Goals:**

- The owner reaches every outlet's outlet-level surfaces holding no assignment,
  and nothing is written to `assignments` to achieve it.
- The cash boundary is provably unmoved: no close, no withdrawal, at an outlet
  the owner does not run.
- An outlet's attendance day lists the people whose attendance is tracked, and
  never becomes a list that cannot settle its own counts.
- One remembered outlet, per person, shared across surfaces, surviving a reload.
- No migration, no policy change, and the isolation suite proves the claims
  rather than the UI asserting them.

**Non-Goals:**

- The drawer at an outlet the owner does not run. Recorded as a design question
  in `daily-cash-live` (#12).
- Curating the owner's navigation. See D9.
- Any change to who may check in, or to the Biller's absence from the roll-call.

## Decisions

### D1 — Reachable roles are a second question, not a wider answer to the first

Add `reachableRoles(session)` beside `heldRoles(session)`. Held roles stay
exactly what they are: the roles this person's live assignments confer. Reachable
roles are held roles plus, for a session holding `super_admin`, the
`franchise_admin` surfaces. Only the three gates above switch to it.

`heldRoles` keeps every other caller, and the important one is the account menu,
which tells a person which roles they hold. An owner who is not a manager
anywhere must not be told they are one.

Rejected alternatives:

- **Mutating `heldRoles`.** One function answering both questions is how a UI
  starts claiming authority it does not have. The account menu would lie the day
  it shipped.
- **A role hierarchy** (`super_admin` implies `franchise_admin` implies …).
  Rejected by the owner on 2026-07-28 and still wrong: a manager assignment at
  Kalyani confers nothing at Kanchrapara however senior it is. This change adds
  one specific reach for one specific role, not an inheritance rule.
- **`alsoReachableBy: ['super_admin']` per registry entry.** More flexible and
  more surface to keep correct: eleven entries would each carry a field whose
  only correct value is the same. If a second such rule ever appears, the
  registry is where it goes.
- **Writing implicit `super_admin`-derived assignment rows.** Rejected outright.
  Authority is derived from assignments; fabricating rows to express authority
  that does not come from an assignment corrupts the one table the policies
  trust, and the self-grant guard exists precisely to stop rows like these.

### D1a — A navigation entry stays inside the shell you are in

Found during implementation, decided by the owner on 2026-08-01.

Navigation links were built from the *surface's* role: a manager surface linked
to `/admin/...` whoever was reading. In real mode that is harmless — the session
comes from Auth, so `/admin/attendance` renders the owner's own session in their
own shell. **In demo mode it is not harmless at all**, because the role lives in
the URL there: an owner clicking their new Attendance tab would land on
`/demo/admin/attendance` and *become the manager persona*, who manages one
outlet. The owner's reach would have been unwalkable in the demo — the tab would
have proved the opposite of what it exists to show.

So a navigation entry now links under the segment of the shell the reader is in:
the owner's Attendance is `/owner/attendance`. Every role branch mounts the same
surface routes and `GatedSurface` resolves a path against the roles the session
can reach, so the surface rendered is identical; what changes is that the address
keeps the reader where they are. **The counter shell has always done this** —
every entry in its header is pinned to the biller base — so this is the phone
shell agreeing with a rule that already existed.

**A home is the exception.** An index surface keeps its own role's segment,
because two homes cannot share one address: a person managing one outlet and
working at another needs `/admin` *and* `/staff`, and the staff home is where
their check-in button lives. Collapsing the two would have cost them the one
action their other role cannot do for them.

And so, narrowly: **a home belongs to a role you hold.** An index surface of a
merely-reachable role is left out of navigation, which is what stops the owner
collecting a second dashboard tab pointing at their own shell. This is the one
piece of curation this change does, and it is forced by addressing rather than
chosen for taste — see D9, which still declines to curate the rest.

Rejected alternative: **linking everything, homes included, under the shell's
segment.** It reads cleaner until the manager-who-is-also-staff arrives, and then
it silently removes their check-in screen.

### D2 — Reach is not `managed`, and the drawer does not move

`useOutletScope().managed` stays `sessionOutletsFor(session, 'franchise_admin')`
membership. It is the flag surfaces use to narrow what they offer to what the
database will accept, and the database still accepts no cash write from the
owner's remote path: `cash_withdrawals_insert` and `close_business_day` have no
owner branch, by decision (#22).

So the owner reaches Cash at every outlet and is offered, at an outlet they do
not run, exactly what they are offered today: the day, and neither the close nor
a withdrawal. The reason is stated on the surface rather than discovered by being
refused, which is the existing pattern for the remote path.

This is the one place where "reaching a surface confers nothing" is load-bearing
rather than decorative, so the isolation suite gets the case explicitly.

### D3 — The roll-call asks a staff question, and it gets its own predicate

`worksAt(account, outletId)` currently means *holds `employee` or
`franchise_admin` at this outlet*, and it is used by exactly one caller: the
attendance surface. `isOutletPerson` is its unscoped twin and has no live caller.

Add `isStaffAt(account, outletId)` — a live `employee` assignment at that outlet
— and use it for the roll-call. Keep the assignment-shaped question for the
people surfaces, where a manager belongs on the list.

The predicate names the rule rather than enumerating roles, so the next role
added to the enum does not silently join the roll-call.

Rejected alternative: **filtering managers out at the call site.** The rule
belongs beside the other assignment predicates, where the People surfaces can see
that a different rule exists and why.

### D4 — Anybody carrying a row on the day stays listed, whatever their role

Waiting counts come from `attendance` rows, not from the roll-call. Narrowing
the list alone would let a manager's own recorded row sit in the count while its
row is invisible, and the badge would be unclearable for as long as the row
lived. That is worse than the problem being fixed.

So the day's list is the union of *staff at this outlet* and *anybody with a row
on the day shown*. The second half is free: the day's records are already
fetched, and `AttendanceRecord.personName` is already on the row, so a person off
the staff list renders from the row itself with no extra read and no account
lookup.

A person listed only because they have a row is offered Approve, because that is
the point, and not offered Record arrival, because they already have one.

Rejected alternative: **tightening the database** so a non-staff subject cannot
have an attendance row at all (`app_person_assigned_at` → staff-only). It would
refuse rows that already exist rather than explaining them, and it would put a
migration and a policy change into a change that needs neither. If it is ever
wanted, it wants its own change and a data audit first.

### D5 — The by-person view stays staff-only

The person picker offers staff at the outlet and nobody else. A range of days is
a *pattern*, and a pattern of days for somebody whose days are not tracked is a
pattern of nothing. A non-staff person's rows are read on the business day they
belong to, which is where anybody settling one is standing.

This is a real, small limitation and it goes in `docs/LIMITATIONS.md` rather than
being smoothed over.

### D6 — The remembered outlet lives in `localStorage`, keyed by person

One key, namespaced by the signed-in person's id, holding one outlet id. Read
once when the scope hook initialises, and only trusted after the outlet list
arrives: a remembered outlet that is not in the list the caller may see is
replaced by the default and rewritten, never rendered and never left blank. Sign
out clears it.

- **Per person**, because these are phones that get handed over. A key shared by
  every user would open the next person on the last person's shop.
- **Demo gets its own namespace**, so a demonstrator's choice cannot leak into a
  real session, matching how the demo is separated everywhere else.
- **Written on change, not on every render**, and a write failure is ignored: a
  browser refusing storage should degrade to today's behaviour, not break the
  surface.

Rejected alternatives:

- **`sessionStorage`.** Survives a reload but not a relaunch, and an installed
  PWA relaunches constantly. It would look fixed and behave forgetfully.
- **A URL parameter.** Makes a link outlet-pinned, which is a different feature
  with sharing semantics, and it would put an outlet id in every shared address
  for no gain.
- **A server-side preference row.** A table, a migration and a policy for a
  filter, plus cross-device sync nobody asked for. If the outlet choice ever
  needs to follow a person between devices, that is when it earns a row.

### D7 — Reversing #22's D6, on the record

`multi-outlet-people` design D6 and the `app-shell` spec both state the
selection "SHALL NOT persist into any other surface". That half is reversed here
deliberately, and the spec delta rewrites the requirement rather than quietly
adding to it.

What that decision was actually protecting is untouched, and the delta restates
all of it: the selection is not session state, there is no "acting as" and no
active role, and it confers no authority whatsoever. A crafted request naming an
outlet the person holds no assignment at is refused however the control is set.
The reversal is about convenience on a screen, not about scope.

### D8 — No migration, and the isolation suite carries the proof

Nothing about the database changes. What changes is which claims are *proved*:
the suite gains cases for an owner holding no assignment anywhere — reading an
outlet's attendance, approving a day there, recording a manual entry there, and
being refused a withdrawal and a day close there.

Those branches have existed since #22 and are the ones this change now depends
on for real. A UI that starts relying on a policy branch should leave a test
behind that would fail if the branch were ever edited away.

### D9 — Navigation crowding is accepted and recorded, not solved

Reaching every outlet-level surface adds up to eleven entries for the owner, and
`owner-pnl` and `owner-reports` were already left out of navigation because six
tabs is what a phone bottom bar holds. This change makes that worse in principle
and barely worse in practice: only `admin-dashboard` and `admin-attendance` are
live, so a real owner gains two entries today (People is already deduplicated by
label).

Accepted by the owner on 2026-08-01: the crowding becomes real as #10 to #13
promote Menu, Stock, Expenses, Cash and P&L, and whichever change first makes it
hurt is where the grouping gets designed. Curating it now would mean designing a
navigation pattern against surfaces that are still mock.

The manager `Today` entry does go for an owner who holds no assignment, but as a
consequence of D1a rather than as curation: it is a home, its address is the
owner's own shell, and two homes cannot share one address. Nothing else is
trimmed, and no grouping is invented here.

### D9a — The page header wraps rather than squeezing

Found by looking at the built app on a 390 px phone, which is what the
verification step is for.

`PageHeader` put the outlet selector beside the title in a `shrink-0` column. An
outlet selector is as wide as an outlet's name, so the title column collapsed to
a few characters and wrapped its subtitle into six short lines down the screen.
It was already true for a two-outlet manager; this change makes it the owner's
every screen, which is what turns a blemish into a defect.

The header now wraps: the title keeps the first line, and the selector drops
below it when there is no room. Nothing changes where there is room for one line
— the rail-width layouts are pixel-identical, People keeps its Add button beside
the title.

Rejected: styling around it on each surface, which would put the same fix in six
files and leave the seventh wrong.

### D10 — The demo keeps the owner's manager assignment, and gains the other walk

Keeping it is what makes D2 walkable: at Kalyani the demo owner closes the day
because of that assignment, and at Kanchrapara they cannot. Remove the row and
the demo loses the only demonstration that drawer authority comes from an
assignment rather than from being the owner.

What changes is the `demo-mode` spec's claim that the other outlet "is not"
reachable, which this change makes false. It becomes: both open, and the drawer
is the difference. The demo owner also leaves both attendance roll-calls, holding
no staff assignment at either, which demonstrates D3 without a fixture change.

## Risks / Trade-offs

- **Somebody reads "reachable" as authority and widens it** → held and reachable
  are separate functions with separate callers; the account menu keeps `heldRoles`
  and states only what assignments confer; no policy changes, so the database
  answers the same question it answered before.
- **A row listed for a non-staff person has no account behind it** → it renders
  from the record, which already carries `personName`. Approve is offered; Record
  arrival is not, since a row already exists. Nothing on that card needs the
  account.
- **A manager quietly disappears from a day they expected to be on** → surface
  only, no data. Their recorded rows still appear on the day they belong to, and
  the docs rows claiming a Franchise Admin checks in for themselves are corrected
  in the same change. Production is checked for such rows before shipping, so we
  know whether this is real or theoretical.
- **The remembered outlet is per browser profile, not per account across devices**
  → intended (D6), stated in `docs/LIMITATIONS.md`.
- **A stale remembered outlet strands a surface on nothing** → the value is
  validated against the outlets the caller may see and replaced by the default
  when it fails, which also covers an outlet closed or deleted since.
- **The owner's Attendance badge now counts every outlet for a person who was
  previously badged for one** → already the specified behaviour since #27; what
  changes is that the entry is now reachable without an assignment, which is the
  point.
- **Existing tests encode the old gate** → expected, and they are the cheapest
  possible signal that this change did what it says. Every test asserting the
  owner needs an assignment is rewritten to assert the new rule rather than
  deleted.

## Migration Plan

No schema change, no policy change, no data migration. The deploy is an ordinary
frontend deploy and the rollback is a revert: nothing this change ships writes
anything that would survive it.

Two things happen before it ships:

1. **Check production for attendance rows whose subject is a Super Admin or a
   Franchise Admin holding no staff assignment at that outlet.** The result does
   not change the design — D4 is right either way — but it tells us whether the
   union in D4 is load-bearing today, and it is the difference between a note and
   a live badge somebody is looking at.
2. **Check production for self-granted owner assignments** that exist only to
   reach these surfaces. After this change they are no longer needed for reading
   or approving, and each one now decides drawer authority at that outlet and
   puts its holder on that outlet's roll-call if it is a staff assignment.
   Whether to end any is the owner's call, not this change's; it is surfaced, not
   acted on.

## Open Questions

None blocking. Two questions this change deliberately leaves elsewhere:

- Whether the owner may close a day or record a withdrawal at an outlet they do
  not manage → `daily-cash-live` (#12), design question.
- Whether a Biller's attendance is tracked → `counter-devices-and-offline` (#9),
  design question, beside whether the Biller account role survives.
