# PWA dark status bar — withdrawn workaround

**Model**: Codex GPT-5.6 Sol · **Kind**: production bug fix rollback · **Gate**: restore the pre-task app code in production and the Pixel's Chrome flag to Default; the original native rendering bug remains unresolved.

**Disposition**: Archived on 2026-09-03 as a withdrawn investigation after the verified rollback. All runtime, test and configuration changes were reverted. `docs/DESIGN_SYSTEM.md` was restored and remains accurate; no documentation or capability-spec change is required beyond preserving this record. Design and delta-spec artifacts are intentionally absent under the quickfix rules.

## Why

The Pixel's Chrome 152 on Android 17 honours dark theme metadata for status icons but keeps the native background light. The startup metadata correction did not repair that persistent symptom. An experimental Chrome cutout setting combined with shared app safe-area spacing worked on the device, but the user rejected coupling a personal browser workaround with production changes. Withdraw both app changes from this task and restore the browser setting before publishing the rollback so the phone cannot be left with an overlapping header.

## What changes

- Restore the HTML bootstrap, stylesheet import, phone shell, associated tests and design-system prose exactly to their state before `c856ddd`.
- Restore the Pixel's `Web App Short Edges Cutout Mode` setting to Default and verify it after Chrome restarts.
- Keep this change folder as the diagnostic and rollback record. Its earlier verification documents the withdrawn experiment, not a supported solution.

No spec delta is merged. No schema, RLS, money, offline/outbox, service-worker lifecycle, gate or demo-adapter changes are included. Future personal-device experiments must remain local; any production fix must stand on its own under supported browser defaults and be verified independently of local experiments.
