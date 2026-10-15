# Implementation verification — 2026-10-07

## Resumed live stage — all local gates passed

The owner resumed in this session after the approved UI branch checkpoint. All implementation tasks are implemented and locally verified; the newly authorised release is in progress. The live part gate preserves the approved UI and demo. Two scoped tables and three authority-checking commands persist the configuration and normalize item order. Types were regenerated from the reset schema; no brand-site files changed. The records below the resumed-stage notes describe the earlier UI checkpoint and its then-pending backend, not the current implementation status.

The 49 baseline menu/settings tests passed before live edits. The new SQL suite was observed failing against the old schema: reorder/read functions did not exist and tied positions remained unchanged. The REST suite also failed on the old schema's missing configuration tables; the migration was restored in finally and the seeded schema reset afterwards. Both final SQL files now pass 65 assertions. Eight real-session HTTP checks pass, including owner/manager round trips, positive-control foreign rows before concealment, revoked direct writes, read-only roles and a concurrent removal held open while a reorder waits. After committing the removal, the stale reorder is refused and both saved positions remain unchanged. Fixture configuration and synthetic race rows are restored/removed.

The focused gate/screen tests passed 67 cases before the final equal-name tie test was added. The new auth browser case passed, saving highlights, moving a dish and reloading the real screen on phone 390×844 and tablet 1080×810 in both themes. All four screenshots were inspected; category markers, compact cards and saved order match the approved UI, with no page errors or horizontal overflow. The loading shapes remain those approved in the UI stage.

The actual unchanged brand Worker was bundled from its local source and run against the local database with its own readMenu, public-field tripwire, cache handler and renderer. It returned 200 with `public, max-age=60`, rendered independently ordered highlights before categories, kept dishes in their categories and generated working `shawarma` / `shawarma-2` anchors when titles matched. A configuration change retained the cached result, then appeared after advancing the simulated cache clock past sixty seconds. No service credential appeared in HTML. Kanchrapara's fixture was restored. This is local Worker compatibility/cache evidence; production propagation has not been exercised and no release is authorised.

Corrections during this stage: fixed a test's first-dish expectation to match its deliberately reversed order; the concurrency probe now identifies blockers by the holder's backend PID because other roles' SQL text is not reliably visible; the real-mode component test uses the fixture's actual first dish; and unsupported Testing Library `exact` options were removed. No product behavior was weakened to satisfy assertions. Docker Desktop was started successfully, superseding the earlier unavailable-engine note. The first full backend attempt found the Edge runtime stopped after reset; restarting it restored the device-handshake path. Another attempt hit shared-seed/startup failures in account flows, and a focused retry hit local one-time-code rate limits. The authoritative run used a fresh reset, pgTAP first and all six REST/RLS phases with the main files serial (same assertions). All phases passed. No unrelated product fix or test weakening was needed.

## Final gates — 2026-10-07

Formatting ran before the source checks; after the final documentation edits, prose formatting and repository invariant checks were repeated. No source changed after the successful gates.

| Gate | Final evidence |
| --- | --- |
| Lint | Passed, 0 errors / 16 existing warnings |
| Format check | Passed |
| App typecheck | Passed |
| Edge Function typecheck | Passed against regenerated schema |
| Unit/component suite | 170 files / 2,249 tests passed |
| Contrast | 64 pairs passed across light and dark |
| Production build | Passed in both demo and authenticated browser preconditions, including TypeScript and service worker |
| Demo browser suite | 312 passed without retries |
| Fresh reset and database suite | 78 files / 3,073 assertions passed; new files contribute 65 |
| REST/RLS suite | All six phases passed: 11 realtime, 218 general REST (9 files, default parallelism), 12 billing races, 43 drawer writes, 3 telemetry, 4 ledger timing; 291 total |
| Authenticated browser suite | 35 passed without retries, including live menu persistence, device billing and offline paths |
| Generated types | Regenerated output matches the committed schema snapshot |
| Diff and encoding | Clean whitespace; every changed file decodes as UTF-8 without BOM |

The initial main REST verification used serial files. The release correction below reran the exact `npm run test:rls` command with default parallelism successfully, superseding that workaround. No reset occurred between the authoritative pgTAP, REST/RLS and auth phases. Phone/tablet and both-theme live screenshots were inspected, and demo browser checks retain no-external-request coverage.

All gate clauses have local implementation evidence. **Production remains unpublished**: `shawarmania.in/menu/<slug>/` changes only after the ops migration/app release, then the existing minute cache expiry. The actual Worker compatibility and simulated expiry proof do not claim a hosted production update. Archive, merge and deployment were not performed.

## Earlier approved UI checkpoint

The following sections retain historical UI-stage evidence, superseded by the completed live-stage results above. The owner explicitly approved the UI on 2026-10-07 (“amazing all lgtm”). At that checkpoint, seven of thirteen tasks were complete and persistence/live work was still pending. No migration, generated schema, live presentation adapter or public reader had changed yet. The owner authorised a branch commit/push and pause, then resumed here. The preset relocation reused its existing live persistence.

## What was walked

Items move up/down within their category, including tied sort positions; the first move-up action is disabled. The highlights editor renames the section, searches and selects dishes from several categories, independently reorders them, and saves title and selection together. Cancel preserves the saved selection. Blank titles are refused visibly. Highlighted dishes remain in their original categories, unavailable dishes stay visible, and removed selections are filtered. Outlet changes discard old loaded rows and drafts. Each outlet keeps independent configuration. At this earlier UI checkpoint, real mode did not read presentation data or offer its new controls.

## Owner-requested UI iterations

Discounts precede the compact highlights card. Empty highlights stay a single row with name, Edit and permanent guidance: “Highlight dishes at the top of your menu.” The separate customer preview was removed; Share remains the public-menu entry point. The dense editor puts the name label beside its input and selected names beside their move/remove controls. No Selected dishes heading/count is visible. Empty drafts show the normal-weight line “No dishes highlighted yet.” Price, availability and dietary information remain in the choices below.

Highlighted category rows carry the existing sparkle symbol; the highlights list does not repeat it. Ordinary unavailable rows use a compact crossed-circle symbol. Both retain accessible names and hover titles, and can appear together. Availability and selection changes update them. Only unavailable item details are dimmed: its action trigger and dropdown stay fully opaque.

Menu Discounts shows “Category or whole-menu discounts.” beneath its title, beside Add Discount. Browser geometry assertions cover this layout on phones. When discounts and highlights are unused on a 390×844 phone, the first ordinary category begins above 422 px and empty highlights are at most 72 px tall. With two highlighted dishes, the search starts within 300 px of the dialog top.

Existing counter presets now live in a **Bill discount shortcuts** tile inside the outlet's **Orders** section. There is no separate Counter presets section or Edit sheet. Inline nested surface tones, the percent/rupee segmented selector and shared SaveBar match Orders and Loyalty. Save and Cancel appear after changing the shortcut configuration; Save shows writing and Saved feedback, then folds away. Cancel restores the saved configuration and clears an unfinished addition. Failed saves preserve the draft and allow retry. Read-only readers have no editing controls; unavailable outlets do not mount the setting; an outlet change resets its draft. Percentage/rupee units, the four-preset cap and independent outlet storage remain. The latest density pass groups saved shortcut controls side by side and puts the new value, compact percent/rupee selector and labelled plus button on one row, preserving 44 px targets. A compact header keeps the existing settings tones and rounded shape. Browser assertions bound the default three-shortcut tile to 180 px, keep the three controls on one row, and check for horizontal overflow. The loading placeholders reflect the compact location and height. The category-based menu-discount redesign remains explicitly deferred.

## Equal-width shortcuts and independent saves — 2026-10-07

One through four shortcuts occupy equal-width grid columns spanning the full tile. Each shortcut is a removable button showing its value and trash symbol; its accessible name and title retain the complete value. The controls have a 44 px minimum height, including the compact unit selector and Add action. The new browser assertion initially failed at 38.5 px because the app uses a 14 px root font; explicit minimums fixed the sizing without loosening the assertion. Default three-shortcut density remains within 180 px.

Orders now contains two sibling cards. The first holds customer/service/packaging controls and ends with **Save** and Cancel. The next holds shortcuts with **Save** and Cancel. Both save buttons use the plain Save label requested by the owner; the sibling card boundaries identify their scope. Nothing enclosing shortcuts has an additional Orders footer. A combined-draft component test proves saving and cancelling either retains the other's saved configuration and unsaved draft. Browser cases prove the Orders save bar sits above shortcuts, all one-to-four configurations fill one equal-width row, and no overflow occurs. The loading placeholders reserve two sibling shapes.

The eight focused browser cases passed without retries after fixing the minimum height. Independent in-app inspection covered phone 390×844 and tablet 1080×810, light and dark, four shortcuts and both visible save bars. Console warning/error logs were empty. Inspection drafts were cancelled. A fresh session-owned preview was started on 7414 because the prior process had ended and the old tab was serving cached bytes; two reloads loaded the updated service worker. The original user tab and its draft were untouched. The equal-width iteration screenshots use `row-`; current plain Save and saved-glow screenshots use `glow-`.

## Plain Save labels and matching saved glow — 2026-10-07

Both independent cards now use the plain Save and Cancel labels requested by the owner; the longer visible labels and their unused shared-component option were removed. The shortcut component owns its outer Card, keeping the same dimensions and location, so its successful saved phase applies the existing `motion-safe:animate-[saved-glow_1.6s_ease-out]` and shared Saved/settling timing. Drafts, cancellation and refused writes do not glow. The Orders parent renders this sibling directly rather than adding a second Card.

The saved-card regression assertion failed before the fix (the shortcut card had no saved-state wrapper) and passed after it. The focused 27 component tests passed, including failed-write refusal and independent drafts. All eight phone/tablet and light/dark browser cases passed: computed animation is `saved-glow` after success and `none` under reduced motion. The screenshots and both plain labels were inspected. Independent in-app saves in light and dark confirmed the live animation name and visible glow, with empty warning/error logs. Inspection restored the original three shortcuts in the agent's tab. Current screenshots use the `glow-` prefix, including the plain Save labels before success and each card's glow afterwards. The full applicable gates were then repeated on the final code: 170 files / 2,247 unit tests and 312 browser tests passed, with no browser retries; lint, formatting, generated-schema Edge mapping typecheck, contrast and the production build passed as well. No database, policy or auth changes were made in this refinement.

## Issues found and corrected

- Reproduced the unavailable dropdown's effective opacity at 0.7. Added a browser assertion that failed before the fix (expected 1, received 0.7), moved opacity to the details wrapper, and re-ran it across both themes and viewports.
- The full browser suite found an older operations assertion expecting the removed Unavailable text badge. Updated it to assert the accessible Unavailable symbol.
- Typechecking rejected an unsupported Testing Library selector option in new tests. Removed that option and repeated checks; no product behavior was changed to satisfy the test.

## Checks

Formatting ran before each code verification set. The original mock/UI stage passed all applicable gates. The latest compact settings iteration passed the full applicable suites again: 170 files / 2,247 unit tests and 312 browser tests with no retries. Lint, format check, functions typecheck, contrast, production build (including TypeScript) and diff checks also passed. The final phone/tablet, light/dark geometry checks prove the default tile is at most 180 px, one through four shortcuts fill one equal-width row, the addition controls share one row without overflow, and independent save controls belong to sibling cards. The initial full run had eight sizing assertion failures (38.5 px instead of 44); after the minimum-height correction the final full run passed all 312 without retries. The later screenshot check waits for the save-bar expansion to finish so its buttons are fully visible in the evidence.

| Gate | Result |
| --- | --- |
| Pre-flight menu / outlet tests | Passed before edits |
| Focused menu tests | 29 passed after dropdown scope fix |
| Focused shortcut + Orders tests | 27 passed including independent drafts and saved-glow success/failure checks |
| `npm run format` | Passed before gates |
| `npm run lint` | Passed; 16 existing warnings in unchanged files |
| `npm run format:check` | Passed |
| `npm run typecheck` | Passed |
| `npm run functions:typecheck` | Passed |
| `npm test -- --maxWorkers=4` | 170 files / 2,247 tests passed after the final row/save/glow refinement |
| `npm run contrast` | 64 pairs passed across both themes |
| `npm run build` | Passed as the browser suite's production-build precondition, including TypeScript and service worker |
| `CI=1 npm run test:e2e -- --workers=3` | 312 passed after the final row/save/glow refinement; no retries needed |
| `git diff --check` | Passed |
| Database, RLS, auth e2e and generated parity | Not run in this UI iteration; no schema, policy, auth, role-index or offline write changes |
| Live highlights persistence and actual website propagation | Pending the explicit post-approval live stage |

Phone 390×844 and tablet 1080×810 were checked in light and dark through browser tests and independently through the in-app browser. The in-app browser console contained no warnings or errors. Presentation browser cases assert no page errors, horizontal overflow or requests beyond their own origin. Previous review screenshots use the `review-` prefix; the final row/save/glow screenshots use `glow-` in the task's visualization directory.

## Review location and remaining work

`http://127.0.0.1:7414/shawarmania-ops/demo/admin/outlets/d0000000-0000-4000-a000-000000000001`

The session-owned production preview remains running on 7414, with its review tab retained; the owner's dev server was not used. The original 7413 tab and draft were preserved. A fresh review tab opens the outlet's Orders settings for the shortcut controls. The existing user tab and its draft remain untouched; inspection drafts in the new tab were cancelled and temporary viewport overrides reset. The prior service-worker build needed reloading before the new bytes appeared; verified the current copy and opacity through the loaded DOM.

Owner approval was explicit on 2026-10-07: “amazing all lgtm”. The requested specification reconciliation records it in proposal, design and tasks and syncs the two main capability specs. Backend/live/public work was pending at that checkpoint and is now complete as recorded above; no further UI approval was required to resume it. The owner then requested a branch commit/push and pause until a new session. See handover.md for the starting point. Archive and publication remain separate, unauthorised actions.

## Specification reconciliation and handover checks — 2026-10-07

Menu-management adds **Managers deliberately order items within a category** and **Each outlet has an editable named highlights selection**; modifies **The menu is a real record a manager creates and maintains in the app** for opaque unavailable actions and **An outlet's menu discounts are set over categories, several at a time** for the agreed naming/guidance; renames and updates **The outlet's counter discount presets are configured with the menu** to **The outlet's counter discount presets are configured in outlet settings**, covering the final compact sibling cards, independent plain Save/Cancel and saved glow.

Public-menu adds **Highlighted dishes lead the public menu** and modifies **The public menu is read through one service-role function** to prepend highlights while preserving ordinary order, exact public fields, client-role refusal and null responses. All unrelated main-spec requirement blocks were compared to HEAD and remain unchanged. The main specs and deltas agree; syncing them does not complete tasks 3.1–3.6.

`npm run roadmap:sync` reported no status changes. Formatting ran before checks; format:check, lint:todos, lint:specs, lint:agents, lint:encoding and diff checks passed. An additional audit verified clean UTF-8 without BOM for new change files, seven completed/six pending tasks and unchanged source/test hashes, so the prior final UI verification remains applicable. A pre-commit Docker probe could not connect to the Linux engine; database/RLS/auth/generated parity remain unrun locally and are required for the next live stage. The branch checkpoint does not publish to main.

## Release correction — REST session cleanup

The owner authorised merging to main and deploying, then specified no merge commits. Main and origin/main matched and were ancestors of the tested branch; the integration fast-forwarded to debe0a8d.

Deploy run 37680155944 failed its REST gate with 28 account-flow failures before production migration/publication. Inspection exposed a test-fixture bug: default Supabase signOut revokes all sessions for each shared seeded persona. The menu fixture therefore invalidated parallel tests' owner/manager sessions. A two-client local probe confirmed this, and a regression calling the actual shared cleanup helper failed with AuthSessionMissingError when the old global cleanup was restored. Restoring scope: local passed all eight presentation tests, preserving the other owner's session.

After another fresh reset, all 3,073 database assertions and the exact standard parallel npm run test:rls command passed (291 checks across all six phases). Typecheck, test-file ESLint/formatting and diff checks passed. The product/migration bytes did not change; prior UI, unit, contrast and authenticated-browser evidence still applies. The initial deploy was cancelled before publication, and the scoped-cleanup correction is being released through a new complete deployment run.
