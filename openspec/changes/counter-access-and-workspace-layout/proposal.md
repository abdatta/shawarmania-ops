## Why

An unconfigured installed counter has no path from its sign-in screen to the
setup form, so staff must know and type a URL that the installed app does not
expose. On the live counter, the current-bill and activity columns are also
locked to an equal width even when an operator needs more room for either task.

## What Changes

- Add a clear public entry from the signed-out front door to the counter-tablet
  setup form, and make the code-issued guidance name that entry.
- Let a counter user drag either the current-bill or activity column wider or
  narrower while preserving the menu column's touch-safe minimum width and the
  existing three-column, horizontal-scroll layout.
- Keep the two chosen widths on that browser so the configured counter keeps
  its working layout after a reload.
- Replace the equal-width layout assertion with interaction coverage for both
  resize handles and the protected menu minimum.

## Non-goals

- Reintroducing the standalone Shift navigation item. Its route is deliberately
  hidden because the live counter already contains the shift activity column.
- Changing tablet setup authorisation, setup-code lifetime, device sessions,
  billing data, or counter routing.
- Rearranging, stacking, or hiding any counter column at narrow widths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `counter-device-sessions`: an unconfigured tablet can reach its setup form
  from the app's signed-out entry point.
- `app-shell`: the current-bill and activity columns may be independently
  resized without making the menu column unusable or changing the three-column
  workspace.

## Impact

- `src/auth/sign-in.tsx`, `src/features/counter/devices-surface.tsx`, and their
  tests for tablet setup entry guidance.
- `src/features/billing/billing-counter.tsx`, counter component tests, and
  Playwright layout coverage for the resizable workspace.
- `docs/SCREENS.md` before archive; no gate-registry or data-access changes.
