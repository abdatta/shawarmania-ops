# Proposal: staff-as-accounts

> **Model**: Fable · **Wave**: D · **Depends on**: #4, #5, #15 · **Gate**: staff exist only as accounts: a person is created once, with no separate roster row or linking step anywhere in the UI; every pre-merge attendance row survives, attributed to the same person; deactivating an account ends its session without removing the person from today's attendance surface; a departed person (`left_on`) disappears from staff lists while every record stays; deleting an account with history is refused by the database, proved by a hand-crafted request; no salary or payroll field exists in schema or UI; an FA records a past-time check-in for someone else and the row shows who entered it; and the four-role demo walkthrough still walks end to end — the scenario dataset restates staff as accounts and the trading day still reconciles.

## Why

The roster/accounts split earned its keep on two assumptions: payroll data lives in the app, and some staff never touch it. On 2026-07-28 the owner removed both for V1 — **no payroll in this app** (it was becoming scope creep; attendance is kept because it feeds payroll done *outside* the app), and **every staff member gets an account** (assume everyone can install the app; restore the assumption later if usage says otherwise, migration accepted). What remains of the roster after those cuts is a second copy of names the accounts already hold, plus a linking step whose only job is reconnecting what the split separated — and a name-drift bug where the two copies disagree.

The timing is deliberate. Production staff data is at baseline (see `openspec/todos/attendance-gate-unwalked-clauses.md` — the one real check-in was test data, since deleted), so this is the cheapest the migration will ever be, and #9's shift attribution and device design should be proposed against the merged people model rather than a table scheduled to die.

## Decisions already made (owner, 2026-07-28) — do not relitigate during propose

- **One record per person.** Staff are accounts. The `employees` roster table, the account↔roster link, and the linking UI all go.
- **Two independent facts, two columns**: `is_active` (may this account sign in — also the immediate session-kill lever) and `left_on date` (null = current staff). One bit cannot express "access cut but still works here": overloading it would either falsify the attendance surface every time the panic button is pulled, or let ex-staff accumulate in every list forever under the no-deletion rule.
- **No payroll fields anywhere.** Salary, address and their kin are dropped, not moved. A salary payment can be recorded as an ordinary expense when the owner wants it in the books.
- **Nothing with history is deletable.** Disable or mark departed; deletion of an account with any recorded rows is refused by the database itself, not by a form.
- **Manual attendance entry is the fallback** (the tablet kiosk was rejected — one shared device, usually busy billing). A Franchise Admin can check a person in or out with a past timestamp; the row permanently shows who entered it and how. The Super Admin can do the same across outlets.
- **Open door, not built: email-less accounts.** Never assume the auth system won't send mail — the owner plans a domain. If email-less staff return, the viable paths are addresses on a controlled, never-routed subdomain, or making the auth link optional. This change must not entrench a hard email dependency beyond what exists today.
- **Open door, not built: one login, many hats.** The long-term direction is one account holding several (role, outlet) grants with one active at a time (`openspec/todos/role-grants-one-login-many-hats.md`). Nothing here may assume account-per-outlet — that was explicitly rejected.

## Scope

**The merge** — staff identity collapses into `profiles`: the two-column state model above, whatever display fields survive (see design questions), and the removal of the roster table, its triggers, its policies and its isolation cases. Attendance re-attaches to accounts, carrying every existing row. The migration is written to carry real data even though production is at baseline: any unlinked roster row gets an account auto-provisioned with a placeholder address and no code issued; admins fix addresses and issue codes with the existing `set-email` / `reissue` machinery.

**Manual attendance entry** — the FA records a check-in or check-out for a person at their outlet, including past timestamps; entry source and enterer are stamped on the row, alongside the existing override attribution pattern. SA has the same capability across outlets. This replaces the kiosk as the escape hatch that keeps hard geofence blocking humane, and it must be visibly distinct from a self check-in wherever attendance is read.

**One People surface** — creating a person creates the account and their staff-list membership in one step; there is no separate roster page and no link step. Absorbs `openspec/todos/select-primitive-not-adopted-everywhere.md` for these surfaces (its trigger names this change).

## Non-goals

- No payroll or salary management, now or in V1. Attendance is kept because it feeds payroll done outside the app.
- No kiosk / tablet PIN attendance — rejected by the owner; the manual-entry fallback above is the replacement. (#9's scope shrinks accordingly.)
- No multi-outlet or multi-role grants yet — direction settled, door kept open, built when a real person needs it.
- No change to the biller account role — whether it survives device enrolment is #9's design question.
- No email-less accounts — door kept open as above.

## Design questions to settle during `/opsx:propose`

- What survives of generated staff codes (#18) — does a per-outlet display code carry onto the account, or do codes die with the roster? Their gate ("the app invents it, an FA cannot change it") was about the roster row.
- `role_title` ("Griller", "Cashier"): keep as a free-text label on the account, or drop?
- Does `left_on` interact with `is_active` (can a departed person's account still sign in?) — and is that enforced or convention?
- The exact attribution shape for manual entries: reuse the `override_by/reason/at` triplet pattern, or a dedicated entered-by set alongside a new entry source?
- How the demo scenario dataset (#8) restates its employees as accounts while keeping the trading day reconciling.

## Docs to update before archiving

`docs/ROLES_AND_PERMISSIONS.md` (the roster section, the capability matrix rows for roster/link, the provisioning table), `docs/DATA_MODEL.md`, `docs/SCREENS.md` (Staff and Access become one People surface), `docs/OPERATIONS.md`, `docs/TESTING.md` (the roster's isolation cases go), `docs/GLOSSARY.md`, `docs/LIMITATIONS.md` (payroll's absence and the restore-later doors).
