---
name: propose-apply-verify
description: Drive one Shawarmania OpenSpec change from seeded proposal through implementation and an autonomous verify-fix-reverify loop, ending with an evidence-based report but not archiving. Use when the user asks to do a change end to end, propose/build/verify it, or invokes "/propose-apply-verify CHANGE".
---

# Propose, Apply, Verify

Take one named change from seed to implemented and independently verified in a
single run. Continue until all applicable checks pass or a genuine blocker
requires the user. Do not archive.

If the name is omitted, infer it only when unambiguous. Otherwise list active
changes and ask one concise selection question.

Announce:

```text
Driving change: <name> - propose -> apply -> verify
```

## Phase 0: Pre-flight

1. Read the proposal, especially its Gate and Model banner.
2. Treat a Claude model label as roadmap metadata. Do not claim it maps to or
   ranks against the active Codex model. Mention the prescribed source label
   when useful, then continue unless the user requested a particular model.
3. Inspect the branch and worktree. Preserve unrelated user changes and define
   the intended scope.
4. Establish a clean-enough baseline with the relevant tests before editing.
5. Read all applicable `AGENTS.md` instructions.

## Phase 1: Propose

Load and follow `$openspec-propose <name>`. If status already shows every
apply-required artifact complete, skip this phase and say so.

After artifacts are complete, run `npm run roadmap:sync` when available.

## Phase 2: Apply

Load and follow `$openspec-apply-change <name>`.

Implement every task, verify it, and mark it complete. Pause only for a genuine
design conflict, missing authority, required external state, or user
interruption. Record decisions in the correct artifact when they stay within
scope.

## Phase 3: Verify, Fix, Re-verify

Run verification as a loop:

1. Verify every applicable automated and experiential path.
2. Identify bugs, regressions, missing behavior, console errors, unexpected
   requests, and unproved Gate clauses.
3. Fix every in-scope issue.
4. Re-run the checks relevant to each fix.
5. Re-run the full applicable gates.
6. Repeat until green or genuinely blocked.

Do not stop at the first successful-looking result.

### Current Repository Gates

Read `AGENTS.md` and `.github/workflows/ci.yml` at execution time; they outrank
this summary if they changed.

For any change, run:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run contrast
npm run build
npm run test:e2e
```

When migrations, policies, or tables changed and Docker is available, run:

```bash
npm run db:start
npm run db:reset
npm run test:db
npm run test:rls
npm run test:e2e:auth
```

Run `test:e2e:auth` for changes under auth, shells, account menus, or any role's
index surface even when the change is not described as authentication work.

### Risk-specific Checks

- Billing or offline: go offline, ring bills, reconnect, and prove exactly-once
  settlement without duplicates.
- UI: inspect phone and tablet viewports in light and dark themes.
- Theme/token: inspect both themes and pass the contrast validator.
- `*-live`: prove the gate moved from `demo` to `live` and demo still works.
- Demo seam: prove the banner is permanent, deep links reload, and demo makes
  no real-data writes.
- Tenancy: prove every outlet-scoped table has RLS and cross-outlet requests
  fail at the database.
- Change Gate: prove every clause literally and name the evidence.

Use the most effective local browser-control skill when visual or interactive
verification is needed. Check console and network state as well as appearance.

### Loop Rules

- Fixes within the change's scope belong to this change.
- Put truly separate work in `openspec/todos/`; do not silently expand scope.
- Update tests when a legitimate contract changed, but never delete or weaken
  an assertion merely to get green.
- Prefer direct evidence. If a gate was not run, say why.
- Ask the user to verify only what cannot be done without real hardware,
  credentials, on-site presence, or another external dependency.

## Phase 4: Report

Report, in this order:

1. Verification steps a person would otherwise have performed.
2. What was completed autonomously and with which surfaces.
3. Issues found.
4. Fixes made.
5. Checks repeated after fixes.
6. Final result for every gate, one line each.
7. Remaining blockers or limitations, prefixed `USER:` when only the user can
   clear them.

Offer `$openspec-archive-change <name>`, commit/push on request, and
`$next-change` as possible next actions. Never archive automatically.
