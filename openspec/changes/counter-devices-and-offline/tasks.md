> **Verification protocol for this change.** Every database rule below is written
> as a failing test **before** the function or policy that satisfies it, and each
> numbered section ends in its own provable gate rather than deferring everything
> to one gate at the end. This is what replaces the model originally assigned to
> this change; see the Model column note in `ROADMAP.md`.

## 1. Tablet, shift request and shift schema

- [x] 1.1 Write the failing DB tests first: one active tablet per outlet under concurrent setup, setup code single-use and expiring, request expiry, supersession and cancellation, confirmation only by the named person **and only with the correct code**, a wrong code counted and three wrong codes destroying the request, a used code refused a second time, confirmation refused when the assignment ended between request and confirmation, shift expiry at cutover, removal blocking the next request.
- [x] 1.2 Add machine-only `counter_devices`, setup codes stored as a hash no client role can read, shift requests carrying a hashed four-digit confirmation code and a wrong-attempt counter, shifts, and the partial unique index enforcing one active tablet per outlet.
- [x] 1.3 Add privileged setup, request, confirm, reject, cancel-request, end-shift and remove-tablet functions that re-derive caller authority from the database and never from the request body. The confirmation code SHALL be returned only to the requesting tablet and never exposed on a read of the request by anybody else.
- [x] 1.4 Remove synthetic device profiles and assignments from the seed, regenerate database types, and prove migration behaviour when an outlet already has tablet rows.
- [x] 1.5 Extend the catalog-driven RLS tests for every new outlet-scoped table, including a colleague refused a request naming somebody else.
- [x] 1.6 GATE: the whole request/approve/end/remove lifecycle is provable from `npm run test:db` and `npm run test:rls` with no UI involved.

## 2. The expense branch, on its own

- [x] 2.1 Write the failing DB test first: a device session with a live shift inserts an expense for its own outlet today; the same session is refused with no live shift, for another outlet, for a past business date, and when the body names a different recorder; and it is refused every day-record and month-aggregate read.
- [x] 2.2 Add the single `manual_ledger_expenses` policy branch for device sessions holding a live shift, attributing `recorded_by` from the shift row.
- [x] 2.3 GATE: the six assertions above pass, and no other `manual_ledger_*` policy changed. This section is separated deliberately because over-permission here is silent.

## 3. Role hierarchy and session boundary

- [ ] 3.1 Make Biller assignments satisfy Employee attendance and surface capabilities without creating a second assignment or widening FA/SA attendance.
- [ ] 3.2 Add device-session-first real-session resolution that requires no profile and never treats a device session as a person.
- [ ] 3.3 Add unit and real-backend auth tests proving a tablet cannot call personal or admin adapters, that no password field exists anywhere in tablet context, and that an ordinary Employee cannot hold a shift.
- [ ] 3.4 Tighten `public.app_may_look_up_customer()` to require a live shift, not merely a `biller` assignment. **Inherited from #32**, which had to define eligibility before shifts existed: it currently admits an active tablet or any account holding a live `biller` assignment, because that was exactly the set that could ring a bill at the time. Extend `supabase/tests/20_global_customer_identity.sql` with a Biller who holds an assignment but no live shift and is refused.

## 4. Tablet and approval surfaces

- [ ] 4.1 Build the admin setup-code flow on the Tablets surface (generate on the admin's own phone, shown once) and the tablet-side code entry screen.
- [ ] 4.2 Build the billing-only Counter shell, its shift-request screen, the waiting state that displays the four-digit code large enough to read across a counter, and its cancel path, keeping personal navigation unreachable for every operator.
- [ ] 4.3 Build FA/SA Tablets management with outlet scoping, last seen, last reported unsent count, clearly stale telemetry, and a removal confirmation that names what would be left unsent.
- [ ] 4.4 Build the request and live-shift cards on all three personal home surfaces, wired to the existing attention mechanism: the request card states outlet, tablet and time, takes the code, offers a rejection needing no code, and disappears with a reason when the request is cancelled or expires.
- [ ] 4.5 Add the RLS-scoped Realtime subscription for requests naming the reader and shifts they hold, and for the tablet watching its own request resolve, and prove every surface still resolves correctly with the channel unavailable.
- [ ] 4.6 GATE: two real browsers, one acting as the tablet and one as the phone, complete request, code entry, automatic entry into billing without touching the tablet, rejection, tablet-side cancellation withdrawing the card, remote shift end, and removal, in both themes and on phone and tablet viewports.

## 5. Documentation and verification

- [ ] 5.1 Update `docs/ARCHITECTURE.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/OPERATIONS.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/LIMITATIONS.md` and `docs/GLOSSARY.md`.
- [ ] 5.1a Sweep the PIN out of the documentation entirely. It is currently described as the shift-unlock mechanism in `ROLES_AND_PERMISSIONS.md`, `SCREENS.md`, `SECURITY_AND_PRIVACY.md`, `GLOSSARY.md`, `LIMITATIONS.md`, `OPERATIONS.md` and `DEMO_MODE.md`, and every one of those is wrong after this change. Redefine `shift` in the glossary as the approved counter session, and `grant` not at all.
- [ ] 5.2 Record in `docs/LIMITATIONS.md`, without softening: a shift needs the person's own phone and there is no fallback approver, so a dead or absent phone means that person cannot open the counter; the approval is one factor, not two; and the code can be read out over the phone, so a person can deliberately open a counter they cannot see, at the cost of every bill that evening carrying their name. Write the last one as the documented way out of a flat battery, because staff will otherwise find it during a rush and assume it is a loophole.
- [ ] 5.3 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`.
- [ ] 5.4 Run `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`.
- [ ] 5.5 Run `npm run db:types` and confirm `git diff --exit-code src/data-access/database.types.ts` is clean once the regenerated file is staged.
- [ ] 5.6 Adversarial review pass: a separate session reads this change's spec deltas against the delivered migration, policies and functions, and reports every requirement it cannot find enforced at the database. Findings are fixed before archive, not filed.
- [ ] 5.7 PHASE GATE: each outlet has exactly one tablet set up with no password ever typed on it; a shift opens only when the named person enters the tablet's code on their own phone, the tablet then enters billing by itself, and the shift can be ended from that phone; a request can be rejected without the code and cancelled from the tablet; an unknown username is indistinguishable from an unconfirmed one; removal is immediate; and the tablet records an expense attributed to the shift's operator and can reach nothing else in the ledger.
