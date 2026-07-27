---
name: propose-apply-verify
description: Drive one roadmap change end to end in a single session — /opsx:propose, then /opsx:apply, then an autonomous iterative verification loop (CLI + browser) that fixes what it finds and ends with a verification report. Use when the user says "/propose-apply-verify <change>", "do <change> end to end", "propose, build and verify <change>", or wants a change taken from seed to verified without manual checking.
---

# Propose → Apply → Verify

Take ONE named change from seed to **implemented and independently verified** in a single run: expand it into artifacts, implement every task, then verify the result yourself — iterating on fixes until everything passes or a genuine blocker needs the user. The user's role is to read the final report and, if they choose, repeat the verification steps as confirmation; it is **not** to perform verification for you.

**Input**: the change name — `/propose-apply-verify <change-name>`. If omitted, infer it from conversation context; if ambiguous, list active changes and ask. Announce: "Driving change: `<name>` — propose → apply → verify."

Archiving is deliberately NOT part of this skill. It ends by offering `/opsx:archive`, because archiving merges spec deltas and updates docs — a step the user may want to review first.

## Phase 0 — Pre-flight (quick, don't ceremonialize)

- Read the change's `proposal.md`. Note its **Model** banner: if the session model is a lower tier than the banner names, say so and let the user decide whether to continue.
- Note the change's **Gate** line — the verification loop must cover every clause of it.
- Confirm a clean-enough baseline: `git status` scoped to intended work; `npm test` green before starting if the tree is dirty from unrelated work.

## Phase 1 — Propose

Run the `/opsx:propose <name>` flow (the `openspec-propose` skill). If `openspec status --change <name>` already shows all artifacts complete, skip straight to Phase 2 and say so. After artifacts land, run `npm run roadmap:sync`.

## Phase 2 — Apply

Run the `/opsx:apply <name>` flow (the `openspec-apply-change` skill): read the context files, implement every task, check each `- [x]` off as it completes, run `npm run roadmap:sync` once implementation begins. Pause only for genuine design conflicts — prefer momentum plus a recorded decision over stopping to ask.

## Phase 3 — Verify, fix, re-verify (the heart of this skill)

Verify **independently, with whichever tools are most effective** — the CLI, the browser pane against a real build, or both. Do not ask the user to carry out manual verification unless an action is genuinely impossible without them (real hardware, a live credential, an on-site check).

Run as a loop, not a checklist:

1. Verify thoroughly (everything applicable below).
2. Identify every bug, regression, incomplete behavior, or surprise.
3. Fix everything you can.
4. Re-run the verification relevant to each fix, plus the full gates.
5. Repeat until all checks pass, or a genuine blocker remains that only the user can clear. **Never stop at the first successful-looking result** — check edge cases, console errors, network traffic, logs, and both automated and manual-equivalent paths before calling it done.

### Always (any change) — from AGENTS.md

- `npm test`, `npm run lint`, `npm run typecheck` — all green.
- `npm run build` — clean.
- `npm run test:e2e` — against the production build (the suite builds it itself).

### When applicable — derive from what the change touched

- **Tenancy** (new/changed tables or policies): the RLS isolation suite (`npm run test:db` / `npm run test:rls`) passes for every outlet-scoped table; a new table without an isolation test is an incomplete change.
- **Theme/tokens**: `npm run contrast` — both themes; AA is the floor.
- **UI surfaces**: run the app (production build via `vite preview`, or the browser pane's launch config) and inspect on a phone viewport and a tablet viewport, in light and dark. Check the a11y tree/DOM if the pane cannot composite screenshots. Zero console errors; zero unexpected network requests (read the network log, don't assume).
- **Billing/offline**: exercise the offline path — offline → ring bills → online → exactly-once settlement, no duplicates.
- **Demo-mode safety** (anything touching the seam): demo walk makes no request beyond the app origin; the banner is present and undismissable; deep links survive reload.
- **`*-live` changes**: the surface actually moved `demo` → `live`, and demo mode still works afterwards.
- **The change's own Gate line**: verify every clause literally, and say which test or action proved it.

### Rules of the loop

- Fixes discovered here are part of THIS change — fix, re-verify, and note them in the report. Work beyond the change's scope goes to `openspec/todos/`, not into silent scope creep.
- If a pre-existing test breaks because the change legitimately altered the UI/contract, fix the test to assert the same intent precisely — never delete or weaken an assertion to get green.
- Prefer real verification over asserting success. If a gate was not run, the report must say so.

## Phase 4 — Report, then hand back

End with a concise report containing, in order:

1. **The verification steps the user would normally have been asked to perform.**
2. **Which steps you completed yourself, and whether you used the browser, the CLI, or both.**
3. **The bugs or issues you identified.**
4. **The fixes you made.**
5. **The verification you repeated after each fix.**
6. **The final status of all checks** (one line per gate).
7. **Any remaining blockers or limitations that genuinely require the user** — prefix with 🧍.

Only after the full loop is complete, tell the user they can repeat the listed steps themselves as a final confirmation — and offer the next actions: `/opsx:archive <name>` (merges spec deltas, updates the docs the proposal named), commit/push on request, and `/next-change` for what follows.
