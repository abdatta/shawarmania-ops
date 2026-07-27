# Proposal: outlet-and-staff-setup

> **Model**: Opus · **Wave**: B · **Depends on**: #4 · **Gate**: **starting from an empty database, an owner creates an outlet, captures its position, provisions a manager and an employee, links that employee to a roster row, and the employee checks in from their own phone — entirely through the UI, with no SQL at any step.**

## Why

**Attendance (#5) shipped a feature that cannot be reached.** Production has zero outlets, and with zero outlets no account except another Super Admin can even be created — the provisioning form has no outlet to assign anyone to. Every screen attendance built is correct and unreachable.

Two links in the chain are missing, and they are the two nobody looked at:

**Nothing creates an outlet.** The roadmap put outlet creation at #14, on the reasoning that the two real shops would be inserted by hand once (`docs/OPERATIONS.md`) and that #14 exists to prove a *third* outlet needs no code. That reasoning was fine for a schema-only project and stopped being fine the moment a feature went live: the first thing an owner does with a working app should not be to open a SQL console.

**Nothing links an app account to a roster row.** `employees.profile_id` is what an Employee's own attendance is found by. Neither the roster screen, the account screen, nor any Edge Function ever writes it. A real employee would sign in, be told they are not on the staff list, and have no way for anyone to put them on it.

**Why it was missed is worth recording, because it will recur.** Demo fixtures and SQL seeds both describe a business that is *already configured* — outlets exist, accounts exist, `profile_id` is pre-set. Every test at every layer therefore started from a wired-up world, and none of them asked how that world comes to exist. The same blind spot is waiting at `billing-live`: a real order needs real menu items, and until this change no row on the board explicitly owned making the menu real.

## Scope

**Create and edit an outlet** — Super Admin. Code, name, location label, address, phone, business-day cutover, and active state. Position capture already exists from #5 and is not rebuilt; this change gives it something to capture *into*.

**Link an app account to a roster row**, from both directions, because both are natural moments:

- Adding or editing someone on **Staff** offers to attach an existing unlinked account at that outlet.
- Provisioning an Employee on **Access** offers to put them on the roster at the same time.

Either path writes `employees.profile_id`; the existing `employee_profile_same_outlet` trigger already refuses a cross-outlet link.

**Make the link legible.** The Staff list says whether a person can actually sign in and check in. The Access list says whether an account is on the roster. **"Why can't this person check in?" must be answerable by looking at a screen**, not by reading the database — because that question will be asked on a phone call during a shift.

**Unlinking**, and what it means: removing the link stops that account seeing that roster row's attendance. History stays on the roster row, because the days were worked.

**Isolation cases** for the new writes: outlet insert and update remain Super Admin only; a Franchise Admin may set `profile_id` only within their own outlet, and only to an account of their own outlet.

## Design questions to settle during `/opsx:propose`

- **Should provisioning an Employee account create the roster row automatically?** Convenient, and it quietly asserts that every Employee account is a payroll employee — which the schema deliberately says is not true. An offer with a sensible default may be right; a silent side effect is probably not.
- **What happens to an outlet that is deactivated while staff are checked in?** Deactivation exists in the schema; nothing has ever exercised it.
- **How much of #14 does this absorb?** The line taken here: enough that a *first* outlet is reachable without SQL. Tablet enrolment, menu and inventory setup stay with their own changes, and #14 keeps its harsh end-to-end gate.

## Non-goals

- No tablet enrolment, menu, or inventory setup — those belong to #9, #10 and #11.
- No bulk import, no CSV, no invitation emails.
- Not a replacement for #14. That change still has to prove the *whole* chain works for a franchisee with no help.

## Watch out for

**The first outlet is a chicken-and-egg case.** A Super Admin has no outlet, which is what lets them create the first one; every check on this screen must hold with zero rows present, and the empty state has to be an instruction rather than a blank.

**Do not let this become outlet CRUD for its own sake.** The gate is a working check-in, not a complete admin console.

## User-only gate steps

- 🧍 Walk the whole chain on production from the current empty state, and stop at the first step that needs SQL.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/OPERATIONS.md` (the onboarding runbook stops saying "by hand for now"), `docs/ROLES_AND_PERMISSIONS.md` (who may link an account to a roster row).
