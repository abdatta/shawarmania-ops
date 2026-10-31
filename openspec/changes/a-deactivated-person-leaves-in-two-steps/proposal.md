# Proposal: A Deactivated Person Leaves in Two Steps

> **Model**: Opus · **Roadmap**: #82 · **Depends on**: #5 `attendance`, #21
> `staff-as-accounts`, #22 `multi-outlet-people`, #40
> `account-lifecycle-truth-and-safe-transitions`, #75
> `a-release-can-be-switched-off` · **Gate**: the owner approved the Team
> page's Deactivated section from the demo before it was wired live; a person
> is deactivated from their row and moves to **Deactivated (n)**, where the
> manager still sees them and can reactivate them; **Mark as left** is offered
> only there, ends their outlets on the day they were deactivated, and frees
> their username and phone for someone else; attendance lists a deactivated
> person up to and including that day and not after, by day and by staff;
> nobody grants or removes owner access, or deactivates an owner, from the app,
> proved by hand-crafted requests; Edit offers no outlets for an owner and no
> **Add outlet** where there is nowhere to add; with both gates off Team and
> Attendance read exactly as today; and the four-role demo walkthrough still
> walks.

## Why

The owner kept three notes about the Team page and could no longer remember
what two of them meant (2026-10-30). Reading the code together turned them back
into problems:

1. **Deactivated vs Left — why two terms.** Team has two separate verbs that
   look like rivals. **Deactivate** stops sign-in and keeps the person on their
   outlets. **Mark as left** ends every outlet and also deactivates. A person
   who has left is then labelled *Deactivated*, never *Left*, and once somebody
   is deactivated the *Mark as left* button disappears from their Edit sheet.
   The deactivation dialog itself tells the admin to "mark them as left if they
   no longer work here": two steps, with the second one hidden.

   Worse, **Attendance keeps listing a deactivated person on every day after**,
   as an empty absent row, because the spec says cutting access does not
   falsify the day. Somebody switched off in June is still "absent" every day in
   October.

2. **Remove "Grant owner access" — only by db.** Edit carries a **Grant owner
   access** button that makes anybody an owner across every outlet behind one
   checkbox. Add person offers *Super Admin* as a role too. Owner access is
   rare and dangerous, and the owner wants it changed only in the database.

3. **No "Add outlet" for owners (or managers?).** Both. Editing an owner opens
   the outlets section with **Add outlet** and a false warning, "Add an outlet
   before saving", though saving works. A manager with one outlet sees **Add
   outlet** always greyed out and a *Works at multiple outlets* toggle that
   leads nowhere.

The owner's reasoning on the first one is the heart of this change: an account
is about whether somebody may sign in and do things, not a headcount. Plenty of
people work at the outlet without an account. So the date somebody "left" has
no business meaning, and a random clean-up date stored as one would mislead
later. What is worth recording is **the day access was switched off**.

## What changes

### Deactivate is the one everyday verb

A person's row menu offers **Deactivate**, as today. Deactivating:

- stops sign-in at once, exactly as today;
- **records the day** (Kolkata calendar) on the person;
- keeps every outlet they work at, so their manager still sees them;
- moves them out of the main list into a collapsed section at the bottom,
  **Deactivated (n)**, which replaces *Show people who have left*.

A row in that section reads *Deactivated · 12 Oct*. Its menu offers **Edit**,
**Reactivate** and **Mark as left**. **Reactivate** puts them back in the main
list with their outlets and roles as they were, and clears the date. Days
between deactivating and reactivating show nothing in attendance; that gap is
accepted (owner, 2026-10-30).

### Mark as left only from Deactivated

**Mark as left** leaves the Edit sheet and the main list. It is offered only to
somebody already deactivated, from the Deactivated section, after a
confirmation:

> **Mark Rahul as left?**
> Their outlets end on 12 Oct, the day they were deactivated. Their username
> `rahul.k` and phone number become free for someone else. Their attendance and
> work stay on record. Bringing them back means adding them again.

Confirming:

- ends every live outlet assignment **on the day they were deactivated**, not
  the day of the clean-up (never before an assignment's own start);
- **frees their username**, so a new person, or the same one rehired, can be
  given it;
- **frees their phone number**, which is unique, for the same reason;
- removes them from Team for everyone. A manager does this deliberately, giving
  up somebody they no longer need.

A person who returns gets a new account through **Add person**, with the old
username if they want it. Their old attendance stays on the old account; it is
not joined to the new one.

### Attendance stops at the deactivation day

Attendance lists a deactivated person **up to and including** the day they were
deactivated, and not after, on **By day** and on **By staff**'s month. A person
deactivated after their last shift on 12 October appears on 12 October and is
gone from the 13th. A real attendance record on a later day is still shown,
because a recorded day is never hidden.

### Owner access is changed only in the database

The app no longer grants or removes owner access, anywhere:

- Edit loses its **Owner access** section (*Grant owner access*, *Remove owner
  access*).
- Add person no longer offers *Super Admin* as a role.
- An owner's row offers no **Deactivate**, **Reactivate** or **Mark as left**.
  It keeps **Edit** (name, phone, job title), **Change username**, **Reset
  password** and **Change sign-in email**.
- The account function **refuses** each of these from a hand-crafted request,
  whatever the page offers.

Granting or removing owner access becomes a written database procedure in
`docs/OPERATIONS.md`, run by the agent or the owner directly.

### Edit offers outlets only where they mean something

- Editing an **owner** shows no outlets section, no **Add outlet** and no
  "Add an outlet before saving" warning. An owner works everywhere.
- **Add outlet** and **Works at multiple outlets** appear only when there is
  another outlet the reader could add. A manager of one outlet sees neither.

## Change gate

- **`deactivate-then-leave`** (*DL*)
  - **On:** A deactivated person moves to a Deactivated section and drops out of
    attendance after the day they were deactivated, and Mark as left is offered
    only there, ending their outlets on that day and freeing their username and
    phone.
  - **Off:** Deactivated people stay in the list and in attendance, and Mark as
    left is in Edit and ends outlets on the day it is pressed.
- **`owner-access-in-the-database`** (*OD*)
  - **On:** Nobody grants or removes owner access, or deactivates an owner, from
    the app; the account function refuses it.
  - **Off:** The owner grants and removes owner access from Team, as today.

**Off is today for both.** With `deactivate-then-leave` off, Team and
Attendance run today's code paths untouched and the account function's
existing `mark-as-left` action is unchanged; the new leave goes through a new
action and a new database function, which refuse while the gate is off.

The day of deactivation is **recorded whichever way the gate is set**, from the
day this change is deployed. It is a new column that only the on path reads, so
it is no behaviour change, and it means every deactivation since the deploy
already has its day when the gate is turned on.

**What the on path persists, and Off living with it.** A person left while the
gate was on has ended assignments, an inactive account, no phone and a
username moved out of the login namespace. Today's Team reads exactly that as a
departed person under *Show people who have left*, with no username shown, which
it already handles for an account without one. Nothing is queued: none of this
touches the outbox (round trip `none:`).

`owner-access-in-the-database` changes what is offered and what the account
function accepts; it writes nothing (round trip `none:`). Turning it off brings
the owner's buttons back and the function accepts them again within seconds,
because the function reads the gate on every request.

**The Edit outlets cleanup takes no gate.** It is a revert-clean change away
from the counter (`AGENTS.md`, *A revert is enough*): (1) it only stops drawing
a section and a button in Team's Edit sheet, writes nothing and changes no
function, so after a revert every account is in a shape the old build handles;
(2) Team is reached only by the owner and managers from Setup, its Edit sheet
is a component of that page alone, and no counter, kitchen, shell or sign-in
code imports it.

The two gates depend on nothing and on each other not at all. With the fixed
costs follow-up's `agreed-part-months` (*AM*), they bring the gates depending on
nothing to five, the limit.

## Non-goals

- **A history of deactivation periods.** Reactivating clears the date; the gap
  between is not remembered.
- **Joining a rehired person's old history to their new account.** A rehire is
  a new account.
- **Undoing Mark as left from the app.** The two-step path makes it deliberate;
  a mistake is corrected in the database.
- **A headcount or payroll view.** Team stays a list of accounts. People paid
  without an account stay outside it.
- **Recovery for a lost owner account from the app.** Owner access, and its
  recovery, live in the database procedure.
- **Changing what a manager may manage.** A manager deactivates, reactivates and
  marks as left only Billers and Employees wholly theirs, as today.
- **The Outlets page's *Add outlet*.** Untouched; this is the one in Edit person.

## Capabilities

- **identity-and-access** — modified: departure only from a deactivated
  account, dated by the deactivation and freeing username and phone; owner
  access outside the account function; Edit's outlet controls by target.
- **attendance-and-location** — modified: a deactivated person is listed up to
  their deactivation day, not after.

## Impact

- **Database:** one migration, in the next free slot after the latest on
  `stage` (design, *What was read*): `profiles.deactivated_on date`
  (nullable, additive), `mark_account_as_left_v2` (service role only), the two
  gate rows, off. No existing row changes in the migration.
- **Data repair, once:** the people already deactivated in production get their
  day from their last attendance, else their last sign-in, listed for the
  owner's review before anything is written (design D7).
- **Edge Function `admin-accounts`:** stamps and clears the day on every
  deactivation and reactivation; a new `mark-as-left-v2` action; owner refusals
  read `owner-access-in-the-database`.
- **App:** `src/features/accounts/` (Team), `src/features/attendance/`
  (By day, By staff), the accounts adapters and mock, demo fixtures.
- **Not touched:** the counter, the kitchen, the outbox, billing, cash.

## Docs To Update Before Archive

- `docs/SCREENS.md` — Team (Deactivated section, Edit's outlets, owner rows),
  Attendance By day and By staff (the deactivation day).
- `docs/ROLES_AND_PERMISSIONS.md` — the Team table: Mark as left and
  Deactivate on owners, owner access rows.
- `docs/OPERATIONS.md` — the database procedure for granting and removing
  owner access; "Someone must lose access now"; "Someone has left".
- `docs/DATA_MODEL.md` — `profiles.deactivated_on`; what a left account looks
  like (ended assignments, no phone, alias outside the login namespace).
- `docs/GLOSSARY.md` — *Deactivated* and *Left*, if either entry exists or is
  needed.
