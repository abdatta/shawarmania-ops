# Proposal: demo-mode-and-app-shell

> **Model**: Fable · **Wave**: A — **the delivery keystone** · **Depends on**: #1, #2 · **Gate**: all four role shells navigable in demo mode with a working role switcher; **a demo session provably cannot write to Supabase**; a real signed-in user cannot silently enter demo mode; the demo banner is never dismissible; a mock that drifts from schema types fails to compile; deep links survive reload.

## Why

The contract that makes UI-first delivery possible, plus the shell every screen is built inside. Both halves are inherited by all eleven remaining changes, which is why they get the same design care as the schema — a bad seam here means rewriting every screen twice.

They are one change because they are one decision: the shell is where gating, the session provider and the role switcher actually surface. Building the shell without knowing how surfaces gate would mean rebuilding it.

## Scope

**The adapter seam** — one typed interface per domain area, with two implementations: `SupabaseAdapter` (real) and `MockAdapter` (fixtures). Screens depend on the interface, never on either implementation. Mocks are **typed from the generated schema types**, so a fixture the database could not serve is a compile error rather than a demo that quietly lies.

**The gate registry** — every surface is `hidden`, `demo`, or `live`, declared in one place so the state of the product is readable at a glance.

**The session provider** — a real Supabase session, or a demo session with an instant **role switcher**. Flipping between the four roles without signing out is what makes a walkthrough compelling, and it is why demo mode needs no auth at all.

**The shell** — four role shells (Super Admin, Franchise Admin, Biller tablet-first with fixed chrome, Employee near-empty by design). Routing with deep links that survive reload. The theme toggle on every screen. Gate-aware navigation: a `hidden` surface is **absent**, not greyed out — a half-visible product looks unfinished in a way an absent one does not. Shared layout primitives every later surface uses: page header, data table, empty state, form sheet, confirm dialog.

## Non-goals

- No feature surfaces.
- No auth (#4). Demo mode deliberately needs none — that is what lets the demo exist before auth does.

## Safety requirements — not optional

Demo mode ships to production so it can be shown from a deployed URL. That makes these load-bearing:

- **A demo session must be structurally incapable of writing to Supabase**, not merely discouraged. Prove it with a test that fails if a write escapes.
- **A real signed-in user must never enter demo mode by accident.** A biller who wandered into a demo and rang fake bills would be a genuine operational problem.
- **The demo indicator is always visible and cannot be dismissed.** This protects the business as much as the viewer: nobody should be able to screenshot mocked figures and present them as real trading data.

## Design questions to settle during `/opsx:propose`

- **Query param or route prefix?** A dedicated `/demo/*` prefix makes accidental mixing structurally impossible rather than guarded against, and produces a clean shareable link. Weigh it against the simpler flag and record the reasoning.
- Adapter granularity — one interface per domain area, or per screen? Too coarse and mocks become monolithic; too fine and there are forty of them.
- Whether the gate registry is a build-time constant, runtime config, or both.
- Bottom navigation versus a drawer on phones, tested against one-handed use.

## Docs to update before archiving

`docs/DEMO_MODE.md`, `docs/ARCHITECTURE.md`, `docs/SCREENS.md`.
