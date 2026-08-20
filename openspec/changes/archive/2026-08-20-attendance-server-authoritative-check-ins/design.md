## Context

Personal attendance is online-only, but its live self-check-in command currently accepts two clock-derived facts from the browser: `p_attempted_at`, taken from `GeolocationPosition.timestamp` (or `Date.now()` when position is unavailable), and `p_business_date`, derived from the device clock and the outlet cutover. PostgreSQL compares the first with `now()` and rejects any positive skew, then stores it as both immutable attempt time and canonical `check_in_at`. It separately stores `attendance_attempts.created_at` from the database clock.

That contract has now refused a real employee repeatedly because the submitted instant was later than database time. It is asymmetric as well: future skew is refused, but past skew can make a late arrival appear earlier. The original attendance design requires the real arrival time, explicit outlet business date, immutable evidence, idempotent commands and an online personal workflow; it never records a reason to make an employee device the time authority. Manager decisions already use database time. Manual attendance is deliberately different because a manager may attest to an earlier arrival when a phone died, somebody forgot, or the network was unavailable.

The current client also uses `new Date()` to decide which business date to load, whether a retry remains current at a target outlet and whether a candidate retry changes between on-time and late. Fixing only the stored timestamp would stop the immediate future-time refusal but would leave the phone clock in control of the surrounding “today” experience, especially near a cutover.

## Goals / Non-Goals

**Goals:**

- Give every phone self check-in one database-authored arrival instant and derive its explicit business date from that same instant and the target outlet's cutover.
- Make a forward or backward device clock irrelevant to acceptance, stored arrival time and lateness.
- Give the employee attendance client a backend-authored current date/reference instant for every assigned outlet without bypassing outlet RLS.
- Preserve immutable attempt evidence, exact command replay, changed-payload refusal, retry rules and database-computed distance.
- Keep already-loaded production clients able to call the existing RPC during a database-first rollout.
- Preserve the intentional supplied-time contract for manual attendance and manager time corrections.

**Non-Goals:**

- Attendance offline support, background location, rostering or scheduled attendance writes.
- A clock-skew tolerance, device-clock repair, or storage of additional untrusted device timing data.
- Changes to geofence selection, approval/denial authority, status meanings, deadlines, payroll consequences or historical rows.
- Any billing, counter-tablet or outbox clock change. Attendance remains online and this change adds no offline semantics.
- New money arithmetic or money data of any kind.

## Decisions

### D1. A self check-in's event clock is one database statement instant

`attendance_submit_attempt` captures one stable database statement instant at entry and uses it for the new phone attempt's `attempted_at`, canonical `attendance.check_in_at`, and any supersession timestamp produced by the same transition. The target outlet's stamped deadline remains a database fact, and lateness continues to compare the stored attempt time with that stamped deadline in Asia/Kolkata.

The geolocation reading still supplies coordinates and reported accuracy. Its device timestamp is neither stored as the arrival nor used to accept, reject, date or classify the attempt. The existing `created_at` remains the technical insertion timestamp; for a newly accepted phone attempt it will ordinarily equal the authoritative attempt time, but both columns stay because historical and manual attempts have distinct event and insertion meanings.

Alternatives rejected:

- A positive-skew tolerance still refuses sufficiently wrong clocks, continues to trust backward clocks and turns the chosen number of minutes into an undocumented attendance policy.
- Clamping the browser time to `Date.now()` compares two values from the same device clock and cannot establish server truth.
- Fetching a server offset and correcting the phone clock in JavaScript makes a cached network estimate the authority and reintroduces drift. The transaction already has the authoritative clock.
- Storing the phone timestamp in a new `position_captured_at` column collects more employee-monitoring data without a requirement that uses it. Coordinates and accuracy are the reviewable location evidence; database receipt is the attendance event.

### D2. The database derives the explicit business date; it does not derive one later at read time

For a new self check-in, the command calculates `v_business_date = app_business_date(v_now, outlet.business_day_cutover)` and writes that explicit value to both the canonical day and attempt. This obeys the repository rule that business dates are stored explicitly: the calculation happens once at the write boundary, never by interpreting `created_at` during a later read.

For a retry, the canonical row's explicit date remains fixed. The command uses the client-supplied date only to locate the row the client says it is amending, locks it, and then requires that the target outlet still regards that canonical date as current using `v_now`. A retry cannot move the person-day across a cutover. A first attempt ignores a skewed supplied date and uses the server-derived target date.

Alternatives rejected:

- Continuing to validate the phone-derived date against the server date would leave a clock-skew failure under a different message.
- Deriving `business_date` from `attempted_at` at read time would make historical membership depend on a timestamp interpretation and violate the explicit-date invariant.
- Applying one global 04:00 date ignores per-outlet cutovers and breaks cross-outlet retries.

### D3. A narrow backend context read supplies the employee surface's clock

The attendance adapter gains a typed current-context read for an explicit set of outlet ids. One database statement returns one `server_at` plus each readable outlet's `current_business_date`, derived from that same instant and its own cutover. The employee home and own-attendance surfaces use that response to choose the dates they query, label today, determine whether a retry target is current and preview on-time/late material changes.

The read is security-invoker shaped over `outlets`, so existing outlet RLS remains the authority. It returns no row for an outlet the caller cannot read and exposes no attendance or cross-outlet operational fact. It adds no table and requires no new RLS policy. A handcrafted list containing another outlet therefore gains neither its date context nor any attendance data.

The context is refreshed on attendance surface load, foreground return and when a named day-rollover/stale-context response is received. There is no polling or background clock. The write command remains final: if a deadline or cutover is crossed after the context read, the stored server instant and date win, the response replaces the preview, and a retry whose canonical date is no longer current is refused by name and reloads.

Alternatives rejected:

- A generic unauthorised “server time” endpoint lacks the outlet cutover result the surface actually needs and invites callers to reconstruct business dates inconsistently.
- Keeping `new Date()` for loading while changing only the RPC would fix ordinary check-ins but still show or query the wrong day around a skewed cutover.
- A timer that continuously advances context adds background behaviour for a boundary crossed at most once per outlet per day; foreground and named-stale refresh are sufficient.

### D4. The deployed write signature remains callable, but its clock fields lose authority

The migration replaces the body of the existing `attendance_submit_attempt(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer)` function without removing or renaming its parameters. Already-loaded clients may continue sending `p_business_date` and `p_attempted_at`; the database no longer stores either as the time/date authority for a first self check-in.

The legacy values remain part of the request fingerprint during the compatibility period because they are client-supplied payload facts. An exact replay therefore finds the existing attempt by id and fingerprint before current-date checks and returns the original database-stamped row, including after a cutover. Reusing the id with a changed date, timestamp, coordinates, accuracy or expected version remains a changed-payload refusal. Server-generated `v_now` and derived date are not fingerprint inputs: replay must not manufacture a mismatch from a different execution time.

The updated adapter still sends the required legacy parameters while consuming current context for its UI and requested date. Removing those parameters is a later compatibility cleanup, not part of this change.

Alternatives rejected:

- Dropping or renaming the function in the same deployment creates a window where an already-open installed PWA receives `PGRST202` and cannot check in.
- Including server time in the fingerprint makes every replay look different and defeats idempotency.
- Excluding all legacy payload fields from the fingerprint would allow a command id to be reused with changed client evidence without detection.

### D5. Manual and corrected times remain explicit testimony

`attendance_record_manual` and the time-correction command keep their supplied timestamp contracts. A manager uses those paths precisely to state when somebody actually arrived, including earlier on the current or historical business day. The database continues to stamp the actor and decision time itself, reject future/wrong-day testimony and preserve the original attempt plus append-only corrections.

Self check-in and manual entry therefore have intentionally different clocks:

- phone self check-in: database receipt is the arrival;
- manual entry or correction: the authorised manager's chosen time is the asserted arrival, while the database separately stamps who asserted it and when.

Alternatives rejected:

- Server-stamping manual arrivals would remove the escape hatch for a dead phone, forgotten check-in or network outage.
- Allowing a phone user to choose a past time would turn the escape hatch into unaudited self-backdating.

### D6. Demo mode receives an adapter-owned reference clock

The typed adapter contract exposes the context read, so screens remain unaware of Supabase. The Supabase implementation reads database context; the demo adapter returns the same shape from its own injected/reference clock and uses that same instant for demo self check-ins. Components do not fall back to `new Date()` as attendance authority. Demo remains origin-local and writes no real data.

### D7. The database boundary and existing tenancy model remain unchanged

No service-role key, Edge Function, table, client mutation grant or policy widening is introduced. The existing security-definer self-check-in command continues to derive the caller, active account/device state and staff assignment from the session. The new context read is bounded by existing outlet visibility, and the full RLS suite proves that naming another outlet returns no context and confers no attendance reach.

## Risks / Trade-offs

- **[Database receipt is later than the employee's tap while GPS or the network is slow]** → Define receipt as the auditable online arrival boundary, request GPS and context together where practical, keep the existing manager manual-entry/correction escape hatch, and show the stored result returned by the database rather than the provisional preview.
- **[A cutover or deadline is crossed between context read and write]** → Let the write's single database instant win; return the stored classification, and use the existing named day-closed/stale flow to refresh rather than accepting a retry onto the wrong date.
- **[Old and new clients coexist]** → Preserve the old RPC signature and make its body safe first; deploy the context-consuming client second. No release ordering can reintroduce the future-time refusal.
- **[Two server timestamp columns appear redundant for new phone attempts]** → Keep `attempted_at` as event semantics and `created_at` as insertion semantics because manual and migrated history already distinguish them; document the equality expected for new phone attempts.
- **[Removing the phone timestamp loses a way to diagnose device skew]** → Do not retain employee-monitoring data solely for diagnostics. Operational logs may record named rejection classes and request ids, never coordinates or personal payloads; the new path no longer needs clock-skew diagnosis to succeed.
- **[A security-invoker context read is accidentally treated as cross-outlet authority]** → Require explicit outlet ids, rely on existing outlet RLS, add direct REST/RLS probes for an unassigned outlet, and keep all attendance writes behind the existing command.

## Migration Plan

1. Add the current-context database read and replace the existing self-check-in function body in one forward migration. Preserve its name, argument list, grants, empty `search_path`, session-derived authority and exact-replay-first ordering.
2. Add database and REST proofs before changing the client: forward and backward submitted clocks, server-derived dates on both sides of cutover, cross-outlet retry date preservation, deadline lateness, old-payload compatibility, exact replay after rollover and changed-payload refusal.
3. Regenerate database types, then extend the typed adapter and both Supabase/demo implementations with current context.
4. Move employee attendance loading, target-date selection, retry availability and material-change preview to adapter context; refresh on foreground and named stale responses.
5. Update durable documentation and run the complete ordinary, database/RLS and authenticated E2E gates because the change contains a migration and changes an Employee role index.

The migration is non-destructive and leaves historical rows untouched. If the frontend must roll back, the previous client continues to call the compatible function and receives safe server-stamped attempts. The database migration should not be reversed in production: restoring device-clock authority would recreate the incident. A forward corrective migration is the rollback path for any defect in the function or context read.

## Open Questions

None. The authority boundary, compatibility contract and manual-entry exception are settled by this design.
