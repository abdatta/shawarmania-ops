# PWA dark status bar

**Model**: Codex GPT-5.6 Sol · **Kind**: production bug fix, not a roadmap change · **Gate**: browser theme metadata matches the canvas before app startup and after theme changes; installed Android confirmation remains required.

## Why

The reported PWA, installed through Chrome on a Google Pixel 8, shows white status icons on a white bar in dark mode. The initial reproducible application defect was that `index.html` supplied no `theme-color` until the application bundle executed, leaving the light manifest colour as the startup fallback. That startup correction is deployed, but the persistent native symptom remains. Connected-device testing now reproduces it on Chrome 152.0.7977.75 and Android 17 (CP2A.260805.005): the page supplies the correct dark metadata, and metadata changes alter Android's icon colour while the background stays light. Chrome's experimental installed-PWA cutout mode bypasses the failing native background path, but it also requires missing top safe-area spacing in the app. This browser workaround was tested in both themes and restored to Default pending the user's decision; it is not a default-Chrome production fix.

The user has now authorized enabling the browser setting on their Pixel. Ship the phone shell's top safe-area correction alongside this device workaround; the native result remains conditional on that Chrome setting.

## What changes

- Load the token stylesheet and publish its resolved canvas colour from the HTML bootstrap, before the application bundle is needed.
- Keep the existing runtime theme synchronization for manual toggles and device changes.
- Strengthen the existing browser theme test to include startup with application scripts withheld, light/dark device preferences, saved overrides, toggles and reloads.
- Update `docs/DESIGN_SYSTEM.md` with the startup metadata rule.
- Reserve the phone shell's top safe area on its outer container, so its banner, header and nested loading/content regions all stay below Android's status icons. Pin the layout with a browser test that supplies nonzero safe-area insets in both themes.

The existing `design-system` requirements for first-class light/dark themes and device preference with a persistent override already require the behaviour being restored. No spec delta or roadmap row is needed. Browser metadata is a theme correction; no excluded quickfix boundary is touched.

## Non-goals

No schema, RLS, money, offline/outbox, service-worker lifecycle, gate or demo-adapter changes; no surface redesign. No claim that a desktop browser test verifies Android's native status-bar rendering or that an app release changes Chrome's experimental settings. The startup correction is published; confirm the safe-area release on the physical device with the authorized workaround enabled.
