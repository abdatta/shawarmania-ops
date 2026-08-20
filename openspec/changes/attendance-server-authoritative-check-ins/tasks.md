## 1. Reproduce and pin the clock-authority defect

- [ ] 1.1 Add a focused database-contract case for a valid self check-in whose submitted device/GPS timestamp is ahead of database time; prove the desired acceptance assertion fails against the pre-change function with `an attendance attempt cannot be recorded for the future`.
- [ ] 1.2 Add the complementary backward-clock case and prove the pre-change function incorrectly stores the submitted past instant and can derive lateness from it.
- [ ] 1.3 Record the reproduction evidence in the change verification notes without logging account payloads, coordinates or other employee-monitoring data.

## 2. Make the database the self-check-in clock

- [ ] 2.1 Add one forward migration that preserves the deployed `attendance_submit_attempt` name, argument list, grants, empty `search_path` and session-derived authority while capturing one stable database statement instant for each new self check-in transition.
- [ ] 2.2 Make a first attempt derive and store its explicit `business_date` from that database instant and the target outlet's cutover, and store the same instant as immutable `attendance_attempts.attempted_at` and canonical `attendance.check_in_at`; leave historical rows untouched.
- [ ] 2.3 Keep retry identity anchored to the canonical row's explicit date, use the supplied date only to locate the expected row, and refuse a retry when the target outlet no longer regards that canonical date as current.
- [ ] 2.4 Remove the future-device-time guard from self check-in only; leave `attendance_record_manual` and time-correction future/wrong-day validation unchanged.
- [ ] 2.5 Preserve exact-replay-first ordering and fingerprint only client command facts, so an exact replay after a cutover returns the original server-stamped attempt while changed outlet/date/time/position/accuracy/version reuse is refused.
- [ ] 2.6 Add a narrow security-invoker current-attendance-context read that returns one `server_at` and each requested readable outlet's server-derived current business date, with explicit execute grants and no new table privilege or RLS widening.

## 3. Prove the database and tenancy boundary

- [ ] 3.1 Extend `supabase/tests/19_attendance_denial_retries.sql` (or a focused sibling) to prove forward and backward device clocks both store database time, a position-free attempt uses the same clock, lateness follows server acceptance, and a manual historical arrival keeps its asserted time.
- [ ] 3.2 Add deterministic cases on both sides of an outlet cutover, including a skewed requested date, a first attempt receiving the server-derived date, and a cross-outlet retry preserving/refusing its canonical date correctly.
- [ ] 3.3 Prove an exact command replay before and after rollover keeps one history row and its first server-authored time/date, while changed-payload UUID reuse remains refused.
- [ ] 3.4 Extend REST/RLS probes so an Employee receives context only for readable assigned outlets, a handcrafted unassigned-outlet request discloses no context, and naming it grants no attendance read or write authority; re-prove owner and Franchise Admin scope remains unchanged.
- [ ] 3.5 Exercise the currently deployed eight-argument RPC payload through PostgREST against the reset database and prove it succeeds with server-authored time/date, closing the database-acceptance gap rather than asserting only the TypeScript payload.

## 4. Extend the typed adapter seam and demo clock

- [ ] 4.1 Add typed attendance current-context models and an explicit outlet-id read to `AttendanceAdapter`; keep screens independent of the Supabase client.
- [ ] 4.2 Implement the Supabase context read with explicit result shaping, require one common `server_at` across its returned outlet dates, and keep the existing check-in payload callable while treating its requested timestamp/date as non-authoritative.
- [ ] 4.3 Update the mock attendance adapter to produce context and self-check-in times from one adapter-owned injectable/reference clock, preserving demo-origin isolation and eliminating component `Date` as attendance authority.
- [ ] 4.4 Add adapter and mock tests for two outlets with differing cutovers, forward/backward device readings, position-free attempts, exact replay, changed reuse and manual-entry separation.
- [ ] 4.5 Regenerate `src/data-access/database.types.ts` from the reset schema and update typed fixtures so the new read/function contract cannot drift.

## 5. Move employee attendance surfaces to backend context

- [ ] 5.1 Update `use-own-attendance` to load backend context for all assigned outlets and query the distinct server-supplied current dates, including the between-cutovers two-date case.
- [ ] 5.2 Update the check-in card to use the target outlet's backend date for first attempts, canonical row date for retries, and backend reference time for retry availability and on-time/late material-change previews; remove device `new Date()` as authority from those decisions.
- [ ] 5.3 Refresh attendance context when the surface loads, returns to the foreground, or receives a named day-closed/stale response, without polling or background geolocation.
- [ ] 5.4 Ensure the database response replaces provisional context after every successful write so a deadline or cutover crossed in flight renders the stored server-authored classification and date.
- [ ] 5.5 Add component tests with a deliberately skewed browser clock for correct today loading, check-in submission, multi-outlet cutovers, retry visibility, deadline classification and foreground/stale refresh; prove no position is read merely because context refreshes.
- [ ] 5.6 Keep the current layout and shimmer geometry unchanged, and inspect the Employee home and My attendance surfaces on phone/tablet viewports in both light and dark themes.

## 6. Document the two attendance time contracts

- [ ] 6.1 Update `docs/DATA_MODEL.md` with database-authored self-check-in time/date, the distinct `attempted_at`/`created_at` semantics and manager-attested manual/correction time.
- [ ] 6.2 Update `docs/SCREENS.md` to state that Employee today/retry context comes from the backend and survives a skewed phone clock.
- [ ] 6.3 Update `docs/SECURITY_AND_PRIVACY.md` to keep coordinates/accuracy as the minimum stored phone evidence, explicitly decline an extra device timestamp, and state that the context read widens no outlet visibility.
- [ ] 6.4 Update `docs/TESTING.md` with forward/backward skew, cutover, deadline, replay, compatibility and unassigned-context probes, and update `docs/LIMITATIONS.md` so attendance no longer implies device-clock authority while the online-receipt trade-off is named.

## 7. Full migration and application verification

- [ ] 7.1 Run `npm run format`, `npm run lint`, `npm run format:check`, `npm run typecheck`, the touched Vitest files, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`; record exact counts/results.
- [ ] 7.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and the REST attendance/tenancy suites; inspect the migration reset and every clock/cutover assertion rather than relying on compilation.
- [ ] 7.3 Run `npm run test:e2e:auth` because Employee home is a role index, regenerate with `npm run db:types`, and prove `git diff --exit-code src/data-access/database.types.ts` is clean once the intended generated type change is staged.
- [ ] 7.4 Run `openspec validate attendance-server-authoritative-check-ins --strict`, `npm run roadmap:sync`, inspect the resulting roadmap change, and report every gate not run rather than implying success.

## 8. PHASE GATE — re-prove ROADMAP checkpoint #26

- [ ] 8.1 PHASE GATE — re-prove the ROADMAP `attendance-approved-on-site` (#26) checkpoint with the strengthened clock contract: a real Employee self check-in succeeds with a deliberately forward-skewed phone, a backward-skewed phone cannot backdate the row, the database-derived outlet date and stamped deadline make the arrival read correctly across cutover and lateness boundaries, an exact replay remains one immutable attempt, an unassigned outlet reveals no context or row by handcrafted request, manager approval and manual historical entry retain their existing evidence/authority rules, the Employee home and own history agree, and the four-role demo walkthrough still walks.
