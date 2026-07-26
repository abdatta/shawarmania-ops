# Tasks: project-foundations

> Groups 1–3 are the "scaffold half" — per the roadmap's Wave A note, `data-model-and-tenancy` (#2) may begin as soon as they are checked, without waiting for theme/PWA work.

## 1. Scaffold

- [x] 1.1 Initialize Vite + React 19 + TypeScript strict app at repo root, preserving existing `roadmap:sync` script and openspec tooling
- [x] 1.2 Add Tailwind CSS v4 and initialize shadcn/ui wired to CSS custom properties
- [x] 1.3 Add ESLint (flat config) + Prettier + `npm run lint` / `npm run format` / `npm run typecheck` scripts
- [x] 1.4 Create layer skeleton `src/routes|features|data-access|domain|outbox` with placeholder modules
- [x] 1.5 Enforce import boundaries in lint: only `src/data-access/` imports `@supabase/supabase-js`; `src/domain/` imports nothing outside itself
- [x] 1.6 Add `supabase init` local config, `.env.example` with only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, confirm `.env` gitignored; typed client factory in `src/data-access/`

## 2. Test harness

- [x] 2.1 Add Vitest + Testing Library wired into `npm test`, with a first passing test
- [x] 2.2 Add Playwright with a smoke test that builds, serves, and loads the shell
- [x] 2.3 Add CI workflow (GitHub Actions): install → lint → typecheck → test → build on every push/PR

## 3. Domain formatters

- [x] 3.1 Implement `formatPaise` (integer paise → `₹1,23,456` Indian grouping; zero/negative correct; non-integer throws) with unit tests
- [x] 3.2 Implement Asia/Kolkata date formatter via `Intl.DateTimeFormat` with explicit timeZone, with unit tests including a non-IST device zone case

## 4. Design system

- [x] 4.1 Create the single token source file: `brand.*` layer (only hex location) + `semantic.*` for light and dark per `docs/DESIGN_SYSTEM.md`, mapped into Tailwind v4 `@theme` and shadcn variables
- [x] 4.2 Pre-paint theme resolution: inline script reads localStorage → `prefers-color-scheme`, sets `data-theme`; manual toggle persists choice
- [x] 4.3 Self-host Latin-subset Lilita One + Nunito Sans Variable via Fontsource; verify no third-party font requests
- [x] 4.4 Add base components sized for counter use (56px tiles, 48px/44px controls, 16px inputs) with `tabular-nums` on money styles
- [x] 4.5 Add no-hex-outside-token-file check to lint/CI

## 5. Contrast validator

- [x] 5.1 Build Node validator parsing the token file, computing WCAG ratios for the semantic pairs of both themes, failing below AA
- [x] 5.2 Pin known cases: `#f97316` on white must fail; `#b91c1c` on `#14100b` must fail; prescribed substitutes must pass; wire into CI

## 6. PWA shell

- [x] 6.1 Empty role-agnostic app shell with React Router, theme toggle, and visible build version (git SHA + build time via Vite define)
- [x] 6.2 Add `vite-plugin-pwa`: manifest + icons (placeholder artwork if brand assets unavailable — record a `todos/` note), Workbox precache of the app shell
- [x] 6.3 Update-on-launch: registration checks for a new SW on launch and applies it on next load, never mid-use
- [x] 6.4 Playwright offline smoke: load, wait for SW install, go offline, reload, shell renders

## 7. Deployment (GitHub Pages)

- [x] 7.1 Make the app base-path aware: `BASE_PATH` env var (default `/shawarmania-ops/`), router `basename`, manifest `scope`, SW `navigateFallback`; E2E runs under the sub-path
- [x] 7.2 Emit `404.html` (copy of the shell) and `.nojekyll` at build time so deep links boot the SPA on rewrite-less hosting
- [x] 7.3 Add `.github/workflows/deploy.yml`: build with the Pages base path, publish via `actions/deploy-pages` on push to `main`
- [x] 7.4 Repo is public; Pages was provisioned automatically by `actions/configure-pages` on the first deploy, so no manual Settings change was needed
- [x] 7.5 Pushed to `main`; `https://abdatta.github.io/shawarmania-ops/` serves the shell and the footer build identifier matches the deployed commit (`055313d`)

## 8. Docs

- [x] 8.1 Update `docs/TESTING.md` to describe the real harness (commands, layout, contrast validator)
- [x] 8.2 Update `docs/OPERATIONS.md` with the real pipeline (hosting choice, CI steps, deploy/rollback path)
- [x] 8.3 Update `docs/DESIGN_SYSTEM.md` with any token that changed once measured on real hardware

## 9. Phase gate

- [x] 9.1 PHASE GATE: fresh clone → `npm install && npm test && npm run lint && npm run typecheck && npm run build` all green
- [x] 9.2 PHASE GATE: contrast validator passes in both themes in CI
- [x] 9.3 PHASE GATE: the empty app installs on a real Android phone and loads its shell with the network off — verified by the owner on real hardware
- [x] 9.4 PHASE GATE: a push to `main` deploys and the stable URL serves the new build identifier (`055313d`, both CI and Deploy workflows green)
- [x] 9.5 PHASE GATE: on the deployed URL, a deep link opened cold renders the app rather than GitHub's 404 page — `/reports/today` served the shell and routed client-side
