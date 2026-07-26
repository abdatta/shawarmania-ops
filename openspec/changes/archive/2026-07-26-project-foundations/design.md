# Design: project-foundations

## Context

The repo currently contains documentation, specs and the roadmap — no application code. This change turns it into a deployable, themed, installable PWA that is empty of features but real in every other respect: toolchain, CI, layer skeleton, token system, both themes, formatters, service worker, and push-to-`main` deployment. Every later change inherits the conventions fixed here.

Constraints that bind this design: components never contain hex literals (brand → semantic → component token layering); money is integer paise formatted only at the display edge; dates display in Asia/Kolkata; the service-role key never appears in client config; no third-party font or analytics CDN. `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `docs/TESTING.md` and `docs/OPERATIONS.md` are the authorities this design implements.

## Goals / Non-Goals

**Goals:**

- Fresh clone → `npm install && npm test && npm run lint && npm run typecheck && npm run build` all green.
- The layer skeleton (routes / features / data-access / domain / outbox) exists with import boundaries enforced by lint.
- Three-layer token system, light and dark themes, contrast validator in CI covering both.
- Money and date formatters as pure domain functions with tests.
- Installable PWA whose shell loads offline, with update-on-launch and a visible build version.
- CI on every push/PR; static deploy on push to `main`.

**Non-Goals:**

- No screens, no schema, no auth, no RLS (all later changes; schema is #2).
- No IndexedDB outbox — the folder exists as a boundary, the implementation is #9.
- No data caching beyond the app shell; no offline writes.
- No marketing-site motion, gradients-as-surfaces, or hero type (rejected in `docs/DESIGN_SYSTEM.md`).

## Decisions

### D1 — Single npm package, Vite + React 19 + TypeScript strict

One `package.json` at the repo root, npm as the package manager (the repo already runs `npm run roadmap:sync`; that script and the openspec tooling must keep working unchanged).

- **Rejected: pnpm/yarn workspaces or a monorepo split.** One deployable artifact, one team; a workspace adds indirection every later change pays for and buys nothing at this scale.
- **Rejected: Next.js.** Already rejected in `docs/ARCHITECTURE.md` — every screen is behind auth, and SSR complicates the offline story that is a hard requirement.

### D2 — Layer skeleton enforced with ESLint `no-restricted-imports` + boundary lint

Create `src/routes/`, `src/features/`, `src/data-access/`, `src/domain/`, `src/outbox/` with placeholder modules and enforce the two rules that matter now via ESLint flat config:

- Only `src/data-access/**` may import `@supabase/supabase-js`.
- `src/domain/**` may import nothing outside itself (pure functions, no I/O).

- **Rejected: dependency-cruiser or eslint-plugin-boundaries as a required gate.** More expressive, but another config dialect to maintain before there is any code to protect. The two restricted-import rules above catch the violations that actually break the architecture (a screen reaching for Supabase, impure domain code); richer boundary tooling can be adopted later if violations appear that lint cannot express.

### D3 — Tokens as CSS custom properties in Tailwind v4 `@theme`, one source file

All tokens live in one CSS file: `brand.*` (the only place hex literals are allowed) feeding `semantic.*` per theme, with the dark theme overriding semantic values under a `[data-theme="dark"]` selector. Components and Tailwind utilities read semantic tokens only. shadcn/ui components are wired to the semantic layer via its CSS-variable theming.

A lint/CI check greps `src/` (excluding the token file) for hex literals so the "no hex in components" rule is enforced, not documented.

- **Rejected: tokens in `tailwind.config.js` JavaScript.** Tailwind v4 is CSS-first; a JS config splits the token source of truth in two, and the contrast validator would need to evaluate JS instead of parsing one CSS file.

### D4 — Theme resolution before first paint, persisted manually

An inline script in `index.html` (runs before any bundle) reads `localStorage` for a stored choice, falls back to `prefers-color-scheme`, and sets `data-theme` on `<html>`. A toggle available from the shell writes the choice back. This is the only way to satisfy "no flash of the wrong theme" — React cannot fix what happens before it mounts.

- **Rejected: theme state in React context only.** Guarantees a flash of the default theme on a dark phone at night — explicitly called out as a failure in `docs/DESIGN_SYSTEM.md`.
- **Rejected: CSS-only `prefers-color-scheme`.** Cannot express a persisted manual override.

### D5 — Contrast validator as a Node script over the token file, run in CI

A small Node script parses the single token CSS file, resolves the semantic pairs that matter (content on canvas/surface, on-primary on primary, accent-text on canvas, danger/success/warning on their backgrounds, focus ring against surfaces) **in both themes**, computes WCAG ratios, and fails CI below AA (4.5:1 text, 3:1 non-text). The known failures it must catch are pinned as test cases: `#f97316` on white (2.8:1) and `#b91c1c` on `#14100b` (~2.9:1) must fail; the prescribed substitutes must pass.

- **Rejected: axe/Lighthouse on rendered pages.** There are no pages yet, and rendered-page audits check whatever happens to render, not the token contract. The token-level check is deterministic, runs in milliseconds, and gates _both_ themes on every push regardless of which screens exist.
- **Rejected: reviewer discipline.** `docs/DESIGN_SYSTEM.md` is explicit: computed, not eyeballed.

### D6 — Formatters are pure domain functions

`formatPaise(paise: number): string` → Indian-grouped rupees (`₹1,23,456`), handling zero and negatives; input is an integer, and a non-integer input throws rather than rounds — silently accepting a float would launder exactly the bug the paise rule exists to prevent. Date formatting goes through one function using `Intl.DateTimeFormat` with explicit `timeZone: 'Asia/Kolkata'`, never the runtime default zone. Tabular numerals are applied by the component layer (`font-variant-numeric: tabular-nums`), not by the formatter.

- **Rejected: a currency/date library (dayjs, date-fns-tz).** `Intl` covers both requirements natively; a dependency is a supply-chain and bundle cost with no capability gain here.

### D7 — Fonts self-hosted via Fontsource Latin subsets

`@fontsource/lilita-one` and `@fontsource-variable/nunito-sans`, importing only Latin subsets, bundled and served with the app. No font CDN — it is a privacy leak and a network dependency in an app that must load offline.

- **Rejected: Google Fonts CDN.** Explicitly banned in `docs/DESIGN_SYSTEM.md`.
- **Rejected: hand-subsetting font files into `public/`.** Fontsource delivers the same result with versioned updates and no bespoke build tooling.

### D8 — PWA via `vite-plugin-pwa` (Workbox), prompt-free update-on-launch

`vite-plugin-pwa` generates the manifest wiring and a Workbox service worker precaching the built app shell (hashed assets). Registration checks for a new service worker on every launch; a waiting worker is activated so the **next** load runs the new build — matching the `docs/OPERATIONS.md` mitigation exactly. No user-facing "update available" prompt at this stage: counter staff should not make deployment decisions.

- **Rejected: hand-rolled service worker.** Precache manifest generation, cache versioning and cleanup are exactly the code Workbox has already debugged; a bespoke SW is the highest-risk artifact in this change with the least payoff.
- **Rejected: `autoUpdate` with immediate reload.** Reloading the app mid-use is unacceptable on a counter; apply-on-next-load is the deliberate behavior.

### D9 — Build version injected at build time, visible in the shell

Vite `define` injects the short git SHA and build timestamp; the shell renders it unobtrusively (footer of the empty shell for now). This answers "what build is that tablet on?" over the phone and is load-bearing given SW caching, not cosmetic.

### D10 — CI on GitHub Actions; deploy to GitHub Pages on push to `main`

Two workflows. `ci.yml`: install → lint → format check → typecheck → test (Vitest) → contrast validator → build → Playwright. `deploy.yml`: build with the Pages base path and publish via `actions/deploy-pages`.

GitHub Pages, from a public repo, is chosen for the first phase because it needs no third-party account, no billing relationship, and no DNS work — the repo is already on GitHub, so "push to `main` deploys" costs one workflow file. A custom domain (and privatising the repo) comes later.

- **Rejected: Cloudflare Pages** (the original plan). Better hosting on every technical axis — real rewrites, edge caching, no sub-path constraint — but it is another account to create and connect before anything can be seen. Nothing in this change needs what it adds, and moving to it later is a workflow file plus DNS.
- **Rejected: Vercel.** Same reasoning.

Three consequences of Pages that the code has to absorb, and they are the whole reason this is a design decision rather than a config detail:

**A project repo serves from `/<repo>/`, not the root.** So `base` is `/shawarmania-ops/` and everything downstream must respect it: the router `basename` reads `import.meta.env.BASE_URL`, the manifest `scope` and `navigateFallback` are built from `base`, and asset URLs in `index.html` stay root-absolute so Vite rewrites them. `base` comes from a `BASE_PATH` env var defaulting to the sub-path, so a custom domain is `BASE_PATH=/` at build time and no code edit. The default is the *production* value deliberately: `npm run build` should produce a deployable artifact, not one that only works locally.

**Pages has no rewrite rules**, so a deep link is a real 404 from static hosting. A build step copies `dist/index.html` to `dist/404.html`, which Pages serves for unmatched paths; the SPA then boots and routes the URL itself. A `.nojekyll` marker ships alongside it.

**The E2E suite runs under the production base path**, not the root. Base-path mistakes — a stale absolute asset URL, a router basename left at `/` — are invisible at the root and fatal on Pages, so the suite has to exercise the real shape. Specs navigate with relative URLs, and one test asserts no request 404s.

Playwright smoke test (the offline gate, automated): build, serve preview, load the shell, verify the service worker activates, set the browser context offline, reload, and assert the shell still renders. The real-Android-phone check remains a manual gate item.

### D12 — Palette: "Stone & Ember", chosen from five candidates

The first pass took the marketing palette literally — cream canvas, `#f97316` primary, warm brown ink — and read as the storefront rather than as an ops portal. Five candidate palettes were built and each validated against this change's own contrast checks before being shown: a near-neutral **Slate**, a high-contrast **Paper & Ink**, a **Graphite & Gold**, an accounting-green **Ledger**, and **Stone & Ember**. Stone & Ember was selected.

It is a warm neutral scale carrying one brand accent. Warm rather than grey so the portal still reads as related to the storefront; far less saturated than cream so a table can be read against it for a whole shift.

The substantive change is the primary colour. `#f97316` on white is 2.8:1, which is why the previous iteration needed a dark ink border on every primary button just to give the control a legible boundary. **Stone & Ember deepens the brand orange once, in the brand layer**, to `#c2410c` — 5.2:1 against a card, carrying plain white text — and the per-component workaround disappears. The full-strength brand orange is still used at full strength in dark mode, where it has a dark ground and reaches 6.2:1.

The general rule this is an instance of: **when a token needs a per-component workaround, fix the token.** The validator encodes it — the button check now reports "via `--primary`" in both themes, and a test asserts it, so reintroducing a border-propped button fails CI.

- **Rejected: Slate / Paper & Ink.** Both are cleaner as pure admin design, and both discard the brand entirely. For a franchise business selling a branded product, a portal a franchisee cannot recognise is a real cost.
- **Rejected: Graphite & Gold, Ledger.** Both good; neither is Shawarmania. Recorded so the option is easy to revisit rather than re-derived.

### D11 — Supabase local scaffold only

`supabase init` config committed; `.env.example` documents exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public pair — nothing else exists client-side, per `docs/OPERATIONS.md`); `.env` gitignored. `@supabase/supabase-js` is installed and a typed client factory lives in `src/data-access/`, but **no schema, no migrations, no queries** — that is #2. RLS, money arithmetic beyond the formatter, and offline semantics are all explicitly out of scope here; this change only fixes where they will live (domain and data-access layers, outbox folder).

## Risks / Trade-offs

- **[A bad deploy persists on a tablet that never refreshes]** → update check on launch + visible build version are both gate items, not optional; verified in the Playwright smoke test and on real hardware.
- **[Tailwind v4 + shadcn/ui integration is newer than most guides]** → pin versions; verify the shadcn CSS-variable theme maps onto the semantic layer before generating many components; only a handful of base components ship in this change, so a mapping problem is cheap to fix now.
- **[Contrast validator drifts from the real token file]** → the validator parses the _same_ CSS file the app imports; there is no second token list to fall out of sync. Pinned known-failure cases keep the math honest.
- **[React 19 ecosystem edges (testing-library, Playwright)]** → all pinned; the surface in this change is tiny (empty shell), so incompatibilities surface immediately, not mid-feature.
- **[The repo has to be public for free Pages hosting]** → Pages from a *private* repo needs a paid GitHub plan. Privatising later therefore means either paying for it or moving hosts at the same time. Recorded so the later decision is made knowingly rather than discovered.
- **[Publishing the repo publishes `docs/`]** → the wiki carries real business contact details (outlet phone, FSSAI licence numbers). These are already publicly displayed by the business, so this is disclosure of public facts rather than a leak, but it becomes greppable. No customer or employee data is in the repo, and `.env` is gitignored.
- **[The base path is a footgun]** → a hard-coded `/asset` works locally at the root and 404s on Pages. Mitigated by making the sub-path the *default* base and running E2E under it, so the failure surfaces in CI rather than on a tablet.
- **[Moving to a custom domain later]** → the origin changes, so every installed PWA has to be reinstalled regardless; the base-path flip rides along with a migration that was already disruptive. `BASE_PATH=/` is the only code-side change.

## Migration Plan

Greenfield — nothing to migrate. Deploy path: make the repo public, set Pages' source to GitHub Actions, push to `main`, then confirm the deployed URL serves the shell, the build identifier matches the commit, and the PWA installs. Rollback is re-running the deploy workflow on a previous commit.

### D13 — One icon master, everything else derived

`assets/brand/shawarmania-mark-512.png` — the same mark the Shawarmania site serves — is committed as the source of truth, and `npm run icons:generate` derives every size in `public/icons/` from it. Changing the app's icon is replacing one file and re-running the script.

Deriving rather than hand-exporting matters for the **maskable** variant specifically. The mark has transparent rounded corners; Android crops a maskable icon to its own shape, so shipping the mark as-is would clip its edges. The generator composites it full-bleed onto its own field colour with the art inset to the 80% safe zone, and the field colour is *sampled from the master* rather than hard-coded, so it cannot disagree with the artwork later. (It samples as `#14100b`, which is `--brand-bg` — the mark and the token set already agreed.)

- **Rejected: `sharp` or another image library.** A large native dependency for one build-time step, and one more thing to install before `npm run icons:generate` works for the next person.
- **Rejected: committing hand-exported PNGs with no generator.** Works until someone needs a new size or a tweaked mark, at which point the derivation lives in whoever did it last.

The trade is a hand-written PNG reader/writer and resampler in `scripts/lib/png.mjs`. Scope is narrow (8-bit RGBA, non-interlaced — what the master is) and it throws clearly on anything else rather than decoding subtly wrong. It is round-tripped by tests, because a codec bug shows up as a corrupted icon on a home screen rather than as a failure.

## Open Questions

- **Custom domain**: deferred. When it happens, set `BASE_PATH=/` in `deploy.yml`, add the `CNAME`, and expect installed devices to reinstall because the origin changed.
