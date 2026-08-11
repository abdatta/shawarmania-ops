# Proposal: updates-wait-for-a-safe-moment

> **Model**: Opus · **Kind**: production bug fix and the affordance that completes it, not a roadmap change · **Gate**: **a deployed build never reloads a running page on its own**; an app left open discovers a new build within fifteen minutes or on its next return to the foreground, without being relaunched; a page holding typed work, a bill being composed, a write in flight, or no network offers an **Update** action instead of reloading, and takes the update itself once every one of those clears; Install still wins the one header slot when both apply; and a detected update reloads at most once.

## Why

The app reloads itself without asking. `src/pwa/register-sw.ts` passes `false` to
`updateServiceWorker` intending "activate the new build but leave this page
alone", and that argument has been ignored since the founding commit: in
vite-plugin-pwa 1.3.0 the parameter is named `_reloadPage` and never read, while
the reload fires from a `controlling` listener the plugin arms before our
callback runs. Skipping waiting is therefore what *triggers* the reload we
believed we were preventing. This already contradicts the shipped requirement
that a new build "SHALL never force a reload mid-use".

It survives in production only by timing. The one update check runs at launch
(`onRegisteredSW`), so the reload lands seconds after the app opens, usually
before anyone has typed. Nothing guarantees that: on a slow connection the
install completes long after a biller has started ringing.

The same single check is the second half of the problem. An app already open
never asks again, so a fix deployed at midday does not reach a counter tablet
until somebody relaunches it, which on a shift device may be the next morning.

## What Changes

- Take ownership of the reload by supplying `onNeedReload`, the plugin's
  documented control hook, so an activated build is recorded rather than
  applied. The new worker still skips waiting, so the existing
  "runs the new build on the next load" guarantee is untouched.
- Check for a new build on launch, on every return to the foreground, and every
  fifteen minutes while the app stays open. No cooldown suppresses a check, so
  closing and reopening the app is always a reliable way to force one.
- Apply a recorded update automatically, but only from a state where a reload
  costs nothing: online, no bill being composed, no meaningful typing on screen,
  and no write in flight. Re-check after a short settle so a reload cannot land
  in the gap between two orders.
- Offer an **Update** action in the existing header slot whenever an update is
  recorded and that state is not yet reached, and apply the update the moment it
  is, without a second tap. Install takes the slot when both apply.
- Measure typed work generically, by listening for input events at the document
  root, so every existing form and every future one is covered without
  registering anything. Three or more fields typed into, or one field carrying a
  substantial amount of text, counts as work worth protecting.
- Count in-flight writes once, at the adapter seam every write already passes
  through, rather than per surface.
- Let a surface holding unsaved work that is not in form controls declare it.
  The bill composer is the only such caller: an order lives in React state and
  renders no input element, so no generic measure can see it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pwa-and-deployment`: replace the update requirement so that discovery is
  continuous rather than launch-only, application is conditional on a safe
  page state rather than immediate, the running page is genuinely never reloaded
  without consent, and the header's app action covers update as well as install.

## Impact

- Service-worker registration and update state under `src/pwa/`.
- The header app action under `src/components/` and its slot in `src/routes/`,
  `src/auth/` and `src/shell/`.
- A generic unsaved-work signal read by the update decision, plus one declaration
  from `src/features/billing/billing-counter.tsx`.
- An in-flight write counter at the `src/data-access/` adapter seam.
- Vitest coverage for the decision rules and Playwright coverage for update
  discovery and deferral. `e2e/offline.spec.ts` waits on worker lifecycle and is
  re-checked against the new reload timing.
- No database, migration, policy, tenancy, money, manifest or precache change.

## Non-goals

- Changing the manifest, precache globs, deployment pipeline or hosting.
- Making the counter outbox durable. That is `billing-live`'s work, and this
  change deliberately does not gate on outbox contents: the live billing adapter
  is entirely `notLive` today, and the queue that replaces it is already
  specified to survive a reload.
- Guaranteeing an update is ever applied to a device that stays busy. A counter
  that never reaches a safe state keeps the action visible and takes the build on
  its next launch, exactly as it does today.
- Reporting version adoption, forcing a build onto a device remotely, or
  blocking use of an old build.
- Redesigning the header, or changing installation behaviour beyond yielding the
  slot.

## Docs to update before archiving

- `docs/OPERATIONS.md` — how a deployed build now reaches a device, the fifteen
  minute and foreground checks, and that closing the app forces a check.
- `docs/SCREENS.md` — the Update action, its slot, and its precedence under
  Install.
- `docs/TESTING.md` — update-adoption coverage alongside the existing PWA and
  offline checks.
- `docs/LIMITATIONS.md` — a continuously busy counter defers an update until its
  next launch, and online detection is the browser's own signal.
