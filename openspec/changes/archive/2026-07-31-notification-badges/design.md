# Design: notification-badges

## Context

`attendance-approved-on-site` (#26) made an arrival count for nothing until a
manager approves it, and surfaced the resulting backlog two ways: a per-day
count on the attendance day view, and an owner-only banner headed "Days waiting
for a manager" listing each outlet with its count and its oldest waiting date.

Both are prose, and both live on the attendance page. The owner's objection
(2026-07-31) was that the banner reads as a database state rather than as an
ask, and the deeper problem is placement: the only person who sees it is the one
already standing on the screen that needed reading.

The constraints that shape this are all pre-existing. Colour is never the only
signal (`design-system`). Hex literals are confined to the brand layer and every
colour pair is checked for AA in both themes by `npm run contrast`. Navigation
is derived from the gate registry, never hand-maintained per shell (`app-shell`).
And the app is a PWA that spends its day on a phone in an apron, which rules out
anything that costs battery for a number nobody is looking at.

One convenient fact makes most of this cheap: `countWaitingByOutlet` carries no
owner gate. It is a plain filtered select scoped by RLS, so a Franchise Admin
calling it already gets exactly their own outlets and the owner gets all of
them. The tenancy requirement for badges is satisfied by the policies that are
already there and already tested.

## Goals / Non-Goals

**Goals:**

- One badge idea, applied consistently, that means "somebody is waiting on you".
- Reachable from anywhere in the app, not only from the surface it concerns.
- Per-outlet truthfulness: a badge never implies work the reader cannot open,
  and one outlet's backlog never marks another outlet's controls.
- No new colour pair, no new query, no new RLS policy.

**Non-Goals:**

- Push notifications, live counts, a notification centre, or badging any surface
  other than attendance. All stated in the proposal and all deliberately out.
- Making the badge dismissible. It clears by doing the work.

## Decisions

### D1 — The badge is `--primary` / `--on-primary`, the Approve button's own pair

Chosen by the owner (2026-07-31) over the conventional notification red.

Three things recommend it beyond taste. The badge ends up the same colour as the
button that clears it, so the thing demanding attention and the remedy read as
one concern. `--danger` stays reserved for things that are actually wrong, and
an unapproved arrival is work, not a fault. And the pair is **already asserted
by the contrast validator**, so this change adds no token and no new pair to
verify.

**Rejected: `--danger` red**, the Facebook/Instagram convention. It would have
needed a new `--on-danger` token and a new registered contrast pair, and it
would have spent the system's one alarm colour on a routine task.

**Rejected: `--warning` amber**, which is what the banner uses today. Closer in
meaning, but it is the colour of the waiting *row*, and a badge repeating it
would blend into the thing it is pointing at.

### D2 — The registry declares a count source; the shell stays ignorant

A gate registry entry may name a source. The shell renders whatever number comes
back and knows nothing about approvals.

This is the same move the registry already makes for `nav.label` and `nav.icon`:
badging a further surface is a registry edit, not a shell edit, which is what
makes the mechanism reusable rather than an attendance feature with a general
name.

**Rejected: the attendance feature reaching up into the shell.** It would work
for exactly one surface and would put a feature import in the shell, inverting
the dependency the registry exists to keep straight.

**Rejected: a generic "notifications" store** that every surface pushes into.
More machinery than one source justifies, and it invites the notification centre
this change is explicitly not building.

### D3 — Arrow marks come from `oldest` and a new `newest`, not a new query

`WaitingCount` already carries `oldest` per outlet. Adding `newest` from the
same already-sorted query gives both day controls exactly:

- earlier-days control marked when `oldest < the day on screen`
- later-days control marked when `newest > the day on screen`

Both read the entry for the outlet in scope only, which is what makes "another
outlet's backlog must not mark these arrows" true by construction rather than by
a filter somebody has to remember.

This also gives the removed oldest-date text a second life: it stops being
printed and becomes the signal behind a mark.

**Rejected: a `listWaitingDates(outletId)` read** returning every unsettled
date. It is the obvious shape and it is more than the question needs. Two
extremes answer "is there anything before or after this day", and they are
already one `order by business_date` away.

**Rejected: deriving the marks from rows already loaded.** The day view only
ever holds one day's rows, so it cannot know about any other day.

### D4 — Fresh on mount and on foreground, never polled

A count is read when the shell or surface mounts and again on
`visibilitychange` back to visible.

Polling was rejected on battery: the phone this runs on is in an apron all day,
and a timer that wakes the radio for a number nobody is looking at is a cost
paid continuously for a benefit taken occasionally. A realtime subscription was
rejected for the same reason plus a held connection.

The honest consequence is that a badge can lag work that arrives while a screen
sits open. Foreground refresh covers the case that actually matters, which is
picking the phone up. **This is a limitation to document, not to hide**, and it
is the strongest argument for the push notification already sitting in
`openspec/todos/pending-approval-notification.md`.

### D5 — Zero renders nothing

No zero badge, no empty circle, no greyed-out marker. The absence of a badge is
therefore load-bearing and always means the same thing.

**Rejected: a muted zero state**, which turns "nothing to do" into a thing to
read on every screen, forever.

### D6 — The number is the signal; colour is decoration

Every badge carries an accessible name describing what is waiting. A bare dot,
used where a number would not help, carries one too.

This is not a new rule, it is `design-system`'s existing "colour is never the
only signal" applied to a component whose entire job is to be noticed. A badge
that only works for people who can see and distinguish the accent colour would
be the clearest possible violation of it.

## RLS, money, offline

**RLS**: no new policy and no new query shape. `countWaitingByOutlet` is already
a filtered select scoped by the attendance policies, and adding `newest` changes
the projection, not the predicate. The tenancy scenario in the spec is a
regression test on that existing scoping rather than a new boundary. **No badge
count may be computed anywhere but through the adapter**, so nothing can quietly
count rows the reader could not read.

**Money**: untouched. This change reads no monetary column.

**Offline**: a badge is a read. With no network the count simply does not
refresh, and the last known value stays on screen; nothing is queued and nothing
is retried. This matters because #9 will put this app on a counter tablet that
is deliberately allowed to run offline, and a badge must never imply that a
stale count is current. The foreground refresh silently failing is the correct
behaviour: it is better to show yesterday's number than to blank the badge and
imply the work is done.

## Risks / Trade-offs

**A stale badge reads as a broken badge.** → Foreground refresh covers the
common case. Documented in `docs/LIMITATIONS.md` so it is a known bound rather
than a bug report.

**A badge on the nav is a permanent nag once a backlog exists.** → That is the
intent, and it is bounded by the work being finite and by there being exactly
one source. If a second source is ever wired in without the same discipline, the
nav becomes wallpaper and the mechanism stops working. Noted here as the thing
to protect.

**The counts are read once per shell mount for every role.** → One small query,
already indexed by the policy path, and capped in the adapter. If it ever shows
up in latency it should be cached per session rather than removed.

**The mechanism could grow into a notification framework.** → The spec confines
a badge to "work waiting for you", and D2 keeps the shell ignorant. Anything
richer should be a new change with its own argument.

## Migration Plan

Frontend only. No migration, no schema change, no production database step.
`newest` is an additional field on a value object, so the mock and the Supabase
adapter change together and the compiler finds every reader.

Ordering: this change **must not archive before #26**, whose
`attendance-and-location` requirements it modifies. Landing the code first is
harmless; archiving out of order would write a delta against a spec that does
not yet contain the requirement being modified.

## Open Questions

None blocking. Two settled by the owner on 2026-07-31 and recorded above: the
badge colour (D1) and that the arrow marks are scoped to the outlet in scope
(D3).
