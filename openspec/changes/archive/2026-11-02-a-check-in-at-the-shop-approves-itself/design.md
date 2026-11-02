# Design: A Check-in at the Shop Approves Itself

## The owner's words, 2026-10-25

Settled over one conversation, after a red-team review of the first draft.
**Do not reopen these without a reason they did not consider.**

1. **A check-in the phone's location puts inside the fence needs no manager,
   late or not.** Late is still recorded. Only an outside or no-location
   check-in waits.
2. **The rule is distance only:** inside the outlet's own radius counts,
   whatever the reading's accuracy. Not distance plus accuracy, and not an
   accuracy cap.
3. **Spoofing is an accepted risk.** "None of the staff are technical enough …
   even if there is someone … nobody would really do that … they'll be caught
   soon enough, because there's enough people seeing if somebody is not showing
   up." Attendance is a convenience record and an easy history, not a control.
4. **The manager-presence signal is not wanted for in-fence days.** The
   2026-07-31 decision made an approval prove the manager was at the shop; for
   an in-fence day that goes.
5. **Two settings, named so that off is the default.**
   - *Manager approves every check-in*: off means in-fence days are approved
     themselves; on means today.
   - *Block check-ins away from the shop*: on means an away check-in is refused
     outright, and the manager records the day by hand. It exists to break the
     manager's habit of approving everything and make every away day deliberate.
6. **Block refuses a check-in with no location too.** Otherwise turning location
   off is the way round it.
7. **Both settings belong to the outlet's managers** (and the owner).
   "Attendance management itself can be completely an outlet manager, a
   franchisee admin's thing." **Position and fence radius stay owner-only**, for
   a different reason: they prove where a franchise actually trades, so nobody
   trades elsewhere under the brand.
8. **The language switch is dropped for now.** Simple English, icons and chips.
9. **Expenses:**
   - keep the Today/Yesterday headings, the You tag and amount first; the
     category stays typed (the buttons were tried and withdrawn, D9);
   - **keep the Cash chip** ("it still makes it clear to them that this is about
     cash");
   - drop the receipt photo;
   - simplify the note's example;
   - **the counter tablet gets the same.**
10. **The 1–5 October check-ins from about 2.6 km away** may keep waiting for a
    manager under the new rule.
11. **The demo comes first.** The owner approves every screen before anything
    is wired live (the usual order).

## What was measured before deciding

Production, read-only, 2026-10-25:

- **Kalyani and Kanchrapara are `is_active = false`**, with no live
  assignments. Kalyani Cafe is the only open outlet: radius 150 m, position
  captured in September at ±13.5 m, five live staff assignments.
- **The Cafe's 27 phone check-ins since 1 October:**
  - **19 measured inside the fence:** median 15 m away at ±20 m; the worst was
    31 m at ±104 m. All 19 count under decision 2. An accuracy cap of 100 m
    would have wrongly held back the last one. Distance plus accuracy would have
    passed all 19.
  - **6 measured about 2.6 km away**, all manager-approved. They will wait.
  - **2 carried no position.**
  - **3 recent in-fence days were not yet present.** These are the kind of rows
    that turning the gate on leaves waiting (*Release*).

The staff screens were walked in the demo at 375 px, light and dark. What
they showed:

- A clean check-in shows a warning triangle and "Waiting for a manager to
  approve" twice, with no success moment.
- The Today card never names the outlet.
- After an outside check-in the primary button reads "Check in again".
- Home offers Check in while My attendance shows today red *Absent*, and Home
  never shows the deadline.
- The action sits in the top third: a greeting, two lines of "Assigned to…" and
  a button that repeats the bottom tab push it down.
- The blocked panel is a four-row table (distance and "beyond by" say the same
  thing), a 68-word paragraph and three orange buttons.
- Location-denied with two outlets shows three orange buttons and two "Try
  again"s, and "Try again" cannot fix a denied permission.
- The evidence chips (`12 m`, `±14 m`, `phone`) are a manager's vocabulary.
- The tally "7 Present · 2 Late · 16 Absent · 1 Waiting" does not say whether
  late is inside present.
- Rows read "25 Oct 2026", with no weekday and the month repeated; a month is
  25 stacked cards.
- There are subtitles under headings on all three screens.
- Expenses mixes today and yesterday, leaves your own rows unmarked, and asks
  the category (a blank box) first and the amount last.

## D1. The rule, and where it is decided

A phone check-in **is auto-approved at the shop** when the database's own distance, from
the stored coordinates to the outlet's stored position, is at most the outlet's
`geofence_radius_m`. This is the predicate the retry lock already uses
(`20261101000000…sql:264-273`: "the current in-fence attempt must be decided
before another check-in"). Because one predicate answers both "auto-approve"
and "locked against retry", a reading cannot both fail to count and be locked
against a better one. That was the deadlock the first draft's
distance-plus-accuracy rule created.

It is decided **only in the database**, in the check-in command, because a
check-in's coordinates are whatever the client sends
(`attendance_submit_attempt_v2` stores `p_lat`, `p_lng`, `p_accuracy_m` as
given). The client's own fence evaluation stays what it is today: courtesy
copy, never authority.

**Two outlets.** The client picks the nearest surveyed active outlet
(`resolveOutlet`, `check-in-card.tsx:109`), and the server judges only the
outlet it is named. A day is approved automatically only when the reading is inside the
named outlet's fence **and not inside any other active outlet the person holds
a live staff assignment at**. An ambiguous reading waits for a manager. Nobody
can hit this today, because only one outlet is active. It costs one `exists`,
and keeps the next nearby outlet from counting days at the wrong shop.

## D2. The settings

Two columns on `outlets`, following `each-outlet-chooses-how-it-serves` (#60):

```sql
alter table public.outlets
  add column attendance_needs_manager boolean not null default false,
  add column attendance_blocks_away boolean not null default false;
```

- **On the outlet row**, because `outlets_select` already gives it to everyone
  who needs it: the owner, the outlet's managers, its staff (the check-in card
  reads the outlet row) and its tablets. A table of its own would need its own
  policy and isolation case to say the same thing.
- **Changed only through `set_outlet_attendance_rules(p_outlet, p_needs_manager,
  p_blocks_away)`.** It re-derives authority from the caller: the owner
  anywhere, a Franchise Admin with a live assignment at the outlet. It writes
  these two columns and nothing else. `outlets_update` stays the owner's alone,
  because widening it would hand managers the position and radius (decision 7).
- **Defaults off.** Off and off is the new behaviour; *needs manager* on is
  today; *blocks away* on is new and stricter.

**The section**, on the outlet's own page, first after **Details** and above
**Orders** [owner, 2026-10-29], in #60's shape: a small quiet
**Attendance** label, two rows each with a switch, its name, and one plain line
of what it does in its current state. It is shown to the owner and that
outlet's managers while `auto-approve-at-the-shop` is on, and hidden while it is
off, because the settings do nothing then. On an outlet whose position has not
been captured, *Block* says: *"This shop's location isn't set, so every
check-in would be refused."*

## D3. `attendance_submit_attempt_v3`

v2's body, with role includes and the server-authoritative instant unchanged,
plus three additions. Its first line after authority:

```sql
v_rules_on := public.app_change_gate('auto-approve-at-the-shop');
```

With the gate off, v3 behaves exactly as v2. That makes the database the
instant switch: a phone that loaded its snapshot this morning and still calls
v3 gets today's behaviour seconds after the owner turns the gate off.

1. **Block, before anything is written.** With the gate on and
   `attendance_blocks_away`, compute
   `v_distance := app_distance_m(outlet position, p_lat, p_lng)`. This is the
   same function the attempt trigger uses, so it gives the same answer. If it
   is null (no position, or an unsurveyed outlet) or greater than the radius,
   raise `check-in away from the shop is blocked here`
   (errcode `check_violation`). Nothing is written. A replay of the same
   attempt id is refused the same way, because no attempt row exists for it to
   find.
2. **The arrival, unchanged.** The day row is created or locked, the retry rules
   apply, the attempt is inserted (its trigger computes `distance_m`), and the
   day row takes the arrival in one update, exactly as v2.
3. **Settle, in a second update.** With the gate on, `not
   attendance_needs_manager`, `v_attempt.distance_m <= radius`, and no other
   assigned active outlet's fence containing the reading (D1):
   - insert the `auto_approved` decision (D4);
   - set `attempts.settled_at`;
   - then `update attendance set status = 'present', current_attempt_id = null,
     outcome_attempt_id = <attempt>, latest_decision_id = <decision>,
     retry_blocked = true, state_version = state_version + 1`.

   **It has to be a second statement.** `attendance_evaluate_geofence`, still
   live from `20260731000001…sql:195-238`, fires on every write including
   command writes. On the arrival of a check-in
   (`tg_op = 'INSERT' or old.check_in_at is null`) it resets `present` to
   `absent` whenever `approved_by` is null. On a first-of-day check-in, v2's
   arrival update is that arrival. Setting `present` in the same statement
   would be silently undone, and only on first attempts. In the second update,
   `old.check_in_at` is not null and the branch is skipped. Replacing the
   trigger is not an option: it is `create or replace` on a function every
   published build's writes run through. pgTAP pins first attempts and retries
   separately.

**Retries under the new rule.** An outside pending attempt followed by an
in-fence retry supersedes it and counts, which is the *Check my location again*
path. An in-fence pending attempt exists only with *needs manager* on, or from
before the gate turned on, and stays locked as today. A day approved automatically
has `retry_blocked = true` and an outcome, so v3's existing checks refuse
another check-in, and the card offers none.

## D4. What an auto-approved day stores

- **The day row:**
  - `status = 'present'`;
  - the outcome and latest-decision pointers;
  - `retry_blocked = true`;
  - and **no approver**. `approved_by`, `approved_by_name`, `approved_at` and
    the approver's position stay null.

  So `attendance_approval_complete`
  (`(approved_by is null) = (approved_at is null)`) holds without being
  touched, and so do `attendance_reason_needs_approval` and
  `attendance_approver_position_needs_approval`. A build published before this
  change reads the day the way it reads a pre-approval legacy day:
  `isWaitingForApproval` false, status present, `ApprovalNote` absent
  (`evidence.tsx:163-164`).
- **The decision row.** `kind = 'auto_approved'`, added to the
  `attendance_decision_kind` enum (`add value`, which `lint:migrations` allows,
  as `correct_time` was added). Also:
  - `actor_id` and `actor_name` null. **Blank on purpose, not a placeholder**
    (owner asked, 2026-10-26). The explicit record is the `kind` itself:
    `auto_approved` says *nobody decided this, the fence did*, in the column
    every screen and query already switches on, beside the radius that judged
    it. The actor columns answer only *which person decided*, and the honest
    answer is none:
    - `actor_id` is a link to a real account, so it cannot hold a word like
      "auto";
    - writing "Auto-approved" into `actor_name` with no `actor_id` would break
      `attendance_decision_actor_paired`, a second rule to loosen, and every
      screen that prints "by {actor_name}" would print "by Auto-approved";
    - the staff member's own name would record them approving their own day
      (*Rejected alternatives*).

    The screens print *Auto-approved at the shop* from the kind;
  - `prevents_retry = true`, which `attendance_decision_retry_semantics`
    already demands of a new kind;
  - previous status `absent`, new status `present`;
  - and the new nullable `fence_radius_m integer`, stamping the radius that
    judged it. The attempt stamps its distance and deadline but not the
    radius, so after the owner edits a radius, "it was inside" could not
    otherwise be reconstructed.
- **The one widened check.** `attendance_decision_actor_required` is
  `check (kind = 'legacy_outcome' or actor_id is not null)`. One statement
  widens it to `kind in ('legacy_outcome', 'auto_approved') or actor_id is not
  null`, under:

  ```sql
  -- release-lint: allow drop, constraint — widened so the on path can write a decision no person made; no published build writes auto_approved, and every row it accepted it still accepts
  ```

  `AGENTS.md` lets this exit stand only with the owner's agreement recorded in
  the design. **Agreed, 2026-10-26:** "I'm okay with you loosening the db
  table." With the blank actor, the kind carrying the meaning, as above.

## D5. A blocked check-in

- **The adapter** maps the refusal to code `blocked_away`, with its own
  sentence. The mock adapter refuses with the same code and words.
- **The card** reads `attendance_blocks_away` from the outlet row it already
  holds:
  - **Outside:** *"You're not at the shop, so this check-in wasn't recorded.
    Go inside and try again, or ask your manager to record it."* The primary
    action is **Try again**. There is no *Record it anyway*. **Why?** opens the
    distance. (On the refreshed screens: **Check-in denied** and **OK**, D6.)
  - **No location:** the same sentence, plus how to turn location on (D7).
  - **Unsurveyed outlet:** *"Check-ins here are recorded by your manager."*
- The client's copy is courtesy. The refusal is the database's, proved by a
  hand-crafted request in pgTAP and the REST suite.
- **Record arrival** (`attendance_record_manual_v2`) is untouched. It is the
  way a blocked day is counted, and it already settles the day as it records it.

## D6. The manager's side

- **Roll-call and person view.** A day whose latest decision is
  `auto_approved` reads **Present** with a quiet *Auto-approved at the shop · 9:02
  am* line where an approval note would sit. The line renders whenever such a
  decision exists, and is not gated: rows of that kind exist only because the
  gate was on, and once written they must read correctly with it off. It is a
  new label in `DECISION_LABELS`, so the history reads *Auto-approved at the shop*
  with no "by", plus a `?? 'Recorded'` fallback so no unknown kind ever prints
  `undefined`. `AttendanceHistory` shows its line when a day has more than one
  attempt, as it does for every kind.
- **Correct** works as on any settled day. `attendance_correct` requires
  `current_attempt_id is null`, which an auto-approved day satisfies, and finds the
  attempt through `outcome_attempt_id`.
- **Waiting counts, attention badges, batch decisions.** These read
  `current_attempt_id`, so an auto-approved day leaves them by construction. Nothing
  changes in `countWaitingByOutlet`, `attendance_decide_set` or the attention
  sources.
- **Tallies.** `tallyDays` already counts a recorded present day as present.

## D7. The Today pass (`refreshed-staff-screens`)

`check-in-card.tsx` (757 lines) splits:

- **the attempt state machine**, unchanged: idle → locating → blocked /
  unlocatable / which-outlet / confirm / error;
- **a presentational `TodayPass`**, one unit test per state, that draws:

```
┌──────────────────────────────┐
│ Mon 26 Oct                   │
│ Kalyani Cafe                 │
│ Late after 1:00 pm           │
│  ✓ Checked in   9:02 am      │
│    Approved                  │   or ○ Waiting for your manager
│ This month                   │
│ [ 7 Present  2 Late  0 Absent  1 Waiting ] │  today's My attendance counts
├──────────────────────────────┤
│        [  CHECK IN  ]        │   straight after the month, no gap
└──────────────────────────────┘
```

- **Removed:** the *Hello, name* title, the *Assigned to…* subtitle and the
  *My attendance* button (the bottom tab is the way there). The page heading is
  the date.
- **Success:** a green tick and the outlet named. `navigator.vibrate(30)` where
  it exists; iOS ignores it, so it is never the only signal.
- **Waiting** (outside or no position, any check-in with *needs manager* on, or
  an in-fence day left waiting from before the gate turned on): one calm line with a neutral clock icon, not a warning triangle. The
  retry action becomes a secondary link, **Check my location again** (*Try a
  better location* read as vague [owner, 2026-10-28]), never the
  orange button.
- **Problems:** a title, one primary decision, and **Why?** for the numbers.
  *As built* [owner, 2026-10-26]: away from the shop reads *You don't seem to
  be at the shop*, with **Check in anyway** and **Not now**. Check in anyway
  takes a fresh reading before it writes, so somebody who has walked in since is
  approved like anyone at the shop; if no reading comes back, the earlier one
  stands. That a manager then approves an away check-in is a small line under
  the button, never the button's words. No location offers the same pair. A
  check-in refused under *Block* is titled **Check-in denied**, says *You're
  not at the shop. Ask your manager.* (with **Why?**, or why there was no
  position), and has one button, **OK**, which closes it [owner, 2026-10-29]:
  a **Check in again** there brought the same popup straight back and read as
  nothing happening, and Home's own **Check in** is the way to try from
  elsewhere. There is no "Try again": every button is about checking in, or a
  way out.
  *As built* [owner, 2026-10-28]: a check-in with nothing to decide never
  leaves the card; the **Check in** button spins while the phone reads and the
  row saves. A decision (away, no position, which shop) opens a **Check in**
  popup centred on the screen, as the app's yes-or-no popups already are (its
  form sheets open at the top on a phone, which made the flow jump there). The
  button pressed in the popup spins in its turn, every button waits, and no
  screen in between says what is being read. Closing the popup is **Not now**,
  and it does not close while a reading or a save is in flight.
  - **A second check-in only where it changes the answer** [owner,
    2026-10-28]. What anyone reads is in the fence or not, so: rechecking a day
    waiting from away saves nothing while still away (or with no position) and
    answers on the link itself, with no popup: the link becomes *Still not at
    the shop* in red words with no fill (a fill read as a button), shakes once, holds three seconds and fades
    back (a line under the link read as left behind); from the shop it
    approves the day straight away. An approved day offers nothing, however it
    was approved. A day marked absent keeps **Check in again**. And on these
    screens there is no *Use this new check-in?* sheet: a recorded second
    check-in is the truer one, late if it is late ("if it is late, it is
    late"). *Rejected:* keeping the sheet for its *On time → late* line (no
    one is choosing between an on-time day away and a late day at the shop),
    and dropping the recheck link entirely (it spares the manager on the days
    someone checks in from the road and then arrives).
  - **The day takes the button's place** [owner, 2026-10-28]: once checked in,
    today's line sits where **Check in** was, as one tile, below the month. An
    approved day draws its green tick when it turns approved on screen (the
    circle goes round, then the check, then a small swell), and shows it still
    when Home opens on a day already approved or when the phone asks for less
    motion. Waiting keeps its quieter **Check my location again** beneath the
    tile; a day the manager marked absent with retry open keeps **Check in
    again**. Those two are the only states with a button after checking in.
  - **The demo's place switch** [owner, 2026-10-28]: on the Staff and Admin
    walkthroughs the demo banner carries a pill choosing where the phone is
    (the device's own location, at the shop, away, location off, no signal).
    It stands in for the phone's reading through `standInGeolocation` in
    `src/lib/geolocation.ts`, so every case is reachable from a desk, and from
    a phone on the demo's plain-http address, which has no location at all.
    It copies the look of the Waiter's location pill (#80) and is a sibling,
    not a reuse: that one sets the Waiter's presence record, not a reading.
    It shows only while `refreshed-staff-screens` is on, so the demo's off
    path is today's banner exactly (the gates-off browser run found it there).
  The card is as tall as what it says, with the button straight after the
  month: holding the button low for the thumb left a hole above it. No position
  reads *Couldn't get your location*, with no advice on where to stand, and a
  refusal under *Block* no longer says "try again inside".
  - **Denied location** shows how to turn it back on: for the installed app,
    *App info → Permissions → Location*; in Chrome, the lock icon by the
    address. It is detected up front with
    `navigator.permissions.query({ name: 'geolocation' })` where supported,
    guarded where not.
  - **Two outlets with no position:** one list of outlets, and one way to try
    the location again.
- **Before checking in:** *Late after 1:00 pm*, static. After the deadline:
  *Not checked in · late since 1:00 pm*, with the button still live, because a
  late check-in is accepted. There is no ticking countdown, because a live
  countdown is a timer.
- **The month line** reads the month already read for My attendance, through
  the same hook, on mount and on returning to the foreground. Never on a timer.
- **Evidence chips in plain words:** *At the shop*, *1.2 km away*, *No
  location*. The metres and accuracy move behind **Why?**. The manager's
  roll-call keeps its numbers: these are words for the person, and the facts
  behind them are the same.

**GPS: adaptive sampling.** `geolocation.ts` takes one reading "on purpose …
a sampling window would be latency they can feel." That stays the first step.
The card answers at once when that reading is inside a fence at ±50 m or
better, or sharp (±25 m or better) wherever it lands. Otherwise it runs
`watchBestPosition` for up to 6 s, showing the reading tighten, stops as soon
as a reading passes, and decides on the best. *As built:* the "sharp anywhere"
case was added in the demo, because someone clearly a kilometre away gains
nothing from six more seconds of reading. This reverses the single-sample decision for that case
only. The reason has changed: a better reading now saves a manager's tap. It is
still read in direct response to the check-in, so the privacy rule (*position
only at check-in, approval, outlet capture*) holds.

## D8. My attendance and By staff: a month calendar (`refreshed-staff-screens`)

- **A seven-column grid of day numbers**, Monday first. Each day's state is
  in how its number is drawn, always as an open ring in the colour of its
  status chip [owner and co-owner, 2026-10-29: filled discs flooded the month]:
  present a green ring, as the chip's tick, late the same ring with the late
  tag's clock, filled yellow, at its corner (a late day is a present day; a
  filled clock still reads as a dot at a glance [owner, 2026-10-29]), absent a
  red ring with the chip's slash, broken around the number (the slash, not the
  red, keeps it apart from present), waiting a ring of yellow dashes (with the
  clock too when that arrival was late: waiting and late are two facts), leave
  or half day a grey ring, today with nothing recorded a grey ring as the *Not
  yet arrived* chip, and once today has a status, that status's ring; a day to
  come a bare number. My attendance has no Back, being a tab of its own [owner,
  2026-10-28]. *Earlier rounds, superseded* [owner, 2026-10-28]: today was not
  ringed at all. *As built* [owner, 2026-10-26]: green
  read as out of theme; "filled would imply its attendance is completed", so
  only a counted day is filled and the days not counted are open rings; solid
  against dashed keeps absent and waiting apart (a solid ring reads decided, a
  broken one not yet) without relying on red against yellow. The dashes are
  drawn as a few long strokes, not a CSS dotted border, which on a small circle
  came out as fine specks [owner, 2026-10-26]. Home shows the month as the four
  counts My attendance shows in production today, not a line of text [owner,
  2026-10-27]. On My attendance each count sits inside the circle
  its days are drawn in, so the counts are the calendar's key [owner,
  2026-10-27]. A month is mostly present (up to five absences are allowed without a
  pay cut). Never colour
  alone (`DESIGN_SYSTEM.md`): the states differ by shape too, and each day names
  its state to a screen reader. *As built:* the first demo drew an icon and a
  letter in every cell and was turned down as "not even obvious that it's a
  calendar" [owner, 2026-10-26].
- **Tapping a day** opens a bottom sheet with the existing shared evidence
  components, unchanged.
- **The counts** keep their numbers, as four tiles above the grid, each
  beside the disc it counts, so the tiles are the key and no separate legend is
  needed. Home's one line says *7 present · 2 arrived late*.
  - The numbers stay because By staff "exists so somebody can work out pay by
    hand" (`SCREENS.md:539`), and `tallyDays` counts late on any late day,
    waiting and denied included (`attendance-record.ts:450-473`).
  - "2 arrived late" is therefore true where "(2 late)" inside present would
    not be.
- **Today's cell** reads what the manager's reading says: `readDay` is the one
  derivation, and the symmetry rule keeps it. Home is where "you can still
  check in" is said.
- **Every date names its weekday** (*Sun 26*), and the month and year appear
  once, in the stepper.
- **Leave detail** reads *Leave* rather than *Arrived not recorded*. The
  approval line reads *Approved by Name, 9:18 am · at the shop* instead of the
  cryptic shield.
- **By staff renders the same calendar**, because the employee and manager
  views are built by sharing components (`SCREENS.md`, Employee section) and
  the gate flips both together.

## D9. Expenses (`refreshed-staff-screens`)

Wherever `ExpenseList` renders (staff phone, counter tablet, owner and manager
Expenses, the Cash drawer's breakdowns):

- **Day headings.** Where a list spans more than one business date (the staff
  shape's two days), the rows group under **Today** / **Yesterday** / *date*
  and drop the per-row date. A one-day list is unchanged.
- **A You tag** on rows whose `recordedBy` is the viewer. It is the cue for
  which rows can be changed: for staff those are exactly their own; for the
  owner and managers it still says who wrote it.
- **The Cash chip stays** (decision 9).
- **The Add sheet asks the amount first.** Its numeric input is the same field
  (`inputmode`, not a drawn keypad, so `lint:keypads` is not engaged). Then the
  category, in today's typed field with its suggestions. *As built, then
  withdrawn* [owner, 2026-10-28]: the first demo offered the category as six
  tap buttons (the list's most used, then **Other** opening the field). A
  replay of Cafe's last 28 days of hand-typed expenses (154 entries) found the
  buttons would have held what was typed 13% of the time, because the staff
  list holds only today and yesterday so the six changed daily and filled
  from a catalogue of one-off names; a 28-day count would have reached 25%,
  needed a new read and frozen misspellings (*ice creem*) as buttons, and 8%
  of entries were typed variants of a button already on screen. Staff type,
  and different spellings are accepted: reporting will group them (fuzzy or
  AI matching) when it is needed, without rewriting rows. Production's
  categories are left unmerged. *Superseded* [co-owner and owner,
  2026-10-29]: with `expense-category-list` on, the category is a tile from
  the owners' list (D11). Then *Paid with* (owner and manager
  only, still unchosen), then **Note (optional)** with *What was it for?*. Four
  fields, as the spec demands.
- **No subtitle under the Expenses heading** (owner UI convention).

## D10. The gates

| Key | Code | Covers | Round trip |
|---|---|---|---|
| `auto-approve-at-the-shop` | AA | v3 and the toggle point that calls it; the outlet's Attendance section; the mock's rule | `none:` nothing is queued; an auto-approved day is a true, correctable present day |
| `refreshed-staff-screens` | RS | Today pass, adaptive sampling, plain chips, calendar (My attendance and By staff), tally words, expense list and form. **Depends on `auto-approve-at-the-shop`** | `none:` changes what is drawn, never what is written |
| `expense-category-list` | EL | The category tiles, *Other*'s note, the owners' list on Expense categories (D11). **Depends on `refreshed-staff-screens`** | `none:` its rows are ordinary text categories; its own table is never read with it off |

**`refreshed-staff-screens` depends on `auto-approve-at-the-shop`.** The new screens are
designed around *Approved* being a state a check-in reaches. Drawing them over
today's every-day-waits rule would mean designing and testing a third
combination nobody will run. So they run only while it is on. Pulling
`auto-approve-at-the-shop` also puts today's screens back, which is harmless.
Pulling `refreshed-staff-screens` alone is still possible: for example, if the counter's
expense list misbehaves, the check-in rule stays on.

**The cap.** Independent gates live today: `tablet-health`, `fewer-requests`,
`pro-rata-pnl`, `role-includes` (`probe` is exempt). `AGENTS.md:84` allows
five. A dependent gate does not count, so this change adds one and fits
without waiting for `role-includes` to retire.

**Why not one gate:** `refreshed-staff-screens` reaches the counter tablet's expense list
and `auto-approve-at-the-shop` reaches pay. Being able to turn the screens off while
keeping the rule is worth the second key.

## D11. Expense categories are the owners' list (`expense-category-list`)

**Asked for on 2026-10-29**, after the demo round, by the co-owner (Supratik):
staff should not type a category but pick one of a few chosen in advance
(*Chicken, Gas, Raw Materials, Staff Food Cost, Miscellaneous*), and choosing
Miscellaneous should ask what the cost was. The owner renamed Miscellaneous
**Other**, the word #81's first demo and Fixed costs already use, asked that
the owners edit the list, and folded it into #81 under its own switch, since
none of #81 has reached production.

**What was measured.** Production, 1 September to 29 October 2026: about 330
expenses under about 160 names. One thing goes by many spellings (*Staff
lunch*, *staf lunch*, *Staff Food*, *Staff foo*, *Tiffin*, *Tifin*, *Tiffen*;
*Paneer*, *paner*, *poneer*, *Panerr*), and the item is typed where the
category goes (*poner + rice + vegitable*, *toto vara 26.10.26 night*). Only 3
of 48 Milk entries carry a note. The month's breakdown is a list of names, not
a breakdown.

**Why this reverses D9's withdrawal.** D9 measured buttons drawn from what had
been typed, and asked how often they would have held the next entry. A fixed
list with **Other** holds every entry by construction; the question that
decides it is whether the month's breakdown reads, and today it does not.

- **The list.** Business-wide and ordered, like the suggestions it replaces in
  the form. It starts as *Chicken, Raw Materials, Gas, Staff Food, Transport,
  Wages & bonus, Other*, inserted by the migration, and the owners change it.
  Each choice has a name, whether it **asks what it was for**, and **who picks
  it**: everyone, or managers and owners. *Other* asks; *Wages & bonus* is for
  managers and owners. *Transport* and *Wages & bonus* come from the data, not
  the message: toto fares, the van and petrol are about fifteen entries a
  month, and October's bonuses and part-time workers (₹35,000 and ₹15,800)
  would otherwise be the largest thing in *Other*.
- **The form.** Inside D9's amount-first form: **Amount**, then the choices as
  tiles, each as wide as its name, wrapping onto as many lines as they need with each line stretched to fill [owner, 2026-10-29], in the owners' order, then *Paid with* where it applies,
  then the note. A choice that asks makes the note **What was it for?**, no
  longer optional; saving without it is refused with *Say what it was for.*
  Staff and the counter do not see the managers-and-owners choices. Nothing is
  pre-chosen.
- **Editing an expense filed under a name not on the list** shows that name as
  one more tile, chosen, so changing the amount does not force re-filing;
  tapping a list tile files it there.
- **Untouched:** a fixed-cost payment (its category is its fixed cost's), and
  the syncs' rows (Hyperpure, delivery commission), whose names are reserved.
- **Salary and rent are not on the list.** Fixed costs (#79) pays them, each
  with its own row and its Pay button; a selectable *Salary* would be a second,
  unlinked road for the same money, and *Left to pay* would never hear of it.
  The maid's monthly pay, electricity and the garbage fee are fixed costs too:
  the owner adds them there, which needs no code.
- **The owner's page.** *Manage categories*, with Back to where the owner
  came from [owner, 2026-10-29], opens with **The list**: its
  choices in order, each with its tags (*Asks what it was for*, *Managers and
  owners*), **Move up** / **Move down**, and **Edit** and **Remove** in its
  menu; **Add category** above. Editing a choice's name renames that category
  everywhere, recorded expenses included, and logs it under *Category changes*
  like an ordinary rename: renaming a bucket means the same bucket under a
  better name. **Remove** takes it off the tiles; recorded expenses keep their
  name. Below the list, the typed names stay, with Rename, Merge and Retire, so
  the owner can fold September's and October's names into the list's once.
  The owner reaches the page from **Manage categories** beside Add on
  Expenses, as well as from the Ledger's month, where it was hard to find
  when needed [owner, 2026-10-29].
- **Enforced by the form, not the database.** The counter records expenses
  through the outbox, and the outbox never reads a gate: refusing a name off
  the list in the database would refuse an expense queued on a tablet running
  an older build, or saved before the gate turned. Expenses keep storing the
  name as text, as today. A hand-crafted request can still store any name,
  which is today's rule, and the owner's Merge corrects it.

**Database (live).** A new table, **`expense_category_choices`**: `id`,
`name` (normalised, unique without regard to case), `sort_order` (unique),
`asks_note`, `managers_only`, `created_by`, `created_at`, `updated_by`,
`updated_at`. Read by any active account, as `expense_categories` is, and by a
live, proven counter or kitchen tablet while the gate is on: a tablet signs in as
its own identity, which has no profile, so the first policy alone gave the counter
an empty list and its form fell back to typing (production, 2026-10-30; the
second policy is `20261106000000`). Written
only through three owner-only `security definer` commands:
`save_expense_category_choice` (add, or edit by id; an edit that renames moves
the recorded rows and logs the operation, as a rename with history does),
`move_expense_category_choice` and `remove_expense_category_choice`. Saving a
choice also mints its suggestion, so the Merge picker offers it.

**Version skew.** The table and the commands are new; no earlier build reads or
calls them. **Turning `expense-category-list` off** puts the typed field back;
an expense saved from a tile is an ordinary row with a text category, which
the typed path already reads. The list stays saved and does nothing. Round
trip `none:`: nothing it writes outside its own table, and the off path never
reads that table.

**The gate.** `expense-category-list` (*EL*) **depends on
`refreshed-staff-screens`**: its tiles live in that gate's amount-first form,
and a dependent gate does not count toward the cap (D10).

## Version skew

- **`outlets` columns** are new, with false defaults. Builds before this change
  select `*` and ignore them.
- **`set_outlet_attendance_rules`** is new. No earlier build calls it.
- **`attendance_submit_attempt_v3`** is new. v1 and v2 are untouched, and
  their pgTAP files stay valid as written
  (`supabase/tests/08_geofence.sql:54` still asserts v2's in-fence lock).
- **`auto_approved`** is a new enum value. A build before this change
  meets it only in rows written while the gate was on, and reads it:
  - **the day:** present, no approval line, the legacy shape;
  - **the history line:** printed only on a day with more than one attempt,
    as `undefined` (no fallback label in that build). That is cosmetic, and
    reaches the screen only on a Republish to a pre-change build. Accepted.
- **`fence_radius_m`** is a new nullable column, written only by v3.
- **The widened `attendance_decision_actor_required`** accepts every row it
  accepted before. No earlier build writes the new kind.
- **The change-gate rows** are inserted off.
- **Turning `auto-approve-at-the-shop` off:** the client calls v2 again, and v3
  behaves as v2 for any stale caller. Auto-approved days stay present and correctable.
  The settings stay saved and do nothing until it is on again.
- **Turning `refreshed-staff-screens` off:** today's screens, reading the same rows.

## RLS and authority

- **No new table, no new policy.** The settings live on `outlets`
  (`outlets_select` unchanged). The manager's door is
  `set_outlet_attendance_rules` (security definer, authority re-derived,
  two columns only).
- **Proved by hand-crafted requests (pgTAP):**
  - an Employee, a Biller and a counter device cannot change the settings;
  - a Franchise Admin cannot change another outlet's, and cannot change their
    own outlet's position or radius through any path;
  - the owner can change any outlet's.
- **v3** keeps v2's authority checks (`app_person_assigned_at`,
  `app_acts_as('employee', …)`, `app_device_ok`). A blocked check-in is
  refused for a hand-crafted request exactly as for the app.
- **A auto-approved day's decision is written by v3 alone.** No client role can
  insert an `auto_approved` decision: decisions have no insert policy, and
  `attendance_decision_guard` seals updates.

## Offline

A check-in is never queued. It needs the network, as today: the card's write
calls the command directly, and the outbox never sees attendance. Nothing
here changes that.

## Demo

- **The mock reads both gates** from the boot snapshot, as it reads
  `role-includes` (`src/change-gates/role-includes.ts`). With
  `auto-approve-at-the-shop` on, the mock check-in counts an in-fence reading, honours
  both settings (stored on the mock outlet) and refuses a blocked one with the
  adapter's sentence.
- **Fixtures.** With the gate on, the seeds that wait in-fence become waiting
  outside or with no position, so the queue still has work in it and the
  walkthroughs still walk:
  - `NEAR_COUNTER` five days ago;
  - Kanchrapara's arrival today, which the owner's walkthrough settles
    (`DEMO_MODE.md:243`).

  One in-fence day becomes *Auto-approved at the shop*.
- **The demo runs both gates on**, as the owner's demo runs every gate it is
  shown.
- **Browser tests** that assert one-tap approval of an in-fence row are tagged
  `@cg-off:auto-approve-at-the-shop`, the only edit allowed, and gain `@cg-on`
  twins:
  - `e2e/attendance.spec.ts:79-84, 117-209`.

  Specs anchored on *Hello, name* are tagged `@cg-off:refreshed-staff-screens` and gain
  twins anchored on the Today pass:
  - `e2e/attendance.spec.ts:67, 847-850`;
  - `e2e/demo.spec.ts:45, 115`;
  - `e2e/demo-screens.spec.ts:34`;
  - `e2e-auth/auth.spec.ts:25, 30, 450, 486`.

## Release

- **`auto-approve-at-the-shop`:** turn it on after the 04:00 cutover and before the
  first arrival. Days already waiting in the fence stay waiting and locked, and
  the person sees *Waiting* all day. There is no backfill, because changing
  existing rows is a data change (`AGENTS.md:80`).
  - **Watch:** the next morning's check-ins read *Approved*; the waiting badge
    drops to the away days.
  - **Pull once:** off, and the next check-in waits; on again.
- **`refreshed-staff-screens`:** any quiet hour.
  - **Watch:** the counter's expense list at the next service, and the staff
    phones' first check-ins.
  - **Pull once.**

## Rejected alternatives

- **`actor_id` = the person themself.** It fits every constraint with no
  exception, but makes the employee the decider of their own day, against
  "an Employee cannot approve their own day" (`ROLES_AND_PERMISSIONS.md:564`).
  An older build would print "Approved by Ravi".
- **A "system" profile.** A fake person in `profiles`: in staff pickers, RLS
  probes and every `approved_by_name`, forever.
- **Stamping `approved_by` on the day row.** It needs a new or widened
  `attendance_approval_complete`, makes an older build draw an approver line, and
  is the shape `attendance_evaluate_geofence` would treat as approved. The
  decision row already says what happened.
- **Distance plus accuracy, or an accuracy cap.** Owner decision 2. The cap
  would have refused a real reading (25 Oct, 31 m at ±104 m). Either rule,
  unless mirrored in the retry lock, deadlocks a person whose reading is inside
  but rough.
- **Replacing `attendance_submit_attempt_v2` or the geofence trigger in place.**
  Forbidden (`AGENTS.md:80`). Every published build calls or fires them.
- **Settling in the arrival update.** Silently undone on first attempts (D3).
- **A realtime subscription on the person's attendance row.** The in-fence
  answer arrives with the check-in. Only away days wait, and those still refresh
  on returning to the foreground. A new publication and per-row RLS for a rare
  state is the wrong trade after incident #74.
- **Keeping refused check-ins as evidence.** It would show a manager who tried
  from home, but it is a new table and a new screen, for a habit the owner
  wants broken by refusal, not by surveillance. Revisit if a manager asks.
- **One gate for everything.** See D10.
- **A Bengali/Hindi switch in this change.** Dropped by the owner. If it
  returns, the review's notes stand:
  - `bn-IN` defaults to Bengali digits, so use `-u-nu-latn`;
  - fonts are Latin-only by rule, with system fallback;
  - sentences rather than string fragments, because verbs inflect;
  - `PhoneShell` is shared by every phone role.
- **Dropping the Cash chip for staff.** Owner decision 9.
- **A receipt photo.** Owner decision 9: a bigger feature, not needed yet.
- **Refusing names off the list in the database** (D11): it would refuse
  queued counter expenses from older builds.
- **Salary and rent as choices** (D11): Fixed costs already pays them.
- **Tagging each choice as cost of food or running cost.** Nobody has asked
  for a food-cost figure; a column can be added when one is.
- **Today never reads Absent.** That would change `readDay`, which the roll-call
  and pay counts share. Home's wording carries the "you can still check in"
  instead (D7, D8).

## The owner's demo round

**Approved, 2026-10-29.** The owner walked the demo on a phone and a laptop
from 2026-10-26 to 2026-10-29, as Staff, Biller, Admin and Owner, using the
demo's place switch to try every location state, and approved every screen:
*"I approve the ui ux. We can now continue and build this end to end."*

The changes asked for along the way are recorded where they landed, each
marked *As built* or dated in D7, D8, D9 and D2:

- **Home (D7).** The popup is centred and opens only for a decision; the
  buttons spin instead of a "Finding your location" screen; no advice on where
  to stand; the checked-in tile sits where the button was, with a drawn tick; a
  second check-in is offered only where it can change the answer, and a recheck
  still away says so in red words, briefly, in place of the link; no
  confirmation for a recorded retry, late included; a refusal under *Block*
  reads **Check-in denied** with one **OK**.
- **The month (D8).** The production tally on Home; counts inside their marks;
  long dashes for waiting; the late tag's clock, filled yellow, for a late day,
  on a waiting day too; no ring on today, the date under the heading instead;
  no Back on My attendance.
- **Expenses (D9).** Day headings and the You tag approved; category buttons
  built, measured against 28 days of production entries, and withdrawn for the
  typed field.
- **The outlet page (D2).** The Attendance section first after Details.
- **The demo.** A place switch (device, at the shop, away, location off, no
  signal) for Staff and Admin, to be merged with #80's waiter switch when both
  have landed.
