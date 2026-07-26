# project-scaffold — delta

## ADDED Requirements

### Requirement: Toolchain is green from a fresh clone

The repository SHALL build as a Vite + React 19 + TypeScript (strict mode) single-package project such that, from a fresh clone, `npm install`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all succeed with no additional setup.

#### Scenario: Fresh clone passes every script

- **WHEN** the repository is cloned onto a machine with only Node.js and npm installed and `npm install && npm test && npm run lint && npm run typecheck && npm run build` is run
- **THEN** every command exits zero

#### Scenario: Existing openspec tooling keeps working

- **WHEN** `npm run roadmap:sync` is run after the scaffold lands
- **THEN** it reconciles ROADMAP.md exactly as before, with no change to its behaviour

### Requirement: Layer skeleton with enforced import boundaries

The source tree SHALL contain the five layers from `docs/ARCHITECTURE.md` — `src/routes/`, `src/features/`, `src/data-access/`, `src/domain/`, `src/outbox/` — and lint SHALL enforce that only `src/data-access/` imports the Supabase client and that `src/domain/` imports nothing outside itself.

#### Scenario: A screen importing the Supabase client fails lint

- **WHEN** a file outside `src/data-access/` imports `@supabase/supabase-js` and `npm run lint` is run
- **THEN** lint exits non-zero, naming the restricted import

#### Scenario: Impure domain code fails lint

- **WHEN** a file in `src/domain/` imports a module from another layer and `npm run lint` is run
- **THEN** lint exits non-zero

### Requirement: Test harness covers unit, component, and end-to-end layers

The project SHALL run Vitest (with Testing Library) for unit and component tests and Playwright for end-to-end tests, all wired into `npm test` and CI.

#### Scenario: Vitest runs domain tests

- **WHEN** `npm test` is run
- **THEN** Vitest executes the test suite, including the formatter unit tests, and reports results

#### Scenario: Playwright smoke test runs against the built app

- **WHEN** the Playwright suite runs in CI
- **THEN** it builds the app, serves it, and verifies the shell loads

### Requirement: Continuous integration on every push and pull request

A CI workflow SHALL run install, lint, typecheck, unit tests, the contrast validator, the production build, and the Playwright smoke suite on every push and pull request, and a failure in any step SHALL fail the workflow.

#### Scenario: A failing check blocks the pipeline

- **WHEN** a commit that fails lint, typecheck, any test, or the contrast validator is pushed
- **THEN** the CI workflow reports failure

### Requirement: Supabase local development scaffold with safe configuration

The repository SHALL contain a committed Supabase local-development configuration and a `.env.example` documenting exactly the public client variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), with `.env` gitignored. No service-role key SHALL appear in any client configuration, example file, or committed file.

#### Scenario: Environment template documents only the public pair

- **WHEN** a developer inspects `.env.example`
- **THEN** it lists `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with explanatory comments and contains no service-role key or other secret

#### Scenario: Local environment files are not committed

- **WHEN** a `.env` file exists in the working tree
- **THEN** `git status` shows it as ignored
