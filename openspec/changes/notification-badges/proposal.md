# Notification badges

## Why

Since `attendance-approved-on-site` (#26) an arrival counts for nothing until a
manager approves it, so a forgotten approval is a real cost to somebody's
record. What surfaces that today is a **paragraph**: a banner headed "Days
waiting for a manager", listing each outlet, its count and its oldest waiting
date, on the attendance page only.

Two problems with a paragraph. It is only read by somebody already standing on
the screen that needed reading, which is the one person who did not need
telling. And "days waiting for a manager" describes a database state rather
than an ask; the owner's reaction to it was that it is weird and unintuitive
(2026-07-31), which is fair, because nothing in the sentence says *do something*.

Every app that has solved this solved it the same way: a small count, attached
to the thing it is about, visible from wherever you happen to be. That is what
this change builds, and it builds it as a mechanism rather than as one banner,
because `alerts` and low stock are sitting in the same registry waiting for it.

## What Changes

- **A badge component** and one shared rule for what a badge means: a number of
  things somebody else is waiting on you for. A dot with no number where the
  count is unknown or irrelevant; a number where it is known.
- **The navigation carries badges.** A gate registry entry may declare a count
  source, and the shell renders the count on that nav item, in both the phone
  and counter shells. Attendance is the only source in this change.
- **The attendance day view gains three badges**, all scoped to the outlet in
  scope: a count on the day being viewed, and a dot on the previous-day and
  next-day arrows when *that outlet* has unapproved arrivals on earlier or later
  days. Another outlet's backlog never lights up these arrows.
- **The owner's cross-outlet banner becomes outlet chips**, each carrying its
  own count, the one in scope marked, the others switching to that outlet when
  chosen. The prose heading goes.
- **BREAKING (surface only, no data)**: the "Days waiting for a manager" heading
  and the per-outlet **oldest waiting date text are removed**. The date is not
  lost, it changes job: it becomes the signal behind the previous-day dot.
- `WaitingCount` gains `newest` alongside its existing `oldest`, from the same
  query, which is what lets the next-day arrow know there is work ahead of the
  day on screen.
- **Counts refresh when the app returns to the foreground**, and on navigation.
  They are not polled.

## Non-goals

- **Push notifications.** A badge is visible only to somebody holding the app.
  Reaching a manager who is not looking is a different feature with permissions,
  a service worker and a delivery guarantee in it; it stays in
  [`openspec/todos/pending-approval-notification.md`](../../todos/pending-approval-notification.md).
- **Live counts.** No polling, no realtime subscription. A count is correct when
  a screen mounts and when the app is brought back to the foreground, and
  otherwise may be a few minutes stale. Polling costs battery on a phone that
  spends its day in somebody's apron.
- **Badging anything but attendance.** The mechanism is general; wiring `alerts`,
  low stock or reconciliation exceptions into it is left for whichever change
  makes those live.
- **A notification centre or history.** A badge says how many, not what, and
  clears by doing the work rather than by being dismissed.
- **Marking a day as leave**, which the day view still cannot do. Tracked
  separately; it is not what a badge fixes.

## Capabilities

### New Capabilities

- `attention-badges`: what a badge means and where one may appear; how a surface
  declares a count; the freshness contract; and the rule that the number, not
  the colour, carries the meaning.

### Modified Capabilities

- `app-shell`: navigation derives from the gate registry, which may now declare
  a badge source; the shell renders it on the nav item in both shells.
- `attendance-and-location`: the owner's cross-outlet waiting count is stated as
  outlet chips with counts rather than as a prose banner with dates, and the day
  view states its own day's count and whether the same outlet has unapproved
  arrivals on other days.

## Impact

**Code**

- `src/components/ui/` — a new badge component, the first addition to the base
  library since the change that established it.
- `src/gates/registry.ts` and `src/shell/phone-shell.tsx`,
  `src/shell/counter-shell.tsx` — a declared badge source, and rendering it.
- `src/features/attendance/outlet-attendance.tsx` — `StrandedDays` becomes
  chips; the day picker gains its count and its two dots.
- `src/data-access/adapters.ts` and both attendance adapters — `newest` on
  `WaitingCount`.

**Colour and contrast**

The badge uses `--primary` / `--on-primary`, the Approve button's own pair
(owner, 2026-07-31), so the badge matches the action that clears it. That pair
is **already asserted by the contrast validator**, so this change adds no token
and no new pair.

**Accessibility**

Every badge carries a real accessible name, so a screen reader hears "3 arrivals
waiting for approval" rather than "3". This is the existing
`design-system` requirement that colour is never the only signal, applied to a
component whose whole job is to be noticed.

**Dependency**

Depends on `attendance-approved-on-site` (#26), whose banner and
`countWaitingByOutlet` this change rewrites. #26 must archive first, or this
change's `attendance-and-location` delta would be written against a spec that
does not yet contain the requirement it modifies.

**Docs to update before archiving**

- `docs/SCREENS.md` — the attendance day view's badges and outlet chips; the
  banner's removal.
- `docs/DESIGN_SYSTEM.md` — the badge component, its colour pair, and the rule
  that a badge always states a number or a labelled dot.
- `docs/ARCHITECTURE.md` — the gate registry gaining a badge source.
- `docs/OPERATIONS.md` — the "days are piling up unapproved" entry, which
  currently describes the banner being removed.
- `docs/LIMITATIONS.md` — a badge is not a notification, and a count can be
  stale until the app is reopened.
- `docs/GLOSSARY.md` — badge, as distinct from an alert.
