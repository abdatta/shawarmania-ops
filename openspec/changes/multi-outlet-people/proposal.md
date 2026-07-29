# Proposal: multi-outlet-people

> **Model**: Opus · **Wave**: D · **Depends on**: #4, #7, #21 · **Gate**: a person assigned to two outlets checks in and out at each from their own phone — nothing to switch, nothing to learn, the fence works out where they are; every row still records exactly who; a Franchise Admin still cannot reach the other outlet's data, proved by a hand-crafted request; the owner, assigned as manager of one outlet, does that outlet's operational writes there and nowhere else; the owner records a non-cash expense and a stock correction remotely, each visibly the owner's wherever it is read, and anything cash from that path is refused by the database; ending one assignment leaves the person's other assignment and their account untouched; **no staff code exists anywhere in schema or UI**; nobody assigns themselves anything and the last Super Admin cannot lose the role; and the four-role demo walkthrough still walks.

## Why

#21 made the person and the account the same thing; this change lets that one
person work in more than one place. The trigger recorded in the old todo fired
on 2026-07-29, on both counts at once: a staffer is splitting shifts across
the two outlets, and the owner is day-running one outlet.

The todo's original sketch — "grants" held by an account, with one "active
hat" per session and a deliberate switching step — was **rejected by the owner
on 2026-07-29 as needless complexity**. The people using this app are not
technical, and a session mode they must switch is a thing they must
understand, forget, and get wrong. What survives from the 2026-07-28
decisions is everything that mattered: one person has exactly **one login**
(account-per-outlet stays rejected), what they may do where is an **explicit
per-outlet assignment** (blanket role hierarchy stays rejected), and
**attribution never blurs** — every row records exactly who, as it does today.
What is gone is the session-level machinery: no hats, no switcher, no new
vocabulary for staff to learn.

The owner's remote non-cash writes fold in here by the same 2026-07-29
decision (formerly the `owner-break-glass-writes` todo): bounded exactly as
decided on 2026-07-28 — non-cash only, always visibly the owner's.

It runs **before #9** so counter-device shift attribution is designed against
the assignments model rather than retrofitted, and while production still
holds only two accounts — the cheapest this migration of the roles model will
ever be.

## The model, in one paragraph

`profiles`' single role-and-outlet pair becomes an **assignments** relation:
person × role × outlet, managed on the People surface like any other staff
fact. The database answers every question by membership — "may this session
write this row?" becomes "does this person hold the right assignment at this
row's outlet?" — enforced in RLS exactly as isolation is today. **Nothing
about what a person may do is baked into their sign-in token** (owner,
2026-07-29), so nothing is ever reissued or refreshed when an assignment
changes — the policies read the table, and a change bites immediately, the
way deactivation already does. There is
nothing session-scoped to select and nothing to switch: a staffer assigned to
both outlets opens the app and checks in, and **the geofence resolves which
outlet they are standing at**; standing at neither blocks exactly as it does
today, with the same manager override. The owner who runs an outlet is simply
assigned as its Franchise Admin, and writes there like any manager — attributed
to them, badged as the owner's where read.

## Scope

**Assignments** — the relation, its RLS, and the migration carrying every
existing person's single role-and-outlet across as one assignment row. Every
policy that today compares a session's role-and-outlet claims moves to a
membership check. The People surface manages assignments; the existing
guardrails carry over: nobody manages their own account, and the last Super
Admin cannot be removed.

**Check in anywhere you work** — a person with two assignments checks in and
out at each outlet from their own phone; the fence decides which. "My
attendance" shows their days wherever they worked them.

**Per-outlet leaving** — "no longer works at outlet B" ends one assignment,
not the account; #21's two independent levers (deactivation kills sessions,
departure ends staff-list membership) restate against assignments.

**Staff codes retire** (owner decision, 2026-07-29). Nothing keys on them —
#18 recorded that their only job was disambiguating same-named people in
lists, and explicitly kept them meaningless. The column, its uniqueness and
not-blank constraints, the issue trigger, the owner-only change guard, the
prefix freeze, and `outlets.staff_code_prefix` all go; so do the code chips
and edit fields in the UI, and the tests that prove the machinery. Same-name
disambiguation falls back to role title and joining date. If a real staff
numbering scheme ever arrives, re-adding is one migration, and #18's archived
design is the recipe. (One-time **activation codes are unrelated** — they are
how a new person first signs in, and they stay.)

**Owner writes, bounded** — the Super Admin records non-cash expenses and
stock corrections from anywhere, each visibly the owner's: attributed on the
row (already enforced on every write in the system), badged wherever it is
read. **Never anything cash** — a non-cash entry is mathematically incapable
of touching a drawer count, and the drawer stays the Franchise Admin's alone,
always.

## Non-goals

- **No session modes.** No active hat, no role switcher, no "acting as" state.
  Rejected 2026-07-29 for simplicity; if a future need genuinely requires a
  session-scoped mode, it must argue its way in against this decision.
- **No role hierarchy.** Rejected 2026-07-28: seniority widens what you *see*,
  never what you can *attest to*.
- **Never account-per-outlet.** Rejected the same day; nothing here or later
  may mint a second login for a second outlet.
- Nothing cash from the owner's remote path — no cash expenses, no day close,
  no drawer.
- Bills stay on the device/shift path; the tablet-is-dead case is #9's
  emergency-session design question, untouched here.
- Demo's persona switcher already covers "check a flow as another role" and is
  not this feature.

## Design questions to settle during `/opsx:propose`

- **One row per person per business day** is currently an attendance
  constraint; a morning at one outlet and an evening at the other breaks it.
  Per (person, outlet, day)? And what "My attendance" and the outlet
  attendance surfaces show for a split day.
- **Fence resolution edge cases**: standing at neither assigned outlet (block
  and override, as today — confirm nothing else is needed); whether any
  manual outlet picker exists at all, or the fence is the only chooser.
- **A mixed-role person's app shell**: manager at one outlet, staff at
  another — what their navigation shows, without inventing a switcher.
- **The lever board**: assignment ends vs account deactivated vs person
  departed — what each does and what the People surface shows for each state.
- **The owner assigning themselves** as manager of an outlet sits next to
  "nobody manages their own account" — does the other Super Admin do it, or
  is this the one carve-out?
- **Owner-entered rows and the alert stream**: does an FA get a note when the
  owner records into their books, so nothing appears by surprise?
- `aggregator-settlement` (todo) is the first concrete customer of the
  owner's write path — does its entry screen land here or wait for its own
  graduation? (Its own todo says: together, or this first.)

## Docs to update before archiving

`docs/ROLES_AND_PERMISSIONS.md`, `docs/DATA_MODEL.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/SCREENS.md`, `docs/LIMITATIONS.md`,
`docs/GLOSSARY.md` (assignment; staff code removed), `docs/OPERATIONS.md`
(onboarding steps that mention staff codes).
