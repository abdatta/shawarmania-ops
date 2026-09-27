# Proposal: people-is-called-team

> **Model**: Opus · **Roadmap**: deliberately unlisted — a rename of a shipped
> surface, not new capability · **Gate**: the navigation entry, the page title
> and every sentence that names the screen read **Team** for the owner and for a
> Franchise Admin, in real and demo mode; the screen lives at `/owner/team` and
> `/admin/team`, and the old `people` address is gone; no other screen, word or
> behaviour changes;
> the living specs and `docs/` name the screen Team; and `people-shows-names-first`
> is archived before this change so its delta is renamed by this one.

## Why

The owner asked on 2026-09-26 for the People tab to be renamed. Since
`global-customer-identity` there is a Customers tab beside it, and customers are
people too, so *People* no longer says which people. The screen lists the
people who work for Shawarmania and hold an account — the owner, managers,
billers and staff.

*Team* was chosen over *Accounts*: the screen is the staff list as much as the
account list (jobs, where each person works), and *account* reads as a login or
billing setting. *Staff* was rejected because the app already defines staff
narrowly as Employees and Billers, and a manager is not one.

*Team* has no existing meaning in the product. Every current use of the word is
ordinary English for the same people — "a small trusted team" in the audit-log
todo, "Former team member" on an old bill, "reviewing the team is a manager's
job" in a migration comment — so the name agrees with the language already here.

## What changes

- The Setup entry and the page title read **Team**, for the owner and for a
  Franchise Admin.
- The screen's address is `team`. The old `people` address is not kept: the
  owner confirmed on 2026-09-26 that it was never shared (design D1).
- Every sentence in the app that points at the screen says Team — Attendance's
  empty roll-call says to add them under Team.
- The living specs and `docs/` call the screen Team.

## Non-goals

- **The ordinary word stays.** "Show people who have left", "The people are listed",
  a roll-call's people — these mean persons, not the screen.
- **No internal renames.** `AccountsSurface`, `features/accounts/`, the accounts
  adapter and its test ids keep their names; the database is untouched
  (`expense_people` is an unrelated function).
- **History is not rewritten.** Archived changes, change names such as
  `multi-outlet-people`, roadmap rows describing past work and completed-todo
  notes keep the word they were written with.
- **No change to what the screen shows or who may use it.**

## Docs to update before archiving

`docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/ROLES_AND_PERMISSIONS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/DATA_MODEL.md`, `docs/DEMO_MODE.md`,
`docs/LIMITATIONS.md`, `docs/PROJECT_OVERVIEW.md` — wherever they name the
screen. The specs via this folder's deltas.

## How to run the gate

`format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, `test:e2e:auth`; a
browser check of the new address in demo mode; a final search for `\bPeople\b`
that finds only the kept uses listed in `tasks.md`.
