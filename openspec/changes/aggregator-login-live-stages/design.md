# Design: Aggregator Login Live Stages

## Context

A full-login reconnect (Zomato or Swiggy) dispatches `login.yml` in
`abdatta/shawarmania-sync`, which boots a runner, installs a browser (~45 s),
walks the partner portal, waits up to five minutes for the owner's code and
saves the session. Measured on the last real one (22 Sep): dispatch → code box
≈ 75 s, code → saved ≈ 1–2 min including the Hyperpure hop.

The owner's surface learns about it through one thing: the open row in
`aggregator_auth_requests`, exposed by `aggregator_credential_health` as
`awaiting_code_since`, polled every five seconds while a repair card is up.

## What the August draft got wrong

Re-checked against the code on 2026-11-03:

1. **"The request row is owner-only, so Realtime honours it."** The request
   table has *no* client grant and *no* policy, on purpose — "two independent
   refusals for the same thing" (`20260817000002`). Nobody can select it, so
   nobody can subscribe to it, and granting a select to make Realtime work would
   put the row with the code column in reach of a client. Realtime
   `postgres_changes` checks the row against RLS and then sends the record; it
   is not a column filter. The draft's transport is impossible without weakening
   the property it says it must keep.
2. **"Stamp the stage on the open request."** The request opens only when the
   code screen renders — the #44 timing fix. Stages 1–3 happen before any
   request exists, so there is nothing to stamp them on.
3. **Swiggy.** Swiggy joined the same `login.yml`, mailbox and Reconnect card
   (#47). The draft talked about "the Hyperpure line expanding"; the stepper has
   to work for both channels, and Swiggy has no Hyperpure stage.

Also found: the Zomato runner's code-field locator includes
`input[type="number"]`, which is exactly Zomato's phone field — so its
"the code screen rendered" wait can be satisfied by the screen before it.

## Decisions

### D1. The stage lives on the channel's credentials row

`aggregator_channel_credentials.login_stage` (text, closed check) and
`login_stage_at` (timestamptz), both nullable.

- One row per channel, already the "this channel's sign-in" record, already
  without any client grant. One sign-in per channel at a time is already
  enforced by `login.yml`'s concurrency group, so one stage per channel is
  the true shape.
- Read through `aggregator_credential_health_v2`, owner-only and
  `security definer`, returning v1's columns plus the two. The published build
  keeps calling v1 (migrations only add).
- The inline `check` on a new nullable column cannot refuse any write a
  published build makes: no published build writes it.

*Rejected: on the auth request (the draft).* See above, point 2.
*Rejected: a new `aggregator_login_attempts` table.* A row per attempt would
give a trace nothing asks for and need its own grants, sweep and tests; the
stepper needs the current position only.

### D2. The server records every stage it can see

`starting` at dispatch, `waiting_for_code` when the mailbox opens,
`checking_code` when the runner collects the code, `waiting_for_code` again on
a rejected code that has attempts left, `stopped` when a request expires, is
abandoned or runs out of attempts, `bringing_hyperpure` (Zomato) or `done`
(Swiggy) on `finish_login signed_in`.

So the stepper is truthful with the runner as it is today. The runner adds only
what the server cannot see: `opening_portal`, `signing_in`, Zomato's `done`
after the Hyperpure hop, and `stopped` on a failure that never reached the
mailbox.

**Stage writes are best effort on the server too.** A failed stage write is
logged and never fails the action it rides on — a sign-in is worth more than
its narration.

### D3. Transport is the poll that already runs

The surface already re-reads health every 5 s while a repair card is up
(`watchForLogin`). That read now carries the stage. Five seconds satisfies
"within seconds"; nothing new subscribes, nothing new connects, and the request
count is unchanged. It also keeps working through a dropped connection exactly
as today — there is no second path to disagree with the first.

*Rejected: Realtime.* D1/what-went-wrong point 1. Also: one more socket on the
owner's phone for a four-minute monthly event.
*Rejected: Broadcast from the Edge Function.* Bypasses RLS entirely; the server
would be choosing who hears it, by hand.

### D4. `report_stage` takes only the runner's words, only during a sign-in

`aggregator-reader` `report_stage` accepts `opening_portal`, `signing_in`,
`done` and `stopped`; any other word — including server-only ones like
`waiting_for_code` — is refused `unknown_stage` and not stored. It is refused
`no_sign_in` unless the channel's current stage is a live, non-terminal one
from the last 30 minutes, so a late or replayed report cannot wake a finished
sign-in. `done` is accepted from Zomato only (Swiggy's comes from
`finish_login`). Nothing but the word crosses the boundary.

### D5. Quiet: every stage has a ceiling

| Stage | Ceiling | Why |
|---|---|---|
| `starting` | 4 min | queue + install measured ~50 s; GitHub queues can take minutes |
| `opening_portal` | 2 min | ~20 s measured |
| `signing_in` | 2 min | ~10 s measured |
| `waiting_for_code` | 6 min | the mailbox lives 5 min; the runner gives up at 5 |
| `checking_code` | 2 min | the post-login wait is 60 s |
| `bringing_hyperpure` | 3 min | the picker hop takes ~1 min |

Past its ceiling a stage is **quiet**: the stepper stops ticking it live, says
"This sign-in has gone quiet" and offers Reconnect. 30 minutes after its last
stage a sign-in is history and the surface reverts to its ordinary cards — and
sooner for one that stopped or went quiet if a read has run since: that read's
own outcome is the newer word on the session. A live sign-in is never hidden
that way, because a scheduled read can run alongside it. The
ceiling is measured on the server's `login_stage_at` against the phone's clock;
minutes of margin absorb any skew.

### D6. Going backwards is shown, not hidden

A refused code moves `checking_code` back to `waiting_for_code`. The stepper
shows "Checking your code" un-ticked again and, inside "Waiting for your code",
"That code was not accepted — try the new one", from the attempts count already
in the health read. Never a silent untick.

### D7. A `done` newer than the last failed read means signed back in

Today the lapsed card stays up after a successful sign-in until a scheduled
read runs. While the latest stage is `done` and newer than the channel's last
run, the channel is not shown as lapsed; the stepper collapses to one line —
"Signed back in" — until the next read replaces it. Hyperpure's own line and
the half-failure note are unchanged: they already judge Hyperpure from its own
runs.

**And the surface starts that read.** Left alone, the health line would keep
saying `Stuck` beside "Signed back in" for hours. Once per finished sign-in
(keyed on its `done` time, so a re-render or remount cannot ask twice), the
open page asks for an ordinary read of the outlet on screen — the same request
**Read now** makes. A refused ask changes nothing. If the page is closed the
next scheduled read does the same job later.

### D10. The watch keeps the running-read pace while a sign-in is live

The 5 s watch drops to `RUNNING_SYNC_CHECK_MS` (3 s) while a stage is live —
the pace this surface already keeps while a read runs — so a stage is on screen
within three seconds of being recorded, and the demo's three-second stages are
never skipped. A one-second clock tick moves the countdown and the quiet
judgement without any request.

### D11. A live sign-in holds its page, not the app

Owner review on 2026-11-04 asked for a focused, popup-like account of the
sign-in that the page cannot be used around, while leaving every other page
reachable — the sign-in runs on GitHub whether the app is open or not.

While a stage is live, the stage list sits over the channel's page (sticky, so
it stays in view) and the page beneath it is `inert` and dimmed. The app's own
navigation sits outside the page and stays usable. Nothing about the hold lives
in component state: it is read from the recorded stage, so a reload, a second
phone or a return from Team finds it held at the stage the runner has reached.
A sign-in this page watched to the end keeps every step ticked until **Done**,
even after the read it starts overtakes it; one that ended unwatched is the
one-line Signed back in. Quiet and stopped do not hold the page — nothing is
under way, and the owner may want the page itself (Upload a statement) before
deciding to reconnect.

**The hold can never outlive the run.** Three layers lift it: a run that ends
well records `done` (Swiggy's through `finish_login`, Zomato's after the
Hyperpure hop); a run that fails or is cancelled by hand on GitHub records
`stopped` from `login.yml`'s failure-or-cancel step, and the page is free on
the next three-second read; and a run that says nothing at all — never
started, runner lost, door unreachable — goes quiet at its stage's ceiling (at
most six minutes), which does not hold the page either.

*Rejected: a modal `<dialog>`.* The top layer makes the whole document inert,
navigation included, and a dismissable modal is transient: its open-ness would
be component state a reload forgets.
*Rejected: a popup that reopens itself but can be dismissed.* Offered first;
the owner chose a page that cannot be used around the sign-in.

### D12. No "resend code"

The runner deliberately never resends: one run is one code, so the mailbox's
three-attempt cap cannot be bypassed (`swiggy-auth.mjs`), and neither portal's
resend control has been captured, so its selector and the moment it enables
are unknown. A wired button would be a guess until a live run records that
screen. An expired code stops the sign-in, and **Reconnect** on the stopped
card is the resend: a fresh run with a fresh code. Revisit only after the live
walk (task 8.4) has captured the code screen's structure.

### D8. The code field cannot be stranded

The field lives inside "Waiting for your code". If a code is awaited and no
live stepper is showing (an old row, a stage write that failed), today's
separate code card renders as before.

### D9. Fix the Zomato code-field locator

The wait for the code screen now looks for the code inputs and **also**
requires the phone field to have gone, so the identifier screen can never
satisfy it.

## Risks

- **The runner and the app now share a word list across repos.** Mitigated by
  validation at the door (D4) and by the server owning every stage it can.
- **A stuck `starting`** if dispatch succeeded but the runner never ran: covered
  by its ceiling (D5).

## Rejected alternatives (kept so they are not re-proposed)

- Keeping run history and the freshness stamp in this change — split out
  2026-08-29: different tables and transports, and the history cut into a
  money-writing function, so one gate could carry a money regression past a
  stepper checkpoint.
- A change gate. The owner-only screen and an additive migration pass both
  clean-revert tests (proposal, *Change gate*), and D8 means a broken stepper
  still lets a code through.
