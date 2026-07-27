---
name: next-change
description: Recommend the next roadmap change to work on, the Claude model to use for it, and a pre-flight checklist to verify before starting. Use when the user asks "what's next", "which change should I do", "what model should I use", "where are we on the roadmap", or wants a roadmap status/health check.
---

# Next Change Advisor

Answer three questions from the live state of the repo: **what change to do next, with which model, and what to verify before starting.** The single source of truth is `openspec/changes/ROADMAP.md`; never recommend from memory alone — always re-derive from files, because statuses drift as changes are proposed, implemented, and archived.

## Workflow

1. **Reconcile, then load the roadmap.** First run `npm run roadmap:sync` (equivalently `node openspec/tools/sync-roadmap-status.mjs`) — a deterministic reconciler that derives each change's Status from folder state (`changes/` + `archive/`) and rewrites only the leading status-icon cell and the Status word cell (seeded blank, then `📝`/`🔄`/`✅`), so the board is accurate before you read it. It works identically from any agent (Claude, Codex, or a plain shell) and is idempotent. Then read `openspec/changes/ROADMAP.md` in full: the Change Inventory table (numbers, Wave column, Model column, hard dependencies, checkpoints), Execution Waves, Standing Principles, and the Deferred & Demand-Gated list.

2. **Read each candidate's folder for progress detail.** Step 1's reconciler already refreshed the Status cells from folder state (that's the deterministic part — don't re-adjudicate or hand-edit the table), so the coarse state is trustworthy. Read the folders for the detail the table cannot carry — task counts, which `- [x]`/`- [ ]` remain, and whether only gate items are left:
   - Archived → folder moved under `openspec/changes/archive/` → **done**.
   - Folder has `tasks.md` → expanded; count `- [x]` vs `- [ ]` → **in progress** (report progress and whether only PHASE GATE / user-verification items remain).
   - Folder has only `proposal.md` + `.openspec.yaml` → **seeded** (needs `/opsx:propose` before implementation).
   - In the inventory but no folder anywhere → flag as drift; recommend fixing the roadmap.

3. **Compute unblocked work.** A change is unblocked when every hard dependency in its inventory row is done (archived, or all tasks checked with its gate passed). Order candidates by the row's Wave cell (A→F), then by number — read the wave from the column, not by inferring it from the number, since rows added later carry earlier letters. Note any soft or "recommended-first" orderings from the wave notes but do not treat them as blockers.

4. **Recommend.** Lead with ONE primary recommendation — the earliest-wave unblocked change that advances the critical path (`data-model-and-tenancy` → `demo-mode-and-app-shell` → `attendance`, then the billing chain `counter-devices-and-offline` → `billing-live` → `daily-cash-live`). Then list genuinely parallel options separately so the user can multi-track — `ui-billing-counter` (#6) and `ui-outlet-operations` (#7) are fully parallel, as are #4 and the Wave C UI work. If a change is in progress with open non-gate tasks, recommend finishing it before opening a new one.

5. **State the model.** Read the recommended change's Model cell (also echoed in its proposal banner). Tell the user to start the working session on that model before running `/opsx:propose` or implementing, and mention the rationale in one clause. **Opus is the default**; Fable marks the six changes where irreversible design judgment concentrates, and Sonnet marks the four that are purely mechanical. If a Sonnet change turns out to involve a real decision, say so — that means it was mis-scoped and should move to Opus rather than being pushed through.

6. **Build the pre-flight checklist** for the recommended change. Always derive it from the change's own `proposal.md` (read it) plus repo state, and include whichever of these apply:
   - **Workflow step**: if the change is seeded, the first action is `/opsx:propose <change-name>` to expand it into design/specs/tasks — not writing code.
   - **Dependency gates**: any dependency whose tasks are checked but whose PHASE GATE / user-verification item is still open — name the exact gate task.
   - **Clean baseline**: `git status` clean or intentionally scoped; `npm test` green before starting; note the current branch.
   - **Context to load**: the change's proposal, the `docs/` pages it names under "Docs to update", and any spec deltas the proposal names.
   - **Data implications**: whether the change adds migrations (forward-only — never edit a released migration), whether it needs the Supabase local stack running, and whether seed data must be regenerated.
   - **User-only items**: anything only the user can do — verifying a gate on real hardware (installing the PWA on an actual tablet, testing offline billing, checking a geofence on-site), provisioning Supabase projects, confirming a business decision. Call these out explicitly so they aren't discovered mid-change.

7. **Report — use EXACTLY this output template.** Formatting rules: every bullet is ONE line (hard limit ~100 chars); no multi-line paragraphs anywhere; bold key at line start; pre-flight items are `- [ ]` checkboxes so the user can tick them off; omit a section entirely if it's empty (except Do next and Pre-flight, which always appear).

   ```markdown
   ## Roadmap — Wave <X> · ✅ <N> archived / 🔄 <N> in progress / <N> seeded

   ## ▶ Do next: `<change-name>` (#<n>)

   | | |
   |---|---|
   | **Why now** | <one line> |
   | **Model** | <Fable/Opus/Sonnet> — <5-word rationale> |
   | **First action** | `/opsx:propose <change-name>` (or the concrete implement step) |

   ## Pre-flight

   - [ ] <one line per item, imperative, most blocking first>
   - [ ] 🧍 <user-only items prefixed with 🧍 so they stand out>

   ## Parallel options

   | Change | Model | One-line note |
   |---|---|---|

   ## Waiting on you
   - <gate-only items: change → exact gate task, one line each>

   ## ⚠ Drift
   - <mismatch → one-line fix; omit section if none>
   ```

## Repo-specific rules

- **Two keystones, in order.** Never recommend UI work before `data-model-and-tenancy` (#2) is archived — the schema and RLS model is inherited by every query, and mocks must be typed from its generated types or they will drift. Never recommend a `ui-*` change before `demo-mode-and-app-shell` (#3) — the adapter seam and gate registry are inherited by every remaining change.
- **Never recommend a `*-live` change before its `ui-*` counterpart is archived.** A `*-live` change swaps an adapter and promotes a gate; without the screen it has nothing to promote.
- **Never recommend `billing-live` (#10) before `counter-devices-and-offline` (#9).** Billing is offline-first by specification; building settlement online-first means rewriting it.
- **Attendance is the priority path.** Wave B exists to get real staff checking in as early as possible; if Wave B and Wave C work are both unblocked, prefer Wave B.
- **The roadmap is expected to grow.** If a change reveals work beyond its scope, the answer is a `todos/` entry (and later a new inventory row), not silently widening the current change. Say so when you see it.
- If a change adds an outlet-scoped table, the pre-flight must include adding its RLS policy **and** its isolation test case in the same change. That is a hard rule in `AGENTS.md`, not a preference.
- For a `ui-*` change, the pre-flight must confirm the surface ships behind the gate and against mocks — reaching for the Supabase client breaks the seam.
- If the user asks a narrower question ("what model for X?", "is Y blocked?"), answer just that from the same derivation; don't dump the full briefing.
- When a change finishes, remind the user to `/opsx:archive` it — and that archiving must also update the `docs/` pages the proposal named. The status cells reconcile automatically from folder state, so no manual stamping is needed.
- The definition of done for the whole roadmap is every folder under `openspec/changes/` archived.
