# Proposal: pwa-install-affordance

> **Model**: GPT-5.6 Sol · **Wave**: B · **Depends on**: #1, #3, #4 · **Gate**: an install-eligible browser shows one app-owned action in public and real shell chrome; the action opens the native prompt at most once, iOS Safari explains its manual path, installed and ineligible contexts show no action, demo mode does not promote installation, and the captured capability survives navigation from public pages into a real role shell; phone and counter-tablet layouts remain usable in light, dark, and reduced-motion modes.

## Why

Shawarmania Ops already satisfies the technical PWA installation contract, but
the app gives staff no discoverable way to install it. Counter tablets and
personal phones should expose installation in the app's own persistent chrome
when the current browser can actually complete it.

## What Changes

- Add a capability-aware **Install** action to the public header and real
  phone and counter shell headers.
- Offer the browser's native installation prompt only after it reports that
  the PWA is installable, and consume that prompt at most once.
- Provide the manual Safari path on an uninstalled iPhone or iPad, while
  hiding the action in installed, unsupported, ineligible, and demo contexts.
- Keep installation capability above the router so sign-in and role-shell
  navigation cannot discard a deferred prompt.
- Give the compact action a one-time label reveal, accessible naming and
  reduced-motion behavior using the existing semantic design tokens.
- Cover the browser state contract, route persistence and responsive shell
  placement with automated and visual verification.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pwa-and-deployment`: require a discoverable, capability-aware in-app
  installation affordance across public and real application chrome.

## Impact

- PWA state and UI under `src/pwa/` and `src/components/`.
- Public, phone-role and counter shell composition under `src/routes/`,
  `src/auth/` and `src/shell/`.
- Vitest and Playwright coverage for install state and shell placement.
- No database, adapter, tenancy, money, offline-outbox, service-worker or
  external API changes.

## Non-goals

- Changing the manifest, service-worker update policy or browser
  installability criteria.
- Promoting installation inside demo mode or preserving a demo URL as the
  installed launch target.
- Adding installation analytics, browser fingerprinting, device enrolment or
  an app-store distribution path.
- Replacing or suppressing installation controls owned by the browser.

## Docs to update before archiving

- `docs/SCREENS.md` — describe the shared install action and where it appears.
- `docs/DESIGN_SYSTEM.md` — record the compact reveal and reduced-motion
  convention.
- `docs/OPERATIONS.md` — document the supported native and iOS installation
  paths.
- `docs/TESTING.md` — record install-affordance coverage alongside the
  production PWA checks.
