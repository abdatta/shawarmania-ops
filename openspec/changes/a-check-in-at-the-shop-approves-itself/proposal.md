# Proposal: A Check-in at the Shop Approves Itself

> **Model**: Opus · **Roadmap**: #81 · **Depends on**: #5 `attendance`, #26
> `attendance-approved-on-site`, #41 `attendance-batch-decisions`, #60
> `each-outlet-chooses-how-it-serves` (the settings precedent), #75
> `a-release-can-be-switched-off` · **Gate**: the
> owner approved the staff phone's Home, My attendance and Expenses, the
> outlet's Attendance settings and the manager's roll-call from the demo before
> any of it was wired live; with both outlet settings off, a check-in the
> database measures inside the outlet's fence is present at once, late or not,
> with no manager, and one outside or with no position waits as today; with
> *Manager approves every check-in* on, every check-in waits as today; with
> *Block check-ins away from the shop* on, a check-in outside the fence or with
> no position is refused and nothing is written, proved by a hand-crafted
> request; only the outlet's managers and the owner change either setting, and
> only the owner changes the outlet's position and radius, proved by
> hand-crafted requests; a manager corrects an auto-approved day with
> one action; with `auto-approve-at-the-shop` off every check-in waits exactly as
> today whatever the settings say, and with `refreshed-staff-screens` off every screen
> reads exactly as today; and the four-role demo walkthrough still walks.

## Why

Attendance is a convenience record, not a control (owner, 2026-10-25). The
owner and the ten or more people at the outlet already know who turned up. What
the app is for is getting people to check in, and keeping a history that is
easy to read later.

Today every check-in waits for a manager, even one taken at the counter. The
manager has fallen into approving everything, so the approval no longer means
anything. Staff see a yellow warning and "Waiting for a manager to approve" on a
perfectly good check-in, twice, with no moment that says *you're done*. The
owner wants the easy case to be automatic. They also want a way to make the
hard case deliberate again.

The staff phone's three screens were also reviewed at phone width in both
themes. They have more problems than the approval rule: see the findings in
`design.md`.

## What changes

### A check-in at the shop is approved automatically

When the database measures a phone check-in inside the outlet's geofence
(`distance ≤ the outlet's own radius`, whatever the reading's accuracy), the day
is **present** at once, with no manager. A late arrival is still recorded late
and tagged late. The person's phone says so straight away:

> ✓ **Checked in 9:02 am** · Approved

A check-in outside the fence, or with no position, still waits for a manager
exactly as today. The radius is the outlet's own `geofence_radius_m` (150 m at
Kalyani Cafe today), which only the owner sets.

**The risk is accepted** (owner, 2026-10-25). A fake-GPS app, or a request made
by hand, can claim the shop's position. Staff are not technical, and somebody
missing day after day is noticed by the people around them. The fence decides;
nothing tries to detect spoofing.

### Two attendance settings for each outlet, both off by default

On the outlet's own page, in a new **Attendance** section beside Orders and
Loyalty:

| Setting | Off (default) | On |
|---|---|---|
| **Manager approves every check-in** | A check-in at the shop is approved automatically. | Every check-in waits for a manager, as today. |
| **Block check-ins away from the shop** | A check-in away from the shop, or with no position, is recorded and waits for a manager. | It is refused and nothing is recorded. The person moves closer and tries again, or asks the manager to record their arrival. |

*Block* exists to break the habit of approving everything (owner, 2026-10-25).
If staff cannot send a request from home, the only way to get the day counted
is to ask the manager. The manager then records it on purpose, with **Record
arrival** (which exists today and settles the day as it records it).

**Who decides:** the outlet's managers and the owner change both settings. How
an outlet runs its staff is the outlet's own business; a franchisee's staff are
not the owner's headache. **The outlet's position and fence radius stay the
owner's alone**, because they prove where a franchise actually trades.

### The manager sees what was approved automatically

On the roll-call an auto-approved day reads **Present · Auto-approved at the
shop** with its time, and no approver. It is no longer in the waiting count or
the attention badge. **Correct** on it works as on any settled day: one action,
with a reason.

### The staff phone, redesigned

- **Home is a pass for today.** It shows:
  - the date and the outlet;
  - when they are expected ("Late after 1:00 pm");
  - the check-in, with its time and whether it was approved;
  - this month's days.

  The one big button sits at the bottom, in thumb reach. The greeting line, the
  two-line "Assigned to…", and the My attendance button that repeats the bottom
  tab are gone.
- **Every problem is one sentence and one decision**, with **Why?** opening the
  numbers. A refused check-in under *Block* says so and says what to do. A
  denied location permission says how to turn it back on, instead of offering
  "Try again" (which cannot fix it).
- **Plain words for the evidence:** *At the shop*, *1.2 km away*, *No
  location*, instead of `12 m`, `±14 m`, `phone`.
- **A better reading when the first is poor.** One reading as today. Only if
  it is outside the fence or rough, the phone keeps reading for a few seconds
  and shows the reading improving.
- **My attendance is a month on one screen:** a calendar of days. Each day
  carries colour, an icon and a letter, never colour alone. Tapping a day opens
  its detail. The counts read *7 present · 2 arrived late · 16 absent ·
  1 waiting*. Every date names its weekday. The manager's **By staff** shows the
  same calendar, because the two must stay the same screen.
- **No sentence under a heading** on these screens (owner UI convention).

### Expenses, staff phone and counter tablet

- The two days a staff member sees sit under **Today** and **Yesterday**
  headings, rather than repeating the date on every row.
- A **You** tag on the rows you recorded, which are the ones you can change.
- **Adding an expense asks the amount first**, then the category, typed as it
  always was, then the note. The note's example reads *What was it for?*
- The **Cash** chip stays (owner, 2026-10-25).
- The counter tablet gets the same list and the same form (owner, 2026-10-25),
  and so do the owner's and manager's Expenses.

## Change gate

- **`auto-approve-at-the-shop`** (*AA*)
  - **On:** A check-in measured inside the outlet's fence is approved at once, and
    each outlet's managers choose whether every check-in still needs them and
    whether check-ins away from the shop are refused.
  - **Off:** Every check-in waits for a manager.
- **`refreshed-staff-screens`** (*RS*)
  - **On:** The staff phone's Home, My attendance and Expenses, the counter's
    and managers' expense lists, and the manager's By staff use the new layouts.
  - **Off:** Every screen reads as it does today.

**Off is today for both.** With `auto-approve-at-the-shop` off, the app calls
today's check-in command, and the new command also checks the gate in the
database. So turning it off takes effect in seconds, even on a phone that
opened in the morning. The two settings stay saved but do nothing.

Days already auto-approved while it was on stay present. They are true days, worked
at the shop, and today's screens read them as present days with no approval
line, the shape pre-approval days already have (design D4). A manager can
correct any of them. Nothing is queued: a check-in is never put in the outbox
(round trip `none:`).

`refreshed-staff-screens` changes what is drawn, never what is written. It reaches the
counter tablet's expense list, so it takes a switch rather than a revert
(round trip `none:`). It **depends on `auto-approve-at-the-shop`**: the new screens
run only while check-ins at the shop are approved automatically. Turning
`auto-approve-at-the-shop` off puts today's screens back with it, and
`refreshed-staff-screens` can still be turned off alone.

## Non-goals

- **Detecting fake locations.** Accepted risk (owner, 2026-10-25).
- **A language switch** (Bengali, Hindi). Parked by the owner. The screens stay
  in simple English with icons and chips.
- **Receipt photos on expenses.** A bigger feature, not needed yet.
- **Changing who sets an outlet's position or radius.** It stays owner-only.
- **Settling days that are waiting when the gate turns on.** They stay waiting
  for a manager. Nothing is backfilled.
- **Keeping refused check-ins as evidence.** A refusal under *Block* writes
  nothing.
- **A history of who changed an attendance setting.**
- **Live updates on the staff phone.** The answer to an in-fence check-in comes
  back with the check-in itself. A waiting day still refreshes when the app
  returns to the foreground, never on a timer.
- **The account menu, the sign-in screen and the shell's chrome.**

## Capabilities

### Modified

- `attendance-and-location`:
  - An in-fence check-in settles itself.
  - The two outlet settings.
  - A blocked check-in is refused.
  - Plain evidence words.
  - My attendance and By staff as a month calendar.
  - The tally's words.
- `outlet-expenses`: day headings, the **You** tag, and amount first.

## Impact

- **Database:**
  - two `boolean` columns on `outlets`, default `false`;
  - `set_outlet_attendance_rules`, the managers' and owner's only way to change
    them;
  - `attendance_submit_attempt_v3`;
  - a decision kind `auto_approved`;
  - a nullable `fence_radius_m` on `attendance_decisions`;
  - one widened check on `attendance_decisions`, under a recorded lint
    exception (design D4);
  - the gate rows, off.

  No existing function, trigger or policy changes.
- **App:**
  - the check-in card split into its attempt logic and a new presentational
    *Today pass*;
  - the month calendar shared by My attendance and By staff;
  - the expense list's headings, tag and form;
  - the outlet's Attendance section;
  - the adapter's new refusal sentences;
  - the mock reading both gates.
- **Counter and kitchen:** the counter's expense list and form, behind
  `refreshed-staff-screens`. The request budget does not move: the form reads
  what it reads today.

## Docs To Update Before Archive

- [`docs/BUSINESS_CONTEXT.md`](../../../docs/BUSINESS_CONTEXT.md): the
  2026-07-31 decision ("a manager's approval is what makes it a worked day")
  reversed, dated, with the accepted risk and why the radius now decides.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md):
  - "the fence is evidence, and a manager is the witness" restated;
  - the two settings belong to managers;
  - position and radius stay owner-only, for location integrity.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): the Employee section, By
  staff, the absence wording, and the expense list.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the columns, the
  decision kind and `fence_radius_m`.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): Geofence, and *Auto-approved at
  the shop*.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): what the fence proves
  now that it decides.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md): the staff and manager
  walkthroughs.
- [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md): the calendar's day
  marks.
- Code comments that state the old rule as policy:
  - `attendance-record.ts` (`isWaitingForApproval`);
  - `staff-home.tsx`;
  - the header of `geolocation.ts` (single sample).
