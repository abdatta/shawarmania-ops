# Handover — approved UI, live implementation pending

Recorded 2026-10-07. Change #68, Wave F, `the-menu-orders-and-highlights`.
Branch: `codex/menu-orders-highlights-ui`, based on main `0732ba11`.
Main and fetched origin/main matched again before this handover commit.

## Owner authority and stopping point

The owner explicitly approved the current UI: “amazing all lgtm”. Approval is recorded in proposal, design, tasks and verification. The owner then requested reconciliation of all change files/specs, a commit and optional branch push, and a pause until another session. Do not continue implementation in this paused session. Resume when the owner asks; another UI approval is not required. Do not archive, merge to main or deploy without a separate request.

Seven of thirteen tasks are complete. All six tasks in section 3 remain pending. The active change and main menu-management/public-menu specs describe the approved contract; that sync does not mean live ordering/highlights or website propagation exist. Roadmap status is derived by `npm run roadmap:sync` and remains active. Opus is roadmap metadata, not an assertion about the current Codex model.

## What is implemented

The typed optional `MenuAdapter.presentation` interface and mock support independent outlet titles/selections, category item ordering including tied positions, same-outlet validation, read-only refusals and removed-item filtering. `menu-presentation` is still a demo part gate. Real mode does not read presentation data or show its new controls.

Menu Discounts sits above compact Highlights, followed by ordinary categories. The settled editor, purpose text, empty-state line, category-row symbols and fully opaque unavailable dropdown are described in design D1. Share is the only public-menu entry point. Preserve this UI while making it real. Do not revisit the category-row discount redesign: the owner explicitly deferred it.

Bill discount shortcuts is inside the outlet's existing Orders section. Orders settings and shortcuts are sibling cards with independent drafts and plain Save/Cancel, equal-width one-to-four shortcut rows, compact addition controls and matching saved-card glow with reduced-motion support. Presets already use the existing live adapter/persistence; this relocation needs no new schema. The implementation uses the existing percent/rupee integer storage conversions; it does not change bill arithmetic or offline settlement.

## Read first and resume at task 3.1

Read AGENTS.md, the propose-apply-verify and openspec-apply-change skills, then proposal.md, design.md, tasks.md, both spec deltas and verification.md. Fetch and inspect branch/main/origin/main without discarding this branch's work. Preserve unrelated changes. Start with failing database and REST tests for atomic reorder, stale membership, highlight configuration validation, authority and outlet isolation.

Add schema-backed per-outlet persistence and RLS in the same stage, regenerate types from a fresh reset, and wire the existing presentation interface through the live adapter. Promote the part gate only after round-trip evidence. Do not introduce direct Supabase imports into screens or invent generated-schema fields. Keep demo behavior intact.

Extend the service-role-only `public_menu(slug)` reader by prepending nonempty highlights as an existing-shape section, keeping dishes in their ordinary categories and using the exact public projection. Preserve null responses, privilege restrictions and field allowlist. Validate current prices, availability, removed/empty omission and ordinary item order. The actual brand-site Worker is in `C:/Users/iamro/Code/shawarmania/worker/src/menu.ts` and `menu-page.ts`; generic section rendering and its one-minute cache should require no website deployment. Verify its renderer and duplicate-title anchors rather than claiming propagation from inspection alone. The real URL is `shawarmania.in/menu/<slug>/`.

Before finishing, run the full local gates and database/auth/generated-parity checks specified in tasks 3.5–3.6, update the remaining durable docs, and report external verification honestly. Archive is a separate action.

## Code landmarks

- `src/data-access/adapters.ts`, `mock/menu.ts`, `mock/store.ts`, `mock/index.ts`: presentation seam, demo configuration and authority.
- `src/features/menu/menu-surface.tsx`, `menu-highlights.tsx`, `menu-discounts.tsx`: ordering/highlighting controls, compact cards/editor and opacity fix.
- `src/features/outlets/outlet-discount-presets.tsx`, `outlet-preset-editor.tsx`: independent draft/preset persistence, outer saved card and compact controls.
- `src/features/outlets/outlet-service-sections.tsx`, `outlets-surface.tsx`: sibling card ownership, shared SaveBar/timing, loading shapes and visible active outlet scope.
- `src/gates/registry.ts`: demo-only `menu-presentation` part.
- `e2e/menu-presentation.spec.ts`, menu/mock/outlet component tests: current behavioral and layout evidence.

## Verification and local state

The final UI code passed lint (16 existing warnings), format check, TypeScript, Edge mapping typecheck, 170 files / 2,247 unit tests, 64 contrast pairs across both themes, the production build and 312 browser tests without retries. Focused shortcut/Orders tests: 27; focused presentation browser cases: 8. Phone 390×844 and tablet 1080×810 were inspected in both themes, with no console errors or external demo requests. Opacity, 44 px preset sizing and saved-card assertions were observed failing before their respective fixes. This documentation reconciliation does not change source or tests.

Database/RLS/auth/generated parity were not run locally in this UI stage. No migrations, policies, generated schema, live presentation adapter, public reader or brand-site files changed. Docker was probed before the branch commit and its Linux engine was unavailable. The next live stage must start the required stack and run those checks.

Prior UI logs are temporary local evidence (`preset-glow-unit.log`, `preset-glow-e2e.log` under the Windows TEMP directory) and are not required to resume. Current screenshots use `glow-` in `C:/Users/iamro/.codex/visualizations/2026/10/07/01a114b1-ee9b-72c1-81db-80518474186b/`; these files are not on the branch.

The agent's production preview used port 7414; do not assume it survives the session. Start your own preview rather than attaching to a server you did not start. Main-tree preview is 7413; worktree preview is 7414; the owner's dev server is 7412. A service worker can retain old bytes, so confirm the loaded build after restarting. Preserve the owner's tabs and drafts.

## Prompt for a new session

Resume change `the-menu-orders-and-highlights` (#68) on branch `codex/menu-orders-highlights-ui`. Read its handover.md and all applicable instructions/skills. The UI is explicitly owner-approved and the specs are reconciled; implement tasks 3.1–3.6 end to end using propose-apply-verify, preserving the approved UI. Start with database/REST tests, then persistence/RLS, generated types, live adapters and public-menu propagation. Keep the demo working, leave category-row discount redesign deferred, and do not archive, merge or deploy without my request.
