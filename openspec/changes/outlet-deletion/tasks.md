# Tasks: outlet-deletion

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first.
> Decision references (D1–D8) are to that design.
>
> **This change blocks `blank-is-not-a-value` (#19)**, which cannot add its
> constraints until the nameless outlet is gone. Task 9.1 is the one that
> actually unblocks it.

## 1. The migration

- [ ] 1.1 New migration `supabase/migrations/20260728000001_outlet_deletion.sql` and pgTAP file `11_outlet_deletion.sql` — first of three unshipped migrations, settled in [#19's design D6](../blank-is-not-a-value/design.md) (D8). Do not renumber without editing that table.
- [ ] 1.2 `grant delete on public.outlets to authenticated`. **Amend the header comment of `20260726000010_grants_hygiene.sql`** in the same breath — it currently states that DELETE appears nowhere and that nothing is client-deletable, which this makes false. Name the exception and its precondition there, so the manifest still tells the truth (D1).
- [ ] 1.3 `outlets_delete` policy: `for delete to authenticated using (public.app_role() = 'super_admin' and public.app_account_active())`. Mirror `outlets_insert` and `outlets_update` exactly — same helpers, same shape (D1).
- [ ] 1.4 **No `on delete cascade` is added anywhere.** The absence of cascade across all eighteen referencing columns is the safety property; a migration that adds one has inverted this change (D2).
- [ ] 1.5 `public.outlet_reference_counts(uuid)` — a `security definer` function returning `(table_name text, row_count bigint)` for rows referencing the given outlet, with the foreign-key set read from the catalog rather than listed (D6). Restrict execution to the Super Admin, and set an empty `search_path` as the other `security definer` functions in this schema do.
- [ ] 1.6 Return only tables with a non-zero count, ordered by name, so the caller renders what it is given without filtering.

## 2. Database tests

- [ ] 2.1 New `supabase/tests/11_outlet_deletion.sql`. `supabase test db` globs the directory; nothing to register.
- [ ] 2.2 A Super Admin deletes an outlet nothing references — the row is gone.
- [ ] 2.3 A Super Admin's delete of an outlet with a roster row is refused, and **every referencing row still exists afterwards** — proving no cascade (D2).
- [ ] 2.4 Repeat 2.3 for a referencing `profiles` row and a referencing `counter_devices` row, the two whose absence would be least obvious.
- [ ] 2.5 **A Franchise Admin session cannot delete any outlet**, including their own, by a direct request. Same for a Biller and an Employee session.
- [ ] 2.6 A deactivated Super Admin cannot delete — `app_account_active()` is in the policy and should be proven, not assumed.
- [ ] 2.7 An outlet whose only reference is a **deactivated** profile is still refused (D5).
- [ ] 2.8 Removing the last referencing row makes the same outlet deletable, with no other write in between (D2).
- [ ] 2.9 `outlet_reference_counts` returns the right tables and counts for a populated outlet, and an empty set for a bare one.
- [ ] 2.10 **`outlet_reference_counts` covers a newly added table without being edited** — create a temporary table referencing `outlets` inside the test, confirm it appears, drop it. This is the whole point of reading the catalog (D6).
- [ ] 2.11 A non-owner cannot execute `outlet_reference_counts`.
- [ ] 2.12 The isolation suite and `01_schema_coverage.sql` both still pass. This change adds a policy and a grant; if either suite enumerates policies or verbs, it must account for the new one rather than be quietly wrong.

## 3. The adapter seam

- [ ] 3.1 `src/data-access/adapters.ts` — `OutletsAdapter` gains `deleteOutlet(id)` and `outletReferences(id)` returning the table-and-count pairs.
- [ ] 3.2 `src/data-access/supabase-adapters/outlets.ts` — implement both. `deleteOutlet` calls `.delete().eq('id', id)`.
- [ ] 3.3 `asOutletError` gains the foreign-key case: Postgres `23503`. It maps to a `DataActionError` the surface can act on, not a rethrown driver error.
- [ ] 3.4 A comment saying `outlets` is the **only** client-deletable table in this schema and why, because a reader of this file would otherwise reasonably assume the others have delete methods too (D1).

## 4. The mock

- [ ] 4.1 `src/data-access/mock/outlets.ts` — implement both methods. The mock has no referential integrity, so it checks its own in-memory collections and refuses in the same shape the database does (D7).
- [ ] 4.2 Demo fixtures carry **both** an outlet that deletes cleanly and one that refuses. A demo that only shows success is how the refusal path ships broken (D7).

## 5. The Outlets surface

- [ ] 5.1 `src/features/outlets/outlets-surface.tsx` — a Delete action, offered **only when `outlet.is_active` is false** (D3). An active outlet shows Mark closed and no delete.
- [ ] 5.2 Say why on screen, briefly, so the absence is legible rather than looking like a missing feature — closing comes first, and it is reversible.
- [ ] 5.3 Confirm with the existing `ConfirmDialog`, `danger`, following the `pendingClosure` pattern already in this file. **No type-to-confirm** — the outlet that most needs deleting has neither name nor code to type (D4).
- [ ] 5.4 The confirmation's `consequence` says what deletion does that closing does not: the outlet is removed rather than hidden, and it cannot be undone.
- [ ] 5.5 On refusal, render what `outletReferences` returned — table names mapped to friendly words where known, falling back to the raw name. Falling back is acceptable; omitting a table is not (D6).
- [ ] 5.6 On success, remove the outlet from local state rather than refetching the whole list, consistent with how `saveLocation` already updates in place.
- [ ] 5.7 An outlet card with a blank name must still be identifiable enough to act on — check what the card renders when name, code and location label are all empty, since that is the exact row this change exists to remove.

## 6. Component tests

- [ ] 6.1 `outlets-surface.test.tsx` — no delete action on an active outlet; one appears once it is closed (D3).
- [ ] 6.2 Choosing delete opens a confirmation and deletes nothing until it is accepted.
- [ ] 6.3 A refused delete renders the reference counts and leaves the outlet on screen.
- [ ] 6.4 A successful delete removes the outlet from the list.
- [ ] 6.5 A demo session walks both outcomes against the fixtures from 4.2.
- [ ] 6.6 `demo-safety.test.tsx` — confirm the new adapter method is covered by whatever assertion proves a demo session cannot write to Supabase.

## 7. Docs

- [ ] 7.1 `docs/DATA_MODEL.md` — **the invariant is stated twice** (around lines 15–16 and 55) and both must be amended to name `outlets` as the single exception and its precondition. Do not leave one saying deletion never happens.
- [ ] 7.2 `docs/ROLES_AND_PERMISSIONS.md` — the capability matrix gains a *Delete an outlet* row: Super Admin only.
- [ ] 7.3 `docs/SCREENS.md` — the Outlets paragraph gains the action and the closed-first rule.
- [ ] 7.4 `docs/OPERATIONS.md` — the onboarding runbook gains the undo for a mis-created outlet, which currently has no answer.
- [ ] 7.5 `docs/LIMITATIONS.md` — record that an outlet which has ever had a Franchise Admin cannot be emptied by deactivating them, because `profiles` cannot be outlet-less in a scoped role (D5).

## 8. Roadmap

> Row #20 was added at propose time. Deliberately not a checkbox: one checked
> task derives this change's status as `active`.

- [ ] 8.1 Confirm row #20 reads Wave B and matches this proposal's banner.
- [ ] 8.2 `npm run roadmap:sync` after the last task is checked.

## 9. Verification

- [ ] 9.1 🧍 **Delete the nameless outlet from production, through the app.** This is the change's purpose and what unblocks #19. Mark it closed first, then delete.
- [ ] 9.2 🧍 Attempt to delete a real, populated outlet and confirm the refusal names what is attached and does not read like a crash. **Note:** production currently has no dependent rows at all, so this needs a row created for the purpose — or it must be run against staging. Do not skip it because the happy path passed.
- [ ] 9.3 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all green.
- [ ] 9.4 `npm run test:db` passes, including the new file, the isolation suite and schema coverage.
- [ ] 9.5 Run the app on a phone viewport in both themes: close an outlet, delete it, and confirm the flow reads sensibly at each step.

## 10. PHASE GATE

- [ ] 10.1 **An outlet with nothing attached to it is deleted from the app by the owner**, and one with anything attached refuses with a sentence naming what is still there — the refusal proved by a hand-crafted request from a non-owner session, not by observing a disabled button.
- [ ] 10.2 The no-client-delete doctrine in `docs/DATA_MODEL.md` and in the grants migration both name `outlets` as the single exception. Neither still claims deletion never happens.
