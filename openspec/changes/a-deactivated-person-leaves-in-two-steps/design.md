# Design: A Deactivated Person Leaves in Two Steps

## The owner's words, 2026-10-30

Three old notes, read back against the code in one conversation:

- *"Deactivated vs Left — why two terms."* The owner's position, argued and
  kept: an account is whether somebody may sign in and do things; it does not
  answer how many people work at an outlet, because people without accounts
  work there too. "Why do we care about when someone exactly left?" They do
  not. What they care about is when access was switched off, and that a
  manager does not lose somebody by accident.
- *"Remove 'Grant owner access' — only by db."* Granting **and** removing owner
  access become database-only. "We can remove all other sources."
- *"No 'Add outlet' for owners (or managers?)."* Both, once the two cases were
  shown: an owner has no outlets to add, and a one-outlet manager's button is
  always disabled.

The design went through three shapes in that conversation; the rejected ones
are recorded under *Rejected alternatives*, because the reasons are the
constraints.

## What was read before deciding

- `src/features/accounts/accounts-surface.tsx`: **Deactivate** in the row menu
  (`setActive(false)`); **Mark as left** in Edit's *Leaving the business*,
  hidden once `lifecycle.kind === 'deactivated'`; `lifecycleLabel` returns
  *Deactivated* before it ever checks for no live assignment, so a departed
  person never reads *Left*; *Show people who have left (n)* lists people with
  no live assignment. Edit's owner section offers *Grant owner access* to any
  non-owner; `assignableRoles` offers *Super Admin* to an owner in Add person.
- `mark_account_as_left` (`20260812000008`) ends every live assignment on the
  Kolkata `current_date` and sets `is_active = false`. `set-active` in
  `supabase/functions/admin-accounts` updates `profiles.is_active` only.
  **No timestamp records when `is_active` changed**: `profiles` has
  `created_at` and nothing else, and nothing audits it. Supabase's logs keep
  roughly a day on this plan, so they cannot date a deactivation from last
  month.
- A Franchise Admin's Team list is filtered to people with a live assignment
  at an outlet they manage (`accounts-surface.tsx`, `list`), and the
  `profiles_select` policy decides the same in the database. **Ending
  someone's assignments removes them from their manager's sight**; this is
  the fact that ruled out a one-step departure.
- `outlet-attendance.tsx` lists a person on a rowless day when
  `isStaffAt(person, outlet) && wasStaffAtOn(person, outlet, date)`, and marks
  a deactivated one with a note. The attendance spec requires it: "a person
  whose account is deactivated but who has not left SHALL still be listed".
  By staff builds assignment windows (`outlet-attendance.tsx` around
  `startedOn`/`endedOn`, read by `attendance-range.ts`) and paints a rowless
  day inside a window absent.
- A username is the Auth alias `<username>@login.shawarmania.invalid`
  (`shared/username.ts`). Everything that records history points at the
  profile id: attendance, bills, drawer counts, assignments. The tablet
  hand-over request stores the username that was **typed**, as text, which a
  reused username does not confuse. `authAliasToUsername` returns `null` for
  any other domain, and Team already renders an account without a username.
  `profiles.phone` is `unique`.
- The migration takes the next free slot after the latest one on
  `origin/stage` when it is written. Staging applies migrations in order and
  refuses one dated before the last it ran, so a slot is never reserved ahead:
  `20261108000000`, agreed with the fixed-costs follow-up on 2026-10-30, was
  overtaken by its `20261109000000` and `20261110000000` the next day.

## D1. Two switches, one everyday verb

An account has two independent facts, and the model keeps them: **where they
work** (assignments, which *are* the permissions per outlet) and **whether they
may sign in** (`is_active`). Today's two verbs each touch a different mix of
them and are offered side by side. This change gives them a fixed order:

1. **Deactivate** flips `is_active` off and records the day. Assignments stay,
   so the manager still sees the person and **Reactivate** restores them
   exactly.
2. **Mark as left**, offered only on a deactivated person, ends the
   assignments as of that recorded day, and frees the username and phone.

Nobody can reach "left" without passing through "deactivated", so an active
person is never wiped by a mis-tap, and the cleanup is a deliberate second act.

## D2. `profiles.deactivated_on`

A nullable `date`, the Kolkata business calendar day the account was last
deactivated. No default and no constraint; additive.

**Written by the account function, not a trigger.** `set-active` already
updates `is_active`; it now writes `deactivated_on` in the same update:

- `true → false`: `deactivated_on = (now() at time zone 'Asia/Kolkata')::date`,
  computed by the database (`app_kolkata_today()` if one exists, else an
  expression in the update), never from the browser;
- `false → true`: `deactivated_on = null`;
- no change of state: untouched.

A trigger on `profiles` was rejected: an ungated trigger on an existing table is
exactly what `lint:migrations` refuses, and the function is the only writer of
`is_active` besides `mark_account_as_left`.

**Written whatever the gate says.** Stamping a new column that only the on path
reads changes no behaviour, and stamping from deploy day means every
deactivation since then already carries its day when the owner turns the gate
on. The old `mark-as-left` action, which today's build calls, also stamps the
day after its RPC succeeds when the account was active before; a departure
then reads as a deactivation on the same day, which is true.

**An inactive account with no day** can exist only from before the deploy, or
from a write the function did not make. It is repaired once (D7). Until then,
the on path treats it as deactivated on an unknown day: Team shows it under
Deactivated without a date, and Attendance lists it as today does (the
conservative reading: nothing hidden that might be real).

**Reactivating clears the day.** The days between are not remembered; a person
off from June to August and back shows those days as rowless staff days again,
painted absent. Accepted (owner, 2026-10-30): a history of periods is a table
and a timeline for something that will happen a handful of times.

## D3. Mark as left: `mark_account_as_left_v2`

A new service-role-only function; `mark_account_as_left` is left untouched for
the build that calls it.

```
mark_account_as_left_v2(p_actor_id uuid, p_profile_id uuid,
                        p_expected_fingerprint text)
returns table (profile_id uuid, state_fingerprint text, left_on date)
```

In one transaction, with the same row locks, stale-fingerprint check and
`account_actor_may_replace_set(p_actor_id, p_profile_id, '[]')` authority as
v1:

1. **Refuses unless the gate is on** (`app_change_gate('deactivate-then-leave')`).
2. **Refuses an active account** (`is_active = true`): "deactivate first". The
   order is a rule of the database, not of the page.
3. **Refuses an owner** while `owner-access-in-the-database` is on (D5).
4. `left_on = coalesce(deactivated_on, kolkata today)`.
5. Ends each live assignment with `ended_on = greatest(left_on, started_on)`,
   so no end precedes its own start (an assignment granted after the
   deactivation ends the day it began).
6. Sets `phone = null`, and `deactivated_on = left_on` if it was null.
7. Returns `left_on`.

The final-Super-Admin guard is not reachable here (an owner cannot be left
while OD is on, and OD off leaves v1 as the only path the off build offers),
but the existing assignment triggers still enforce it.

**Freeing the username happens in the account function, after the RPC.** The
Auth user's email moves to `<profile-id>@left.shawarmania.invalid`: outside the
`@login.shawarmania.invalid` namespace, so it can never match a sign-in, the
username is free at once for `provision` or `set-username`, and
`authAliasToUsername` reads it as no username. It is not the counter's
namespace either (`supabase/functions/_shared/counter-code.ts`).

Ordering and failure: the RPC commits first, then the alias moves. If the
alias move fails, the response is `left_username_held` and the person is still
left, with their username still taken. That is harmless (the account cannot
sign in and is invisible on Team) and costs only a "username taken" on a
rehire; the agent moves it by hand. The new `mark-as-left-v2` action is
idempotent on an already-left account: it skips the RPC and retries the alias.
Rejected the other order (alias first, then RPC): a failed RPC would leave a
deactivated, still-assigned person whose username had been given away.

## D4. Team, with `deactivate-then-leave` on

- **Main list:** active people only. A person with `is_active = false` and at
  least one live assignment is **Deactivated**; one with no live assignment
  (left, by either path) is **left** and not listed at all, for the owner or a
  manager.
- **Deactivated (n)** replaces *Show people who have left (n)*: a ghost button
  under the table that expands a second table of the deactivated, sorted by
  day, newest first. Status cell: *Deactivated · 12 Oct* (*Deactivated* alone
  when the day is unknown). Row menu: **Edit**, **Reactivate**, **Mark as left**.
  Change username and the hand-over actions are not offered on a deactivated
  person, as today.
- **Deactivate dialog:** "Deactivate Rahul? They can't sign in from now, even
  if their app is open. They move to Deactivated, where you can reactivate
  them or mark them as left." The sentence about marking as left from Edit
  goes.
- **Mark as left dialog** (proposal wording) names the day, the username and
  that the phone number is freed. Confirm label **Mark as left**, danger.
- **Edit** loses *Leaving the business*.
- **A manager** sees exactly the people today's list shows them, split the same
  way, and may act only where they may manage today. Marking someone as left
  removes them from the manager's list; that is the point (owner: "they
  consciously make the decision").

Off: today's `AccountsSurface` path, untouched.

Owner UI conventions apply (memory: list like Team, verb-only buttons, no
subtitle under a heading, no dot for a setting).

## D5. Owner access in the database (`owner-access-in-the-database`)

**The page, with the gate on:**

- `assignableRoles` drops `super_admin`: Add person creates staff and managers
  only, and its *Email* field (shown only for Super Admin) goes with it.
- Edit's *Owner access* section is not drawn, so `intendedAssignments` carries
  the target's existing Super Admin assignment through unchanged, and nothing
  adds one.
- An owner's row (a live `super_admin` assignment) offers **Edit**, **Change
  username**, the hand-over action and **Change sign-in email**; never
  **Deactivate**, **Reactivate** or **Mark as left**.

**The account function, with the gate on**, reading
`app_change_gate('owner-access-in-the-database')` through the service client
on each request (the rule for Edge Functions in `AGENTS.md`), refuses with
`owner_access_in_database` (403):

- `provision` with `role = 'super_admin'`;
- `assign` with `role = 'super_admin'`;
- `end-assignment` of a `super_admin` assignment;
- `edit-account` whose intended set adds a Super Admin assignment the target
  does not hold, or omits one they do;
- `set-active` on a target holding a live Super Admin assignment;
- `mark-as-left` and `mark-as-left-v2` on such a target.

`set-account-email` stays: it is a credential detail, not a grant.

**The procedure** goes into `docs/OPERATIONS.md`: granting owner access is one
`assignments` row (`role = 'super_admin'`, `outlet_id = null`,
`started_on` = Kolkata today) plus `set_super_admin_account_email`, in one
transaction as the service role; removing it ends that row, and the existing
final-Super-Admin trigger still refuses removing the last one. Deactivating an
owner is `is_active = false` with `deactivated_on`. The procedure states that
it bypasses the gate on purpose, and that the agent shows the owner the
statement before running it on production.

**Off:** today's page and function, unchanged.

## D6. Edit's outlets (no gate)

In `EditPersonSheet`:

- **Owner target** (`ownerAssignment !== null` and no ordinary assignments):
  the expanded outlets section, *Add outlet*, *Works at multiple outlets* and
  the "Add an outlet before saving" warning are not drawn. Save is already
  valid for such a person (`intendedAssignments` holds the owner row).
- **Nothing addable** (`addableOutlets.length === 0`): *Add outlet* and the
  *Works at multiple outlets* toggle are not drawn. A one-outlet manager
  editing a one-outlet employee sees the outlet and role only.
- An owner who also holds an outlet role (rare) still gets the section, since
  that row is real.

`expanded` currently opens for any owner target; that condition goes.

## D7. The existing deactivated people

The migration changes no row (`lint:migrations`). Before the gate is turned on,
the agent:

1. Lists, read-only against production, every profile with `is_active = false`
   and `deactivated_on is null`: name, live assignments, last attendance
   business date, last sign-in (Auth `last_sign_in_at`, Kolkata date).
2. Proposes a day for each: the last attendance date; else the last sign-in
   date; else, if they never worked or signed in, the day they were created.
3. Shows the owner the list; the owner corrects any by hand.
4. Writes the agreed days in one transaction as a recorded data repair (the
   statement and the list go in this change's folder as `repair.md`).

The owner expects very few rows (2026-10-30).

## D8. Attendance, with `deactivate-then-leave` on

One rule, one helper: a new `wasActiveOn(person, businessDate)` beside
`wasStaffAtOn` in `src/data-access/adapters.ts`, true when the person is active
or `businessDate <= deactivatedOn`, and true when inactive with no day (D2).

- **By day:** a rowless person is listed only when `wasActiveOn` also holds. A
  person with a record on the day is listed whatever it says. The
  *deactivated* note stays on the deactivation day itself.
- **By staff:** each assignment window is capped at `deactivatedOn`
  (`endedOn = min(endedOn ?? deactivatedOn, deactivatedOn)`), so the month
  paints no absent day after it. The person picker keeps listing them while
  they are deactivated and not left, so their past months stay readable.
- **Manual entry** offers an outlet for the person only on days `wasActiveOn`
  holds. The database's manual-entry function is not changed.
- **Waiting counts** come from rows and do not change.

`RosterPerson` gains `deactivatedOn: string | null` from the people read
(`profiles.deactivated_on`, readable under the existing `profiles_select`
policy; no new grant).

Off: `outlet-attendance.tsx` exactly as today.

## Version skew

- **`profiles.deactivated_on`**: new, nullable; no published build selects it.
  A build published before the migration keeps working; the new build reads it.
- **`mark_account_as_left_v2`**: new. `mark_account_as_left` is untouched and
  still called by the old build's Edit sheet and by the new build with
  `deactivate-then-leave` off.
- **`admin-accounts` function**: deployed with the Promote and called by every
  build. Its changes are: stamping `deactivated_on` (a column only the new path
  reads), a new action (`mark-as-left-v2`) the old build never sends, and
  refusals that apply only while `owner-access-in-the-database` is on. With
  both gates off every request an old build sends behaves as today. A
  Republish of an older build restores the build, not the function, and that
  build works with this function by the same argument.
- **Gate rows**: inserted off by the migration.
- **What Off does to what On persisted:** see the proposal's *Change gate*.
  Left people read as departed on today's Team; a moved alias reads as no
  username; a null phone is a missing optional fact. `deactivated_on` values
  stay and are ignored. Nothing is queued (round trip `none:` for both gates).

## RLS and authority

- No new table, so no new isolation test of that kind. `deactivated_on` is a
  column of `profiles`, read under `profiles_select`: a manager reads it only
  for people they already see. Writes go through the service role only.
- `mark_account_as_left_v2` is granted to `service_role` only, revoked from
  `public, anon, authenticated`, and re-derives authority from the actor id as
  v1 does. pgTAP: a manager may leave a deactivated Employee wholly theirs;
  may not leave one who also works at an outlet they do not manage; nobody may
  leave an active account; nothing runs with the gate off.
- The owner refusals are proved by hand-crafted requests in the auth suite,
  one per action listed in D5, as the owner's own session (the only caller who
  could make them before).

## Money, offline

No money arithmetic. Nothing on the counter, and nothing in the outbox.

## Demo

The mock accounts adapter mirrors the stamping, the v2 leave (refusing an
active person, dating by the day, clearing the phone and username) and the
owner refusals behind the same gates. The fixtures carry one deactivated Biller
with a day ten days back and attendance rows before it, so the demo shows the
Deactivated section and the attendance cut-off. The owner approves the Team
page and By day from the demo with both gates on before the live wiring is
finished.

## Release

The page and function changes reach production off. Then, in order:

1. Run the D7 repair, owner-reviewed.
2. `/release owner-access-in-the-database` at any hour (Team only).
3. `/release deactivate-then-leave` at any hour: watch By day and By staff
   for the outlet's deactivated people, then pull it once, off and on.

Neither touches the counter, so neither needs a quiet hour.

## Rejected alternatives

- **Keep both verbs side by side, fix only the labels** (first suggestion,
  2026-10-30). Leaves the reader to choose between two rivals; the owner asked
  why the second verb exists at all, rightly.
- **One verb that ends the outlets as well** (today's Mark as left, made the
  only verb). A manager who used it would lose the person from their list at
  once and could not undo it; a returning person would need their outlets
  rebuilt by hand.
- **One verb that only switches sign-in off, never ending outlets.** Simple,
  but every leaver would read *Works at Kalyani* forever and the Deactivated
  section would only grow with turnover.
- **An owner-only *Left* section, so the owner can rehire.** Its only reason
  was the old username blocking a new account; freeing the username removes the
  reason (owner, 2026-10-30).
- **Left dated by the day it is pressed** (no migration). The owner rejected a
  clean-up date stored as a departure date: "it has no significance".
- **Deriving the day instead of storing it** (last attendance as the
  deactivation day). Still needs the leave function rewritten, which is itself
  a migration, and quietly hides absences between someone's last check-in and
  their deactivation.
- **The day in Auth user metadata.** Invisible to the attendance read, which
  never calls the account function (attendance spec, *The roll-call's people*).
- **A trigger stamping the day.** Refused by the migration rules; the function
  is the only writer.
- **A history of deactivation periods.** Machinery for a rare reactivation; the
  gap is accepted.
- **Freeing the username by renaming it inside the login namespace**
  (`left.<id>@login…`). It would read back as a username and could collide
  with the username rules; a separate domain reads as none.
