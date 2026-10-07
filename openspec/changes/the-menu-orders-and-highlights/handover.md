# Handover — menu ordering and highlights (#68)

Recorded 2026-10-07. Branch: `codex/menu-orders-highlights-ui`, based on main `0732ba11`, which matched fetched origin/main at resumption. The approved UI checkpoint is commit `a35f49cb` (originally `f683d2cd`); the owner then explicitly resumed implementation here.

## Current state

The approved UI is preserved. Persistence, live adapters and public-reader integration are implemented. All implementation tasks are complete and all local gates pass. The owner has now authorised release. Read tasks.md and verification.md for the authoritative results. Main was updated by fast-forward without a merge commit. Archive remains separate; deployment verification is in progress.

The owner authorised amendment and a force-push to correct model attribution. This thread's `turn_context.model` consistently identifies `gpt-6.1-sol`; the correct trailer is Codex GPT-6.1 Sol. The three original commits were reconstructed with unchanged file trees, author/committer identities and dates, and linear parents: `f683d2cd` → `a35f49cb`, `debe0a8d` → `01a06c44`, `4171a62e` → `964046b2`. The Git Commit skill now invokes `node scripts/resolve-codex-model.mjs` to verify the active session rather than guessing from a generic GPT family instruction.

The owner approved the UI on 2026-10-07 (“amazing all lgtm”). No further UI approval is required. The earlier pause was revoked by “resume here itself”. Commit and branch push were authorised. The owner subsequently requested merge/deploy and no merge commits, authorising publication; archive remains separate. Category-based discount presentation is deliberately deferred.

## Implementation

- `supabase/migrations/20261007000000_menu_orders_and_highlights.sql` creates outlet-scoped highlight title/reference tables with RLS, revoked direct client writes and a same-outlet composite foreign key. Atomic commands re-derive live owner/manager authority, validate the complete selection/order and refuse stale membership without partial positions.
- `src/data-access/supabase-adapters/menu.ts` implements the existing presentation seam; generated schema types back the configuration. `menu-presentation` is live. Both adapters use item identity after equal position/name ties; the demo remains synthetic.
- `public_menu` prepends nonempty highlights in the existing section shape and exact public item allowlist. The existing service-only boundary, indistinguishable nulls and ordinary categories survive. Removed/inactive selections disappear; unavailable dishes remain selected.
- The actual unchanged brand Worker in `C:/Users/iamro/Code/shawarmania/worker/src/` rendered local reader output, including duplicate-title anchors. Its actual cache handler was checked with simulated sixty-second expiry. No website files or credentials changed.
- The approved compact menu cards/editor, symbols, opaque actions and Orders Bill discount shortcuts remain. Shortcuts and service settings have independent plain Save/Cancel, equal-width one-to-four controls and saved glow.

## Verification and continuation

Full frontend gates pass: 2,249 unit/component tests, 312 demo browser cases, 64 contrast pairs, lint (16 existing warnings), formatting and both typechecks. Fresh database verification passes 3,073 assertions. All six REST/RLS phases pass 291 checks with the exact standard parallel command after fixing fixture cleanup to scope: local. A regression fails with the previous global cleanup and passes with the fix. Generated types match the schema. The focused live-menu browser case passed on phone/tablet in both themes and all four screenshots were inspected. The full authenticated browser suite passed all 35 cases without retries.

An initial reset left the Edge runtime stopped; it was restarted. Retried account flows hit local one-time-code rate limits, so the authoritative run used another fresh reset, pgTAP first, then all six REST phases without changing their assertions. Do not rerun pgTAP on the committed money fixtures left by REST; use a fresh reset and the documented order. Start your own preview and follow AGENTS.md port rules.

The final results and completed tasks are recorded, roadmap status is derived, and the branch checkpoint includes this implementation. Continue the authorised release and verify its workflow and hosted app/menu; do not archive automatically.

Production `shawarmania.in/menu/<slug>/` has not changed yet. The first deployment failed its REST gate before migration/publication because global fixture sign-out invalidated other seeded sessions; the correction is now verified under default parallelism. Release through the repository's verified deployment workflow and check the hosted menu after its minute cache expires. The existing live menu address is https://shawarmania.in/menu/kalyani/. The existing brand Worker needs no deployment. Preserve its last-good fallback; never send a service credential to the browser.
