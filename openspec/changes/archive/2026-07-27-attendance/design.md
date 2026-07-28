# Design: attendance

## Context

The server half of attendance was built dormant by `data-model-and-tenancy`
(#2) and has been sitting there since:

- `employees` — the HR roster, deliberately separate from `profiles`. Managers
  manage it; an employee may read their own row (`profile_id = auth.uid()`).
- `attendance` — one row per employee per business date (unique constraint),
  with the evidence columns for check-in and check-out independently:
  coordinates, accuracy, distance, source. Plus `override_by` / `override_reason`
  / `override_at`, held together by a CHECK that all three are present or none.
- `attendance_guard()` — freezes the identity columns (employee, outlet,
  business date) and refuses an override from anyone but a Franchise Admin or
  Super Admin writing their *own* id into `override_by`.
- Read policies that give a manager the outlet and give an employee **only
  their own rows** — the asymmetry the proposal warns about is already
  impossible in the right direction.
- `outlets` already carries `latitude`, `longitude`, `geofence_radius_m`
  (default 150), and `outlets_update` is Super Admin only.

`auth-and-roles` (#4) left a real session, the adapter seam, and five surfaces
`live`. What is missing is entirely client-side, plus one piece of server logic
that the dormant schema cannot supply on its own: **nothing evaluates the
geofence.** `check_in_distance_m` is currently whatever the writer says it is.

Constraints that bind everything below:

- Location data is employee monitoring. Store what the policy requires and
  nothing more; capture at check-in and check-out **only**; never present a
  location flag as proof in a pay dispute (AGENTS.md).
- The employee's own history must show exactly what the manager sees.
- Any surface promoted to `live` renders in demo mode too, so it needs a mock
  adapter — the Employee's entire demo experience is attendance, and #8's
  four-role walkthrough dead-ends without it.
- Screens depend on the adapter interface, never on the Supabase client.

## Goals / Non-Goals

**Goals:**

- An employee checks in and out from their own phone, with real geolocation
  captured and stored as evidence beside the verdict.
- Out-of-fence check-in is refused, explained, and recoverable through a
  manager override recorded with who and why.
- A manager sees the outlet's day — who, when, from where, and the flags — and
  approves overrides from their phone.
- The outlet's position is captured **in place**, from the device standing at
  the counter, with the quality of the fix visible before it is saved.
- `employees` and `attendance` get their isolation cases, including that an
  Employee reads only their own rows.
- Mock adapters for every promoted surface, so demo mode still walks.

**Non-Goals:**

- No counter-tablet check-in kiosk (needs enrolled devices; arrives with #9).
  `counter-attendance-kiosk` stays `hidden`.
- No payroll, leave approval, or shift rostering.
- No background location tracking of any kind, ever, without its own proposal.
- No map picker. A geofence built from a map search is exactly what this change
  exists to prevent.

## Decisions

### D1 — The blocked state is derived from the evidence, not a new enum value

`attendance_status` is `('present', 'absent', 'half_day', 'leave')` — a
*payroll* verdict. "Awaiting override" is not a payroll state; it is a fact
about a row that the stored evidence already tells us:

```
awaiting override  ≡  check_in_at is not null
                      and check_in_distance_m > geofence_radius_m
                      and override_by is null
```

Such a row carries `status = 'absent'`: the person is not credited present
until a human blesses it, which is precisely what "block outside the radius"
means. When the override lands, the same update sets `status = 'present'`.

**Rejected:** adding `'pending'` to the enum. It would make every future payroll
consumer handle a value that is not a payroll outcome, and it would let a row be
neither present nor absent — a state with no answer to "was this person at work?"
The derived form has one answer at all times and needs no migration.

### D2 — The database recomputes the distance and refuses an out-of-fence "present"

The client computes distance to decide what to show. The database recomputes it
to decide what is true. A new `BEFORE INSERT OR UPDATE` trigger on `attendance`:

1. Recomputes `check_in_distance_m` and `check_out_distance_m` from the
   submitted coordinates and the outlet's stored position, overwriting whatever
   the client sent. A row can no longer claim "distance 8 m" while carrying
   coordinates three kilometres away.
2. Forces `status = 'absent'` when a check-in is out of fence and no override is
   recorded — so an employee cannot self-declare `'present'` from home.

It deliberately does **not** force `'present'` when inside the fence: a manager
marking someone `half_day` or `leave` is a legitimate write the geofence has no
business overruling. The trigger only ever *denies* the present claim.

The coordinates themselves stay spoofable — a browser geolocation API always is,
and AGENTS.md says so plainly. This closes the gap that RLS can close (the
verdict must agree with its own evidence) and leaves the gap it cannot (whether
the evidence is true) to a human, which is why the evidence is stored at all.

Runs `security definer` so it can read `outlets` regardless of the caller's own
read scope, in the same style as the existing `app_employee_outlet()`.

**Rejected:** evaluating in an Edge Function. It would be one more hop on the
hot path of the single most-used action in the app, and it could be bypassed by
writing to PostgREST directly — the trigger cannot.

### D3 — Check-in is gated; check-out is recorded and flagged, never blocked

The schema carries **one** override per row (`override_by`, `override_reason`,
`override_at`) — the override blesses the attendance *row*, not one event on it.
That shape settles the question: check-in is the gated event, and check-out
stores its evidence and is flagged for the manager when far away, but is never
refused.

Refusing a check-out helps nobody. The person has already been recorded present
and has already done the work; blocking them leaves an open row for the manager
to repair, and the fix would need a second override slot the schema does not
have. Distance and accuracy are stored and shown either way, so a suspicious
check-out is just as reviewable — it is simply reviewed after the fact rather
than in the employee's way.

### D4 — Only the Super Admin captures an outlet's position

`outlets_update` stays Super Admin only; the capability matrix is unchanged, and
this change ships **no policy migration for `outlets`**.

The rationale is asymmetry of audit. A Franchise Admin already holds the
override — they can clear any out-of-fence check-in they like — but every use of
it is recorded with who and why. Moving the geofence achieves the same outcome
*silently* and for every future check-in at once. The two are not equivalent
powers, and the audited one is the one a manager should have.

The cost is the owner standing at each counter once per outlet. With two
outlets in adjacent towns that is an afternoon, and it is already written into
the change's user-only gate steps.

**Rejected:** capture-then-approve (a proposal row the owner confirms). Correct,
and far more machinery than two outlets justify. If a franchise ten outlets from
now makes the trip absurd, that is the change to write then.

### D5 — Accuracy policy: strict where it is permanent, forgiving where it is not

**Capturing an outlet position** — saveable below 25 m; 25–50 m saves but warns
in plain words about what a loose reference point costs; above 50 m the save is
refused and the screen suggests stepping outside. This number is judged against
a 150 m fence and, unlike a check-in, it is judged **once and permanently**: a
bad fix here poisons every future check-in, whereas a bad fix at check-in costs
one override.

**Checking in** — no accuracy threshold at all. Refusing a check-in because the
phone is unsure would strand exactly the people the counter-tablet fallback does
not yet exist for. The accuracy is stored and shown beside the distance, so a
manager reviewing "220 m away, ±180 m" can see the fix was never precise enough
to have refused anyone.

The verdict itself stays strict — `distance > radius` blocks, regardless of how
uncertain the reading was. Widening the fence by the accuracy would make a bad
fix into a licence, and the honest answer to an uncertain reading is a recorded
human decision, not a silently looser rule.

### D6 — Best-of-N for a permanent position, one reading for a check-in

Outlet capture runs `watchPosition` for up to ~8 seconds and keeps the **best**
sample by reported accuracy, showing the reading tighten live. Best, not mean:
averaging pulls a good fix toward a bad one, and these samples' accuracies
differ by an order of magnitude indoors.

Check-in takes a single `getCurrentPosition` with high accuracy requested and a
10-second timeout. One big button means one reading; the person is standing at
work waiting for it.

### D7 — One haversine, proven twice

Distance is computed in SQL (authoritative, D2) and in TypeScript (what the
screen shows before it writes). Two implementations of one formula is a
divergence waiting to happen, so a test pins them together: a table of fixture
coordinate pairs asserted against the same expected metres in both the domain
unit test and the pgTAP suite.

### D8 — The outlet records how its position was captured

Two columns added to `outlets`: `location_accuracy_m` and
`location_captured_at`. Without them the owner's screen can only show a pair of
numbers with no way to tell a surveyed fix from a placeholder — and the seeded
coordinates *are* placeholders, which is exactly the confusion the gate step
exists to end. Storing the evidence beside the verdict is the same principle
this feature applies to attendance; the reference point deserves it more, not
less.

### D9 — Three adapter interfaces, shaped by the screens

- `AttendanceAdapter` — today's own row, own history, the outlet's day, check
  in, check out, request an override, approve one.
- `EmployeesAdapter` — the roster: list, create, update employment status.
- `OutletsAdapter` gains `saveLocation()`, the only write the outlets surface
  makes.

Each gets a Supabase implementation and a mock implementation with the three
states the proposal names: a normal day, a blocked check-in awaiting override,
and an approved override.

### D10 — Geolocation lives behind one module

`src/lib/geolocation.ts` wraps `navigator.geolocation` and is the only place
that touches it. Everything above it takes a typed reading or a typed failure
(`denied`, `unavailable`, `timeout`, `unsupported`) — which is what makes the
blocked state testable without a browser permission prompt, and what keeps the
"no background tracking" rule enforceable by reading one file.

### D11 — Gate promotions

`staff-attendance`, `admin-attendance`, `admin-employees` and `owner-outlets`
move `hidden` → `live`. `staff-home` is already `live` and gains its real
content. `counter-attendance-kiosk` stays `hidden` (#9).

## Risks / Trade-offs

**A spoofed coordinate passes the fence** → Unfixable by design; browser
geolocation is client-supplied. Mitigated by storing all four evidence columns,
by D2 making the verdict agree with its own evidence, and by the standing rule
that a flag is never proof in a pay dispute.

**The owner never makes the trip, so outlets keep placeholder coordinates** →
The fence would judge everyone against a point nobody surveyed. Mitigated by
treating a null position as "not evaluated" rather than silently passing or
failing: check-in succeeds, distance is null, and both the employee's and the
manager's screens say the outlet has no captured position. `location_captured_at`
(D8) makes the gap visible on the owner's own screen rather than only in a
database.

**A phone that cannot get a fix cannot check in** → Real, and the proposal
accepts it: the manager override is the only escape hatch until #9 brings the
counter tablet. The blocked state names the override path rather than leaving
someone stuck at an error.

**Monitoring becomes something staff resent** → The employee's history shows the
identical row the manager sees, including the flags and the override reason.
Nothing is visible to a manager that is hidden from the person it is about.

**The `status = 'absent'` overload (D1)** → A blocked check-in and a genuine
no-show both read `absent`. Distinguished everywhere by `check_in_at is not
null`; both spec scenarios and the surfaces assert on that, and the risk is
recorded here so a future payroll change does not rediscover it the hard way.
