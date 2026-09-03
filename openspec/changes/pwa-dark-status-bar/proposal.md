# PWA dark status bar

**Model**: Codex GPT-5.6 Sol · **Kind**: production bug fix, not a roadmap change · **Gate**: browser theme metadata matches the canvas before app startup and after theme changes; installed Android confirmation remains required.

## Why

The reported PWA, installed through Chrome on a Google Pixel 8, shows white status icons on a white bar in dark mode. The reproducible application defect is that `index.html` resolves the dark theme before paint but supplies no `theme-color` until the application bundle executes, leaving the light manifest colour as the startup fallback. After startup, both the development server and production build already supply the correct dark colour; the persistent native-bar symptom and its triggering Chrome/Android versions are not yet reproduced.

## What changes

- Load the token stylesheet and publish its resolved canvas colour from the HTML bootstrap, before the application bundle is needed.
- Keep the existing runtime theme synchronization for manual toggles and device changes.
- Strengthen the existing browser theme test to include startup with application scripts withheld, light/dark device preferences, saved overrides, toggles and reloads.
- Update `docs/DESIGN_SYSTEM.md` with the startup metadata rule.

The existing `design-system` requirements for first-class light/dark themes and device preference with a persistent override already require the behaviour being restored. No spec delta or roadmap row is needed. Browser metadata is a theme correction; no excluded quickfix boundary is touched.

## Non-goals

No schema, RLS, money, offline/outbox, service-worker lifecycle, gate or demo-adapter changes; no screen layout changes. No claim that a desktop browser test verifies Android's native status-bar rendering. Publishing and physical-device confirmation are separate remaining steps.
