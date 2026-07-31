# Tasks: notification-badges

## 1. The badge component

- [ ] 1.1 `src/components/ui/badge.tsx`: a count badge and a bare dot, `--primary` / `--on-primary` (D1), sized to sit against a nav icon and inline against text; a required accessible name; renders nothing at zero (D5)
- [ ] 1.2 Counts above a sensible ceiling render as `99+` rather than widening the badge out of its own layout
- [ ] 1.3 `badge.test.tsx`: nothing at zero, the number at non-zero, the ceiling, the accessible name on both the count and the bare dot, and that the name is required rather than optional (D6)
- [ ] 1.4 `npm run contrast` still green with no new pair registered — the pair is `--primary` / `--on-primary`, already asserted (D1)

## 2. The count, and where it comes from

- [ ] 2.1 `adapters.ts`: `WaitingCount` gains `newest` beside `oldest`; both adapters return it from the query they already run, no new predicate (D3)
- [ ] 2.2 `supabase-adapters/attendance.ts` and `mock/attendance.ts` compute `newest` consistently, so the derived arrow marks are identical in demo and live
- [ ] 2.3 A shared hook reading the waiting counts once per mount and again on `visibilitychange` back to visible, never on a timer (D4); a failed read leaves the last known value rather than blanking the badge
- [ ] 2.4 `rest/attendance-adapter.test.ts`: `newest` returned and correct against the real adapter, including an outlet whose only unsettled day is a single date, where `oldest` and `newest` are equal
- [ ] 2.5 Isolation: a Franchise Admin's waiting counts contain only their own outlets, proved through the adapter, not through the UI. No new table and no new policy, so this is a regression case on existing scoping (D-RLS)

## 3. The shell

- [ ] 3.1 `gates/registry.ts`: a registry entry may declare a badge count source; `admin-attendance` declares it and nothing else does
- [ ] 3.2 `shell/phone-shell.tsx` and `shell/counter-shell.tsx` render the badge on any nav entry declaring a source, knowing nothing about what is counted (D2)
- [ ] 3.3 Shell tests: a declared source badges its entry in both shells; zero renders an entry indistinguishable from an unbadged one; a second declared source would badge without touching either shell

## 4. The attendance day view

- [ ] 4.1 The day picker states the waiting count for the day on screen as a badge, from the rows already loaded rather than from a second read
- [ ] 4.2 The earlier-days and later-days controls are marked from the outlet in scope's `oldest` / `newest` against the day on screen (D3)
- [ ] 4.3 `StrandedDays` becomes outlet chips carrying counts: the outlet in scope marked as such, the others switching to that outlet when chosen; the heading and the oldest-date text go
- [ ] 4.4 Both themes and both viewports checked on every surface touched; `npm run contrast` green

## 5. Tests for the surfaces

- [ ] 5.1 `outlet-attendance.test.tsx`: the day badge; the earlier-days mark present when that outlet has an older unsettled day and **absent when only another outlet does**; neither mark when the day on screen is the only one waiting
- [ ] 5.2 `outlet-attendance.test.tsx`: the chips carry counts, the one in scope is not a switch target, and choosing another switches outlet — restating the existing stranded-days cases against the new shape
- [ ] 5.3 A foreground return re-reads the counts and a badge updates; no request is made while a badged screen merely sits open (D4)
- [ ] 5.4 `e2e/attendance.spec.ts`: a manager sees the nav badge, opens attendance, approves the last waiting day, and the badge goes rather than showing zero

## 6. Docs

- [ ] 6.1 `docs/SCREENS.md` — the day view's badges and outlet chips; the banner's removal
- [ ] 6.2 `docs/DESIGN_SYSTEM.md` — the badge component, its colour pair, and that a badge always carries an accessible name
- [ ] 6.3 `docs/ARCHITECTURE.md` — the gate registry gaining a badge source, and the shell staying ignorant of what is counted
- [ ] 6.4 `docs/OPERATIONS.md` — the "days are piling up unapproved" entry restated against chips and badges
- [ ] 6.5 `docs/LIMITATIONS.md` — a badge is not a notification, and a count can be stale until the app is reopened
- [ ] 6.6 `docs/GLOSSARY.md` — badge, and how it differs from an alert
- [ ] 6.7 `openspec/todos/pending-approval-notification.md` — restated: the badge is now the in-app signal, and what remains missing is reaching somebody who is not holding the phone

## 7. Gates

- [ ] 7.1 `npm run lint`, `format:check`, `typecheck`, `test`, `contrast`, `build`, `test:e2e` green; then `db:start` + `db:reset` and `test:db`, `test:rls`, `test:e2e:auth` **in that order**, since the account-creating suites change the seed counts `test:db` asserts

## 8. PHASE GATE

- [ ] 8.1 🧍 **Gate**: on a real phone, a manager with unapproved arrivals sees a count on the Attendance nav item from another screen, opens it, and finds those arrivals listed first; the day controls are marked only for that outlet's other unsettled days and **not** for the other outlet's, proved by switching outlets and watching the marks change; the owner sees a count per outlet and reaches a stranded outlet in one tap; approving the last waiting day removes every badge rather than showing zero; the count is stale after backgrounding and correct again on return; and the four-role demo walkthrough still walks

**Ordering**: this change must not archive before `attendance-approved-on-site`
(#26), whose `attendance-and-location` requirements it modifies.
