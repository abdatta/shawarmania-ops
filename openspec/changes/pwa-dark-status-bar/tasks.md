## Rollback requested by the user

The user rejected coupling production app changes with a personal Chrome experiment. The implementation recorded below is withdrawn. The original Chrome native-bar issue remains unresolved.

- [x] Restore all six app, test and design-document files touched by this task exactly to the state before `c856ddd`.
- [x] Restore Chrome's cutout setting to Default and verify it after relaunch.
- [x] Verify the restored build and affected tests.
- [ ] Deploy the rollback through the mandatory gate.
- [ ] ROLLBACK GATE: production runs the restored app, the Pixel runs Chrome defaults with no temporary DOM styling, and only this diagnostic change folder differs from the pre-task repository.

Rollback preparation: `git diff c856ddd^ --exit-code` is clean for all six restored files. `npx vite build`, `npm run typecheck` and the two affected browser specs passed (18 tests across phone, tablet and desktop). Chrome's visible flag reads Default after Relaunch; reopening the installed PWA gives a 995-pixel viewport, 0-pixel shell top padding and no inline styling. The native issue remains unresolved. Screenshot evidence is local under `logs/pwa-rollback-default-restarted.png`.

## Withdrawn quickfix — historical evidence

- [x] Reproduce the missing startup metadata in a production browser build and check the existing design-system requirements.
- [x] Publish token-derived theme colour before application startup while retaining runtime synchronization.
- [x] Strengthen the existing theme browser test and prove it fails with the fix removed, then passes with it restored.
- [x] Document the metadata rule and inspect phone/tablet screenshots in light and dark.
- [x] Run typecheck, the touched browser test file, formatting and contrast checks; reconcile the roadmap.
- [x] Reproduce the native browser failure and the phone header overlap under Chrome's experimental cutout mode.
- [x] Enable the browser setting after the user's authorization and verify it persists after Chrome relaunches.
- [x] Implement top safe-area spacing on the phone shell, prove the browser regression test fails without it, and check phone/tablet views in both themes.
- [x] PHASE GATE: local regression checks pass, then confirm the reported native status bar on the installed Android PWA after an authorized deployment, with the user-approved Chrome workaround enabled.

## Verification evidence

- `npm run build` passed before the fix; `npx vite build` passed for the fixed artifact and both sides of the removal proof. Existing large-bundle warning only.
- `npx playwright test e2e/shell.spec.ts --workers=2`: 8 passed on the restored fix (tablet and desktop).
- Removal proof: temporarily restored `index.html` and `src/main.tsx` from HEAD, rebuilt, and ran the targeted theme test. It failed with expected metadata count 1, received 0; restored both files, rebuilt, and reran the complete touched spec successfully.
- `npm run typecheck`, `npm run format:check` and `git diff --check` passed. `npm run contrast`: all 52 pairs passed. `npm run roadmap:sync`: 0 rows changed.
- `npm run lint` passed with 15 warnings in untouched files and no errors; all five repository invariant checks passed.
- Visually inspected owner demo at Pixel 7 and Galaxy Tab S4 landscape sizes in both themes. Metadata matched the token in all four cases; no page errors. Screenshots are local artifacts under `test-results/pwa-dark-status-bar/`.
- Development-server dark launch also checked after moving the stylesheet to HTML.
- Full unit, browser, database/RLS and auth suites deliberately deferred to CI under the quickfix lane. Local verification did not include Android native-bar confirmation; `adb devices` showed no connected device. The user authorized committing and deploying the quickfix so they can perform that device check on production. Their later screenshots identify Chrome 152.0.7977.75 on a Google Pixel 8 running Android 17, build CP2A.260805.005.

## Android follow-up

- Chromium's `BrowserServicesThemeColorProvider` observes `onDidChangeThemeColor`, and `SharedActivityCoordinator` enables the page theme in app mode. Correct metadata after startup does not by itself establish why the reported native bar stays white.
- [Chromium CL 8227486](https://chromium-review.googlesource.com/c/chromium/src/+/8227486), merged 12 August 2026, corrects system-bar appearance for homescreen webapp shortcuts and navigation buttons. The author's [Pixel hardware checks](https://static.januschka.com/i-407420295/regression-check.html) document similar white-on-white symptoms. This is a diagnostic lead, not proof the user's installation has that bug or that the fix is available in their Chrome release.
- Checked the exact [Chrome 152.0.7977.75 source](https://github.com/chromium/chromium/blob/152.0.7977.75/chrome/android/java/src/org/chromium/chrome/browser/customtabs/BaseCustomTabRootUiCoordinator.java): night-mode and bright-colour theming permit `WEB_APK` and `TRUSTED_WEB_ACTIVITY`, but exclude `WEBAPP`. That part of CL 8227486 is absent from this release. The user's App info screenshot identifies a separately installed Shawarmania app, installed from Chrome via Google Play Store. This supports the WebAPK path rather than a Chrome shortcut, so the shortcut-specific exclusion does not explain the report on the available evidence.
- The user force-stopped Shawarmania, reopened it from its icon, and switched light then dark. The status bar still stayed white. The symptom survives a fresh app launch and a manual theme update; repeating refresh/relaunch instructions is not a useful next test.
- Connected the user's Pixel through ADB and reproduced the native failure. Raw CDP confirms the visible standalone page is dark, its metadata is `#0c0a09`, and the device prefers dark. Android reports Chrome's `SameTaskWebApkActivity` with `EDGE_TO_EDGE_ENFORCED`; Chrome targets SDK 36. Native screenshots show the status-bar background remains RGB(250, 250, 249).
- Temporary on-device probes: explicitly painting the HTML background dark and switching `viewport-fit` from `cover` to `contain` did not repair the bar. Changing metadata to white changed the status icons to black; changing it back to dark made the icons white again, while the background stayed RGB(250, 250, 249). These tests used raw CDP, because Playwright's default CDP connection temporarily emulated a light device preference. Page changes were restored after testing.
- A confirmed browser workaround exists: enabling Chrome's `Web App Short Edges Cutout Mode` setting makes the installed app draw behind the status bar. The viewport grows from approximately 995 to 1078 CSS pixels, and the bar follows the app background. This also exposes a missing app inset: the header overlaps status icons until the phone shell's outer flex container receives `padding-top: env(safe-area-inset-top)` (60 CSS pixels on this device). With that temporary spacing correction, the status bar is RGB(12, 10, 9) with light icons in dark mode and RGB(250, 250, 249) with dark icons in light mode. Local evidence: `logs/pwa-device-dark-workaround.png` and `logs/pwa-device-light-workaround.png`.
- The experiment is not a production fix under Chrome's default configuration. The setting affects Chrome's other installed PWAs too; keeping it enabled requires the user's decision. Restored `Default` through the visible Android settings control and its Relaunch button, verified the setting after restart, reopened Shawarmania with its original dark metadata and approximately 995-pixel viewport, removed temporary page styling, closed the diagnostic flags tabs, and removed ADB port forwards. Automated background restarts did not reliably retain the requested setting, so their initial results were not accepted as restoration evidence.

## Production result

### Safe-area follow-up verification

- Commit `f30c7ce` deployed through [run 33735959332](https://github.com/abdatta/shawarmania-ops/actions/runs/33735959332); all verification and release jobs passed. The user's Pixel loaded `Build f30c7ce · 03 Sept 2026, 02:25 pm` through its service-worker update path. Verified no inline spacing remained, switched to each theme and reloaded, then inspected native screenshots: dark canvas with light status icons, light canvas with dark icons, and the header below the 60-pixel safe area in both. Restored the user's dark theme. Native evidence is ignored under `logs/pwa-production-light.png` and `logs/pwa-production-dark.png`.
- The user refreshed during deployment and saw the overlap return because the earlier temporary DOM correction did not survive a reload. Restored it while waiting, then explicitly verified reloads against the published CSS correction. The Chrome setting remains Enabled as requested. To revert it, open `chrome://flags/#web-app-short-edges-cutout-mode`, select Default and Relaunch. This result is conditional on that setting; Chrome's default native background path is still affected, and other PWAs were not exercised.
- The user authorized keeping `Web App Short Edges Cutout Mode` enabled. Selected Enabled in Chrome's visible flag control, used Relaunch, and verified Enabled after restart. The installed PWA now reports a 1078-pixel viewport and a 60-pixel top inset. Temporary DOM spacing keeps the current page usable while the permanent shell correction deploys.
- `npm run build` and `npm run typecheck` passed. `npx vitest run src/shell/phone-shell.test.tsx`: 8 passed. `npx playwright test e2e/phone-navigation.spec.ts --project=phone --workers=2`: 11 passed after restoring the fix.
- Removal proof: removed only the phone shell's top-inset utility, rebuilt, and ran the new targeted test. It failed with expected banner top 60, received 0. Restored the utility, rebuilt, and reran the complete phone navigation spec successfully. The test covers inset transitions 0 → 60 → 0 in both themes.
- Inspected phone screenshots with a 60-pixel top inset and tablet screenshots with no inset, in light and dark. The outer container moves the shell's banner, header and every nested loading/content region together; no surface shimmer needs a separate shape change. Artifacts are ignored under `logs/pwa-safe-area/`.
- `npm run format:check`, `git diff --check`, all 52 contrast pairs and roadmap reconciliation (0 rows changed) passed. Full suites, including real-backend auth checks for the shared shell, are delegated to the mandatory deployment gate under the quickfix lane. Native production confirmation follows that gate.

### Initial startup correction

- Commit `c856ddd` deployed successfully through [run 33729773769](https://github.com/abdatta/shawarmania-ops/actions/runs/33729773769). All CI and release jobs passed. Fresh browser checks on `https://ops.shawarmania.in/` confirmed `Build c856ddd` (03 September 2026, 01:16 pm) and matching startup metadata in both themes.
- The user refreshed the installed Chrome PWA on their Pixel 8, saw the 01:16 pm build, and still saw a white status bar in dark mode. The deployment therefore did not resolve the reported persistent native-bar symptom; the final gate remains open. Do not treat correct browser metadata or a successful deployment as proof of the native fix.
- Received Chrome and Android versions and continued investigation against the exact Chrome release source. Reinstallation is not required to receive this frontend change and is not a confirmed remedy; retain the affected installation for diagnosis.
