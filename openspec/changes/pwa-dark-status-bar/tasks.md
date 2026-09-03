## Quickfix

- [x] Reproduce the missing startup metadata in a production browser build and check the existing design-system requirements.
- [x] Publish token-derived theme colour before application startup while retaining runtime synchronization.
- [x] Strengthen the existing theme browser test and prove it fails with the fix removed, then passes with it restored.
- [x] Document the metadata rule and inspect phone/tablet screenshots in light and dark.
- [x] Run typecheck, the touched browser test file, formatting and contrast checks; reconcile the roadmap.
- [ ] PHASE GATE: local regression checks pass, then confirm the reported native status bar on the installed Android PWA after an authorized deployment.

## Verification evidence

- `npm run build` passed before the fix; `npx vite build` passed for the fixed artifact and both sides of the removal proof. Existing large-bundle warning only.
- `npx playwright test e2e/shell.spec.ts --workers=2`: 8 passed on the restored fix (tablet and desktop).
- Removal proof: temporarily restored `index.html` and `src/main.tsx` from HEAD, rebuilt, and ran the targeted theme test. It failed with expected metadata count 1, received 0; restored both files, rebuilt, and reran the complete touched spec successfully.
- `npm run typecheck`, `npm run format:check` and `git diff --check` passed. `npm run contrast`: all 52 pairs passed. `npm run roadmap:sync`: 0 rows changed.
- `npm run lint` passed with 15 warnings in untouched files and no errors; all five repository invariant checks passed.
- Visually inspected owner demo at Pixel 7 and Galaxy Tab S4 landscape sizes in both themes. Metadata matched the token in all four cases; no page errors. Screenshots are local artifacts under `test-results/pwa-dark-status-bar/`.
- Development-server dark launch also checked after moving the stylesheet to HTML.
- Full unit, browser, database/RLS and auth suites deliberately deferred to CI under the quickfix lane. Local verification did not include Android native-bar confirmation; `adb devices` showed no connected device. User confirmed Chrome on a Google Pixel 8; Chrome and Android versions remain unknown. The user authorized committing and deploying the quickfix so they can perform that device check on production.

## Android follow-up

- Chromium's `BrowserServicesThemeColorProvider` observes `onDidChangeThemeColor`, and `SharedActivityCoordinator` enables the page theme in app mode. Correct metadata after startup does not by itself establish why the reported native bar stays white.
- [Chromium CL 8227486](https://chromium-review.googlesource.com/c/chromium/src/+/8227486), merged 12 August 2026, corrects system-bar appearance for homescreen webapp shortcuts and navigation buttons. The author's [Pixel hardware checks](https://static.januschka.com/i-407420295/regression-check.html) document similar white-on-white symptoms. This is a diagnostic lead, not proof the user's installation has that bug or that the fix is available in their Chrome release.
- Pending device check: switch the installed app to light and back to dark and observe whether the Android status bar remains white. A successful toggle would support a startup/update timing issue; a persistent white bar needs native-browser investigation before claiming this change resolves the report.
