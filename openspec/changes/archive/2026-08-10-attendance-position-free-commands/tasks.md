## 1. State every command argument

- [x] 1.1 Add the two position-argument helpers to the Supabase attendance adapter, each returning explicit `null` for a missing reading, with the reason the values are stated rather than omitted recorded beside them.
- [x] 1.2 Send the attempt position through the helper in `checkIn`, removing the `as number` casts on the optional chain.
- [x] 1.3 Send the approver position through the helper in `approve`, removing the same casts, and leave `correct` on its conditional spread since its parameters carry `DEFAULT NULL`.

## 2. Report a command the backend cannot accept

- [x] 2.1 Nothing to add: `AttendanceActionError` takes `code: string` and declares no union, so the new code needs no type change. Recorded here rather than silently skipped.
- [x] 2.2 Map PostgREST `PGRST202` and Postgres `42883` to it in `toActionError`, above the catch-all, with copy that asks the person to report the fault rather than retry it.
- [x] 2.3 Confirm both call sites (`check-in-card.tsx`, `outlet-attendance.tsx`) render the new message through the existing `AttendanceActionError` branch, with no screen change.

## 3. Prove it against a real database

- [x] 3.1 Add a REST adapter case: the Kalyani griller checks in with `reading: null` and the row is recorded at that outlet with unknown coordinates, unknown accuracy, unknown distance, status absent, waiting for a manager. Written to survive a re-run against the same reset.
- [x] 3.2 Extend that case: the Kalyani manager approves the same row with `reading: null` and a reason, and the settled row reads present with the reason kept and the approver's distance unknown.
- [x] 3.3 Tighten the existing self-approval case, which passes `reading: null`, to assert its refusal by code. It turned out never to reach the policy at all — the adapter's own guard answers first, because that row is already settled — so it now asserts `nothing_to_approve`, which is what it really proves, and the who-may-approve intent moved into 3.2's genuinely waiting row where the policy does decide.
- [x] 3.4 Add a unit case for the new error classification, so `PGRST202` is asserted somewhere `npm test` runs. Includes payload assertions for both commands, verified to fail against the old code.
- [x] 3.5 Unplanned, found while verifying: the time-corrections case asserted a total correction count, so it passed only on a fresh reset, against the re-run promise in this file's own header. It now asserts the two corrections it makes.

## 4. Record what changed

- [x] 4.1 `docs/ARCHITECTURE.md`: the adapter seam states every command argument explicitly, because an omitted key is not a null.
- [x] 4.2 `docs/TESTING.md`: the REST command coverage includes the position-free paths, and why the mock layer could not have caught this.
- [x] 4.3 `docs/LIMITATIONS.md`: a check-in that cannot be sent is reported, never queued.
- [x] 4.4 File a `openspec/todos/` note to sweep the other adapters for a cast on an optional chain inside an `rpc` payload.

## 5. PHASE GATE

- [x] 5.1 **Gate**: a person whose phone can supply no position has their check-in recorded and waiting for that outlet's manager, and a manager whose phone can supply no position settles a waiting day with a reason — both proved against a real Postgres over the same transport the phone uses; a command the backend cannot accept reads as a fault to report rather than a moment to try again; and the four-role demo walkthrough still walks. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:rls`, `npm run test:db`, `npm run test:e2e`.
