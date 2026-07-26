# Proposal: project-foundations

> **Model**: Opus · **Wave**: A · **Depends on**: — · **Gate**: fresh clone → `npm install && npm test && npm run lint && npm run typecheck && npm run build` all green; contrast validator passes in **both** themes; the empty app installs on a real Android phone and loads its shell with the network off; a push to `main` deploys.

## Why

Turns a documentation repo into a deployable, themed, installable application — empty of features, but real in every other respect. It fixes the conventions every later change inherits, so the cost of getting it wrong is paid thirteen more times.

Bundling the scaffold, the theme and the PWA shell is deliberate: none of them is independently useful, and all three are prerequisites for the first thing that ships (attendance, in Wave B).

## Scope

**Scaffold** — Vite + React 19 + TypeScript in strict mode. Tailwind v4 and shadcn/ui. Vitest and Playwright. Lint, format, typecheck, and a CI workflow running all of them. Supabase local dev and `.env.example`. `npm run roadmap:sync` wired up. The layer skeleton from `docs/ARCHITECTURE.md` — routes / features / data-access / domain / outbox — with import boundaries enforced by lint where practical.

**Design system** — the three-layer token system from `docs/DESIGN_SYSTEM.md` (`brand.*` → `semantic.*` → components). Light and dark themes, including the deliberate primary-colour difference. Theme follows system preference with a manual toggle that persists, and no flash of the wrong theme before first paint. **A contrast validator in CI covering both themes** — `#f97316` on white is 2.8:1 and fails AA, and the three rules that follow from it are enforced, not documented and forgotten. Base components sized for counter use (56px tiles, 48px controls, 16px inputs). The money formatter (paise → Indian-grouped rupees) and the Asia/Kolkata date formatter, both with tabular numerals. Self-hosted Latin-subset Lilita One and Nunito Sans — no font CDN.

**PWA and deployment** — manifest, icons, install handling. Service worker caching the app shell with an update check on launch. A visible build version, so "what build is that tablet on?" is answerable over the phone. Static deployment on push to `main`.

## Non-goals

- No screens, no schema, no auth.
- No data caching or offline writes — the outbox is #9.
- No marketing-site motion, gradients-as-surfaces, or hero type. Explicitly rejected in `docs/DESIGN_SYSTEM.md`.

## Watch out for

A bad deploy can persist on a tablet that has not refreshed. Update-on-launch and the visible build version are both load-bearing, not nice-to-haves.

## Docs to update before archiving

`docs/TESTING.md`, `docs/OPERATIONS.md` (real pipeline), `docs/DESIGN_SYSTEM.md` (any token that changed once measured on real hardware).
