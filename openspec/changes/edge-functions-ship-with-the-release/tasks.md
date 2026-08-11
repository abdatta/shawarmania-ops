# Tasks: Edge Functions Ship With The Release

## 1. The release deploys functions

- [x] 1.1 Add a `functions` job to `.github/workflows/deploy.yml`: `needs: migrate`, its own `production-functions` environment, deploying every function with no name given and without `--prune`.
- [x] 1.2 Derive the project reference from `VITE_SUPABASE_URL` and fail the job when it is absent or carries no resolvable reference, rather than deploying to a default project.
- [x] 1.3 Make `deploy` depend on `functions` as well as `gate`, `build` and `migrate`, so a failed function deploy leaves the published build live.
- [x] 1.4 Skip the deploy step on `workflow_dispatch`, matching the migration's stance that a manual republication reverses nothing.
- [x] 1.5 Correct the `migrate` job comment, which currently claims a bundle cannot reach staff phones while production is missing a function it calls.

## 2. A function cannot ship without its gateway configuration

- [x] 2.1 Add `scripts/check-edge-functions.mjs`: a pure exported rule plus a CLI entry, matching the shape of `check-todos-index.mjs`.
- [x] 2.2 The rule fails when a directory under `supabase/functions/` other than `_shared` has no `[functions.<name>]` block in `supabase/config.toml`, and names every offender.
- [x] 2.3 Add `scripts/check-edge-functions.test.mjs` covering: all declared passes, an undeclared function fails, `_shared` is not a function, a commented-out block does not count as a declaration.
- [x] 2.4 Wire it into `lint` as `lint:functions`, so the one verification definition carries it to both the pull-request and the deployment path.
- [x] 2.5 Prove it fails on today's tree with a function's block removed, then passes with it restored.

## 3. The tablet path stops blaming the wrong thing

- [x] 3.1 In `src/data-access/supabase-adapters/counter.ts`, replace `?? 'unavailable'` with the three-way classification: transport evidence to `unavailable`, a named reason to itself, anything else to `unsendable`.
- [x] 3.2 Add the `unsendable` message to `MESSAGES`, reusing the wording `attendance-position-free-commands` established rather than inventing a second one.
- [x] 3.3 In `src/data-access/auth.ts`, stop funnelling every non-transport failure in `setUpCounterDevice` into `invalid_code`: keep `invalid_code` and `tablet_exists` for the reasons the function names, and classify an unrecognised or absent reason as `unsendable`.
- [x] 3.4 Confirm `setup_failed`, raised before the code is examined, no longer reads as a dead code.
- [x] 3.5 Leave `FunctionsFetchError` and the Auth retryable-with-no-status path classified exactly as `unreachable-backend-sign-in-error` (#30) left them.

## 4. Tests that would have caught it

- [x] 4.1 In `src/data-access/auth.test.ts`: a 404 from the setup endpoint reports `unsendable` and not `invalid_code`; `setup_failed` reports `unsendable`; `invalid_code` and `tablet_exists` are unchanged; a fetch failure is still `unavailable`.
- [x] 4.2 Add a counter adapter test file covering the same three-way split for `issueSetupCode`, including the gateway's real 404 body shape `{"code":"NOT_FOUND","message":"..."}`.
- [x] 4.3 Assert the enumeration property directly: the refusals a code can produce all yield one identical message, so a later branch cannot pull them apart unnoticed.
- [x] 4.4 Extend `scripts/check-workflow-path-tiers.test.mjs`, or add alongside it, an assertion that `deploy` depends on `functions` and that `functions` depends on `migrate`, so the ordering cannot be quietly reversed.
- [x] 4.5 Prove each new test fails without its fix, by reverting the fix and re-running, not by reasoning about it.

## 5. Docs stop enumerating

- [x] 5.1 `docs/OPERATIONS.md` step 4: one command that deploys every function, no function names, plus the statement that the release does this on every push and the manual command is for bootstrapping.
- [x] 5.2 Extend the existing `redeem-invite` 400-not-401 verification instruction to cover every function declared token-free, naming `counter-setup`.
- [x] 5.3 Record the `SUPABASE_ACCESS_TOKEN` secret and its `production-functions` environment alongside the existing `SUPABASE_DB_URL` entry.
- [x] 5.4 Update the username-migration runbook's three-function deploy block, which enumerates the same stale list.
- [x] 5.5 Add `lint:functions` to the verification list in `AGENTS.md` and `docs/TESTING.md`, in the same change that adds it to CI, as that list requires.

## 6. Verification

- [x] 6.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [x] 6.2 Confirm the deployed-function probe against production now distinguishes the two states honestly: re-run the 404 probe and check the app reports an unsendable action rather than a connection problem.
- [x] 6.3 Walk the Tablets surface in the browser on a phone viewport, both themes, with the endpoint failing, and read the message a person actually sees.
- [x] 6.4 Confirm no roadmap row was added and `npm run roadmap:sync` leaves ROADMAP.md unchanged.
- [x] 6.5 🧍 State plainly in the report what the owner must do that this change cannot: add the access token, and deploy the two missing functions once to unblock the counter today.
