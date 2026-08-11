## 1. Build the index invariant

- [ ] 1.1 Add a pure, read-only living-spec drift rule plus CLI entry under `scripts/`, counting direct `openspec/specs/<capability>/spec.md` files and relative capability links in `openspec/specs/README.md`.
- [ ] 1.2 Report both drift directions with exact names: a capability directory no index link mentions and an index capability link whose directory or `spec.md` is gone.
- [ ] 1.3 Add unit coverage for missing, dangling, complete, non-capability-directory, unrelated-link, and no-write cases, following the tested pure-function shape of the behaviour-backlog checker.
- [ ] 1.4 Prove the real repository check fails against the current incomplete README before reconciliation and names all current omissions.

## 2. Reconcile the living-spec map

- [ ] 2.1 Replace the historical landing groups in `openspec/specs/README.md` with one alphabetical list linking every current capability and carrying an accurate hand-authored one-line summary.
- [ ] 2.2 Remove the stale `Expected capabilities` forecast and point future-work readers to the reconciled roadmap instead.
- [ ] 2.3 Run the checker against the reconciled repository and require zero missing and zero dangling capabilities without generating or rewriting markdown.

## 3. Gate both verification tiers

- [ ] 3.1 Add `lint:specs` to `package.json` and invoke it from `npm run lint` alongside the other repository-invariant checks.
- [ ] 3.2 Add the same command to `.github/workflows/docs.yml`, updating the job name and comments so a prose-only archive is gated by formatting, the backlog index, and the living-spec index.
- [ ] 3.3 Extend workflow/invariant tests where needed to prove the prose tier invokes both index checks and the full/prose path filters remain exact complements.
- [ ] 3.4 Prove each checker test and the real-tree failure would fail without its implementation, then passes with the index reconciled.

## 4. Keep documentation and backlog honest

- [ ] 4.1 Update `docs/TESTING.md` and the mirrored verification description in `AGENTS.md` to name `lint:specs` as the fourth repository-invariant check and describe its prose-tier coverage.
- [ ] 4.2 Remove `specs-readme-index-has-drifted.md` from the active backlog and move its row to Graduated / Absorbed, naming this change and its permanent checker.

## 5. Verification

- [ ] 5.1 Run the new checker test file directly, `npm run lint:specs`, `npm run lint:todos`, and the workflow path-tier tests.
- [ ] 5.2 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [ ] 5.3 Confirm no application runtime, build artifact, migration, policy, gate, demo seam, or roadmap row changed and `npm run roadmap:sync` leaves `ROADMAP.md` unchanged.

## 6. PHASE GATE

- [ ] 6.1 **Non-roadmap gate**: the living-spec README links every and only current capability, carries no stale future forecast, the checker names both missing and dangling drift, and both normal lint and the prose-only workflow enforce it.
