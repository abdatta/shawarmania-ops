# Proposal: Aggregator Login Live Stages

> **Model**: Opus · **Wave**: D · **Depends on**: #47 · **Gate**: when the owner
> taps Reconnect and the full-login rung fires — for Zomato or for Swiggy — the
> card they tapped becomes a list of named stages: starting, opening the partner
> portal, signing in as you, waiting for your code (the code field appearing
> there and nowhere earlier), checking your code, bringing Hyperpure along
> (Zomato only), done — each arriving within seconds of the runner reaching it
> and without a refresh; a sign-in that stops or dies says so rather than
> freezing on a stage; nothing beyond the stage word reaches a client; and the
> four-role demo walkthrough still walks.

> **Re-derived 2026-11-03.** The August draft of this proposal was written
> against the code of 29 August. Re-checked against today's code it had three
> premises that no longer (or never) held, so this is a rewrite, not an edit.
> What changed and why is in `design.md` under *What the August draft got
> wrong*. The run history and the freshness stamp that were briefly folded in
> stay split out (#48, archived; a quickfix).

## Why

Zomato's partner login has a hard life of about a month that the daily renewal
cannot extend (measured: 25 Aug → ~22 Sep, 22 Sep → 22 Oct). Swiggy's lapses on
its own schedule (24 Oct). So a full sign-in is not a once-ever event — it is a
monthly chore, done on the owner's phone, and right now it is a silent one.

What the owner sees today after tapping Reconnect:

- The card they tapped stays exactly as it was, button and all, for about a
  minute and a half while a runner boots, installs a browser and walks the
  portal. Nothing says anything is happening, and the one thing that makes it
  worse — tapping again — is the only thing on the screen.
- Then a separate code card appears beside it, with no account of where the
  sign-in is or why a code is now wanted.
- After the code, nothing again until a read hours later clears the card.

In demo mode the code card appears 1.2 seconds after the tap, which is where the
"it asks for the code before Zomato does" impression comes from. In production
the mailbox opens at the right moment in the normal case (22 Sep: eight seconds
after Send, with Zomato's six code boxes on screen) — but the runner's "has the
code screen rendered?" check matches Zomato's **phone** field too
(`input[type="number"]`), so on a Send that fails it would open the mailbox
anyway and ask the owner for a code that is never coming. Fixed here.

## Scope

**The stage is recorded on the channel's credentials row.**
`aggregator_channel_credentials` gains `login_stage` (a closed vocabulary) and
`login_stage_at`. One row per channel, already holding "is there a session",
already unreadable to every client. A new owner-only `security definer` read,
`aggregator_credential_health_v2`, returns everything v1 does plus the stage and
its time. v1 stays for the published build.

**Most stages are recorded by the server, from calls already made.** The runner
does not have to be updated for the stepper to mean something:

| Stage | Shown as | Recorded by |
|---|---|---|
| `starting` | Starting the sign-in | `request-aggregator-sync`, the moment the full-login rung is dispatched |
| `opening_portal` | Opening the {Zomato/Swiggy} partner portal | runner, `report_stage`, as its browser starts |
| `signing_in` | Signing in as you | runner, `report_stage`, as it enters the stored identifier |
| `waiting_for_code` | Waiting for your code — **the code field renders here** | `aggregator-reader` `open_code_request`; again on `reject_code` retry |
| `checking_code` | Checking your code | `aggregator-reader` `await_code`, when the runner collects it |
| `bringing_hyperpure` | Bringing Hyperpure along (Zomato only) | `aggregator-reader` `finish_login signed_in`, Zomato |
| `done` | Signed back in | `finish_login signed_in` for Swiggy; runner `report_stage` after the Hyperpure capture for Zomato |
| `stopped` | The sign-in stopped | `finish_login expired/abandoned`, `reject_code` exhausted, or runner/workflow on any failure |

**Following it is the poll that already runs.** The surface already re-reads
health every five seconds while a repair card is up. That read now carries the
stage, so stages arrive within five seconds with no new transport.

**The card the owner tapped becomes the stepper.** In *Needs you*, the reconnect
card is replaced by the stage list while a sign-in is under way — past stages
ticked, the current one live, the code field inside "Waiting for your code"
with its countdown and the attempt it is on. There is no Reconnect button on it
to tap twice.

**A sign-in that goes quiet says so.** Each stage has a ceiling longer than it
can legitimately take; past it the stepper stops claiming the stage, says the
sign-in has gone quiet, and offers Reconnect again. A `stopped` sign-in says it
stopped and offers the same.

**A finished sign-in does not ask to be redone.** Today the "signed out" card
stays up after a successful sign-in until the next scheduled read, hours later.
A `done` newer than the last failed read now counts as signed back in.

**Runner (`abdatta/shawarmania-sync`):** report `opening_portal`,
`signing_in` and Zomato's `done`; report `stopped` from a workflow step on any
failed or cancelled login; and fix the code-screen check so it can no longer be
satisfied by the phone field.

## Change gate

No gate: a clean revert, away from the counter.

- **The revert is clean.** The migration only adds two nullable columns no
  published build selects, and a new read function the published build does not
  call; v1 is untouched. `request-aggregator-sync` and `aggregator-reader` gain
  writes to those new columns and one new reader action; every response the
  published app or runner reads is unchanged, so the old build works against
  the new functions and, after a Republish, the new functions are harmless to
  it. The runner's reports are best-effort and a refused `report_stage` is
  ignored.
- **It cannot reach the counter or kitchen.** The only screen that changes is
  the owner's Delivery sync page. No table the counter or kitchen reads changes,
  no shared component, and the extra load is one owner phone re-reading health
  every five seconds for the four minutes a sign-in takes, once a month — which
  it already does today.

The code field keeps a fallback: if a code is awaited and no live stepper is on
screen to hold the field, today's code card renders as before, so a stepper bug
can never strand a sign-in.

## Non-goals

- **Realtime.** The credentials and mailbox tables have no client grant by
  design; subscribing would need one. See `design.md`.
- **The capture-only rung** (Hyperpure under a warm Zomato) gets no stepper. It
  opens no mailbox and takes under a minute.
- **A warning before the monthly lapse.** Worth doing; its own change.
- **Recording the Hyperpure capture outcome from the login** (`login.yml` does
  not pass `HYPERPURE_OPS_OUTLET_ID`). Pre-existing, separate.
- No change to the repair ladder, the probe, the dispatch routing, or the
  mailbox's lifetime and attempt cap.

## Docs to update before archiving

`docs/SCREENS.md` (the stepper, replacing the separate code card) and
`docs/OPERATIONS.md` (what a sign-in looks like, what quiet and stopped mean,
and that Zomato wants one about monthly).
