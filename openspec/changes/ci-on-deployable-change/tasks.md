## 1. Name the prose set once, in both directions

- [x] 1.1 Add the `paths-ignore` list to `ci.yml`'s `pull_request` trigger: `docs/**`, `openspec/changes/**`, `openspec/specs/**`, `openspec/todos/**`, `.claude/**`, `*.md`. Record beside it that this is a denylist on purpose and that `openspec/tools/**` is deliberately absent.
- [x] 1.2 Add the same list to `deploy.yml`'s `push` trigger, leaving `workflow_dispatch` unfiltered so deliberate republication still works.
- [x] 1.3 Add `.github/workflows/docs.yml` (workflow name `Prose`): the same set as a `paths` allowlist, running `npm ci`, `format:check` and `lint:todos` and nothing else, with the reason each of those two applies to prose recorded in the file.

## 2. Prove the two filters are complements

- [x] 2.1 Replayed the last 80 commits through the lists **as actually written in the workflow files**, with the two glob shapes those lists use. Result: 27 prose-only, 10 full-suite-only, 43 both, **0 neither**. The coverage property holds on real history.
- [x] 2.2 Confirmed no commit reaching the prose-only tier touched `src/`, `supabase/`, `scripts/`, `e2e/`, `shared/`, `openspec/tools/` or `.github/`: zero leaks. The measured 27 differs by one from the estimate that motivated the change, and the difference is the carve-out working — a commit under `openspec/` that a naive `openspec/**` rule would have called prose takes the full suite because what it touched was code.
- [x] 2.3 Added `scripts/check-workflow-path-tiers.test.mjs` as a standing guard rather than trusting the one-off replay: it reads the three workflow files and fails when the lists stop being complements, when either names `openspec/**` or `openspec/tools/**`, or when `workflow_dispatch` loses its unfiltered trigger. Proved by deleting one entry — it failed naming the file, and that exact drift would have left a commit touching only `openspec/todos/` with no checks at all.
- [x] 2.5 **Unplanned, and the real find of this change: the first draft had a hole.** `docs.yml` triggered only on `pull_request`, while `ci.yml` covers pull requests and `deploy.yml` covers pushes to `main` — so a prose-only push straight to `main` matched no workflow at all and got zero checks. This repo pushes to `main` directly, so that was the common path, not a corner. The prose tier now declares both events, its path list written twice because GitHub supports no YAML anchors, and the test asserts event coverage as well as list equality. Proved by deleting the push trigger: two assertions failed by name.
- [x] 2.4 Unplanned, hit while writing 2.3: the same `import.meta.url` trap as the previous change, needing a different escape here. A test reading repo files resolves from `process.cwd()`, which the runner sets to the repo root; a check script resolves inside its CLI entry. Both shapes are now documented together.

## 3. Record the consequences

- [x] 3.1 `docs/TESTING.md`: the two tiers, what each gates, the `openspec/tools/` carve-out, and the standing test that keeps the lists complements. Also the `import.meta.url` rule from 2.4, now covering both escapes.
- [x] 3.2 `docs/OPERATIONS.md`: after a prose-only push there is no `Deploy` run and the build stamp names the last commit that changed the app, plus `workflow_dispatch` as the deliberate republication path.
- [x] 3.3 `AGENTS.md` and the quickfix skill: qualify the post-push check, which reads the deployed SHA and is now correct only for a commit that changed the app.
- [x] 3.4 Added the roadmap row at #37, Wave A — its only dependency is #1, and the roadmap's own convention is that late-discovered work often belongs early. Ran `npm run roadmap:sync`.

## 4. PHASE GATE

- [x] 4.1 **Gate**: met. The replay over the last 80 commits gives 27 prose-only, 10 full-suite-only, 43 both, **0 neither**, with no code reaching the prose-only tier; the standing test holds both filters complements across both events and was proved to fail on a deleted list entry and on a deleted push trigger. Ran `npm run lint` (clean; the 2 `react-refresh` warnings are pre-existing), `npm run typecheck`, `npm test` (77 files, 960 tests), `npm run format:check`, `npx openspec validate` and `npm run roadmap:sync`.
- [ ] 4.2 🧍 **Not verifiable locally: the tiers themselves.** Path filters are evaluated by GitHub, so the first push after this lands is the real proof. Expect a prose-only commit to show one `Prose` check and no `Deploy`, and a code commit to show the five checks it shows today.
