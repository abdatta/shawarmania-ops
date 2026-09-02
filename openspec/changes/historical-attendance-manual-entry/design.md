# Design: historical-attendance-manual-entry

## Context

The manager's day view assembles current visible staff with attendance rows for
one selected business date. When the deadline has passed and no row exists,
`readDay` derives **Absent** without writing anything. On today's business date
the expanded row offers **Record arrival**. That sheet asks only for the actual
arrival time; the adapter sends person, outlet, explicit business date and ISO
instant; and `attendance_record_manual` atomically appends one manual attempt and
one `manual_present` decision while stamping the acting manager and settling the
day.

Three facts cause the present gap:

1. the UI gates `offerManual` on `businessDate === today`;
2. the sheet copy hard-codes “today's business day”; and
3. the security-definer command requires the named business date to equal the
   outlet's current business date.

The adapter shape, demo record model, historical evidence renderer, append-only
history and global one-person-date constraint already handle a manual row whose
business date is in the past. The change therefore expands one command rather
than introducing a parallel correction path.

## Goals / Non-Goals

**Goals:**

- Put the same **Record arrival** action on a past derived-absent row for a
  person who is valid staff there on that date.
- Preserve the exact current-day time-only interaction and manual-entry audit
  semantics.
- Make historical date membership and outlet cutover correctness database
  boundaries, not UI assumptions.
- Keep the current live manager authority and profile visibility boundary.
- Preserve one person-day across outlets, append-only evidence and decisions,
  exact command replay behavior and demo/live parity.

**Non-Goals:**

- Scheduled absence rows, historical roster browsing, departed-person profile
  visibility, attendance offline support, leave/half-day entry or payroll.
- A reason field for manual entry, manager GPS, or approval after entry.
- Table, enum, policy, grant, RPC-signature, gate, route or layout changes.
- Any roadmap edit.

## Decisions

### D1. Reuse `Record arrival`; a row-less absence is not a correction

The existing button, `ManualEntrySheet`, adapter method and
`manual_present` database transition remain the single flow. A derived absence
has no attendance id and therefore cannot honestly enter `attendance_correct`.
Recording the missing event creates the canonical person-day and its immutable
attempt/decision history; it does not rewrite a prior row or manufacture rows
for anybody else.

The card keeps the label **Record arrival** on every date. The sheet names the
selected business date using the app's unambiguous date formatter. Today may
still read “today's business day”; a past date reads the actual date. The input
remains one arrival time and the submit action remains **Record it under my
name**.

Rejected alternatives:

- **Use Correct attendance.** There is no row to correct, so this would either
  invent a fake id or make one button mean two incompatible command shapes.
- **Add a separate Backfill attendance flow.** It duplicates the same time,
  outlet, attribution and settlement behavior under different words.
- **Write absent rows every night.** This reverses the established derived-state
  contract and creates monitoring data nobody explicitly recorded.

### D2. The offered row must be staff on both relevant clocks

The person must satisfy two independent conditions:

1. **current visibility:** they hold a live Employee or Biller assignment at a
   selected outlet, which is why the Franchise Admin can see them and matches
   today's existing roll-call boundary; and
2. **historical membership:** an Employee or Biller assignment at the chosen
   outlet covers `business_date` (`started_on <= date` and `ended_on` null or
   `ended_on >= date`).

The UI derives the eligible outlets from the assignment rows already returned
through the adapter. It does not show a row as absent or offer manual entry
before the person started, after the applicable assignment ended, or at a
selected outlet where they were not staff that day. Where two selected outlets
both qualify, the existing outlet chooser remains; otherwise it stays absent.

The database repeats both conditions from `public.assignments`. This prevents a
hand-crafted request from recording a day before employment, after historical
membership or at an outlet chosen only in the client. The acting session must
still be a live Super Admin or a live Franchise Admin at the target outlet.

Rejected alternatives:

- **Trust the current staff list alone.** A person hired last week would be shown
  as absent—and writable—on older days.
- **Allow any historical employee, including departed-only profiles.** That
  widens Franchise Admin profile visibility and management reach beyond the
  requested same-row behavior. A later change can design historical roster
  administration deliberately.
- **Grant authority to whoever managed the outlet on the historical date.** Past
  authority is not present authority; the writer must be authorised now.

### D3. One RPC signature accepts current-or-past dates and proves the instant

A forward migration replaces `attendance_record_manual` with the same argument
list, return type, `security definer`, empty `search_path`, grants, command ids
and fingerprint. It captures one `v_now` and target outlet, then requires:

- current acting-manager authority at the outlet;
- current visible staff membership and staff membership covering
  `p_business_date`;
- `p_business_date <= app_business_date(v_now, outlet.cutover)`;
- `p_attempted_at <= v_now`; and
- `app_business_date(p_attempted_at, outlet.cutover) = p_business_date`.

The final condition is required even though `ManualEntrySheet` constructs the
instant correctly. Without it, a hand-crafted request could name one explicit
business date and store an attempted instant belonging to another, violating
the repository's time invariant. The business date remains an explicit stored
column; it is validated at write time, never derived later at read time.

A future named date and a future instant receive distinct stable refusals. A
wrong-day instant receives a third stable refusal. The adapter maps each to
plain-language feedback without exposing database prose as UI logic.

Rejected alternatives:

- **Remove only the current-day check.** It permits future named dates and
  mismatched date/time payloads through handcrafted calls.
- **Create a second historical RPC.** It duplicates authority, idempotency,
  append-only and tenancy rules and lets the two implementations drift.
- **Change the RPC signature.** No new command fact is needed, and changing it
  creates deployment compatibility work for no benefit.

### D4. Historical entry keeps the same audit, with no reason or location

The manager is attesting to an arrival event, not approving somebody else's
claim. The existing immutable attempt records the asserted `attempted_at`,
`source = manual`, enterer id/name, outlet, date and stamped deadline. The
decision records `kind = manual_present`, actor id/name and database decision
time. Their separation already shows both when the person is said to have
arrived and when the manager entered that statement.

No reason field is added. Today's identical attestation needs none, and the
owner asked for the same process. No manager position is read or stored because
their present location says nothing about where the employee was on a past day.
The enterer stamp remains the accountability in GPS evidence's place, and entry
continues to settle the day without a second approval.

Rejected alternatives:

- **Require a reason only for past dates.** It turns one action into two
  processes without adding an audit fact that the chosen time, actor and
  decision timestamp do not already express.
- **Read current manager GPS.** It would collect irrelevant employee-monitoring
  evidence and imply a fact about the historical arrival that it cannot prove.

### D5. Existing one-person-day and cross-outlet protections remain final

`unique (person_id, business_date)` continues to refuse a second day at any
outlet. The command's existing locked lookup by person/date refuses a manual
arrival when a check-in or outcome already exists. `attendance_elsewhere`
continues to suppress the action when an unreadable outlet already owns that
person-day. Successful entry changes exactly one derived absence into one
settled present day and contributes no waiting badge.

The migration changes no RLS policy. Its security-definer body re-derives actor
and subject scope from assignments, and REST/RLS probes cover another outlet,
Employee, Biller device, forged enterer and duplicate person-day requests.

### D6. Demo and live share the same eligibility and refusal semantics

The typed adapter signature does not change. The demo adapter adds the same
current-date ceiling, instant/date cutover check, current staff membership and
historical assignment-window validation before appending its existing manual
record. This prevents demo from advertising an action the live boundary would
refuse.

The component test that currently proves the past button absent is changed into
the positive end-to-end component proof and paired with before-employment,
working-elsewhere and already-recorded negative cases. Browser coverage records
a past arrival and then inspects the same entered-by/no-phone/settled evidence
already asserted for today.

### D7. No offline, money, gate or layout consequence

Attendance manual entry remains an online manager command; no outbox is added.
No money is read or written. No gate, route, navigation item, semantic token or
shimmer geometry changes. The new button occupies the same expanded-card action
slot already rendered today, so the responsive shape is established rather than
new.

## Risks / Trade-offs

- **[A current employee is displayed on a date before they joined]** → make the
  day-row clocks and action outlets date-aware from assignment windows, then pin
  the absence and button together in component tests.
- **[An outlet changed its deadline after the historical date]** → preserve the
  existing rule for row-less days: the outlet's currently configured deadline
  is the only available rule and is stamped when the manager records the event.
  The app stores no historical deadline schedule to reconstruct another answer.
- **[A person already worked at another outlet]** → keep the global unique key,
  security-definer person/date lookup and `attendance_elsewhere` suppression;
  prove the handcrafted duplicate is refused.
- **[Manager backdating changes a month used outside the app]** → this is the
  requested correction to attendance truth; preserve immutable actor, asserted
  time and decision time so the change is reviewable.
- **[Function replacement accidentally widens tenancy]** → keep the signature,
  grants and actor predicate byte-for-byte in shape, add historical subject
  predicates, and run the full pgTAP, REST/RLS and authenticated E2E suites.

## Migration Plan

1. Add a forward migration replacing only `attendance_record_manual` with the
   expanded date and assignment validation; preserve signature, grants,
   append-only writes and idempotent command identities.
2. Add database tests for accepted historical entry, wrong-day/future/date-window
   refusals, cross-outlet/non-manager scope, forged enterer, duplicate person-day
   and exact stored evidence.
3. Make the day UI and manual sheet date-aware, then align the demo adapter and
   refusal mapping with the database.
4. Update durable documentation and run generated-type parity; the unchanged RPC
   signature should produce no generated type diff.
5. Run every repository, browser, database and auth gate. Rollback is a forward
   function replacement restoring the prior date ceiling; accepted historical
   rows remain valid append-only attendance and are not deleted.

## Open Questions

None blocking. Historical entry for a person no longer on the visible staff
list remains deliberately outside this change.
