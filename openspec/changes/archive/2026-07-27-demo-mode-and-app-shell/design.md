# Design: demo-mode-and-app-shell

## Context

`project-foundations` (#1) left a themed, deployable PWA scaffold: routing with
a GitHub Pages deep-link fallback (`404.html` + SPA boot), theme
resolution before first paint, the token layer with a contrast gate, an eslint
boundary that already stops any file outside `src/data-access/` from importing
the Supabase client, and a role-agnostic `RootLayout` waiting to be replaced.
`data-model-and-tenancy` (#2) left the full schema, RLS, seeds for both real
outlets and the real seven-item menu, and generated TypeScript types
(`src/data-access/database.types.ts`) with a CI drift gate.

This change is the delivery keystone: the adapter seam, the gate registry, the
session provider with a demo role switcher, and the four role shells. All
eleven remaining changes inherit it, which is why the seam gets the same design
care as the schema. It also carries hard safety requirements, because demo mode
ships to production: a demo session must be **structurally incapable** of
writing to Supabase, a real signed-in user must never enter demo mode
silently, and the demo indicator must never be dismissible.

Constraints that bind decisions below:

- Screens depend on typed adapter interfaces, never on the Supabase client
  (AGENTS.md; already lint-enforced for the client import itself).
- Mocks are typed from the generated schema types, so a fixture the database
  could not serve fails to compile.
- A `hidden` surface is absent from navigation, not greyed out.
- Auth is #4's job. Demo mode deliberately needs none — that is what lets the
  demo exist before auth does. This change must not build sign-in flows.
- Mock people are invented; the two real outlets and the real menu are public
  business facts and fine to use.

## Goals / Non-Goals

**Goals:**

- The adapter seam: the granularity convention, the machinery (context,
  factory keyed by session mode), and one exemplar domain adapter (`outlets`)
  with both implementations, proving the pattern end to end.
- The gate registry: every surface from `docs/SCREENS.md` declared in one
  typed, build-time module with a state of `hidden`, `demo`, or `live`.
- The session provider: a discriminated union over `real` and `demo`, with an
  instant four-role switcher in demo mode.
- Four role shells — Super Admin, Franchise Admin, Employee (phone-first,
  bottom tabs), Biller (tablet-first, fixed chrome) — with gate-aware
  navigation, the theme toggle in every shell's chrome, and deep links that
  survive reload.
- Shared layout primitives every later surface uses: page header, data table,
  empty state, form sheet, confirm dialog.
- The safety net, tested: demo cannot write to Supabase (structural + runtime
  + network-level proof), real sessions cannot slip into demo, the banner is
  never dismissible, a drifted mock fails to compile.

**Non-Goals:**

- No feature surfaces (billing counter, inventory, cash… are #6–#8). Each
  role's demo home is a thin overview built from the layout primitives — proof
  of the seam, not a dashboard.
- No auth flows, no session persistence for real users beyond what
  supabase-js already does (#4).
- No further domain adapters — each `ui-*` change defines the interface its
  screens need, against real screen requirements rather than imagined ones.
- No scenario dataset reconciliation (that is #8's whole job). Fixtures here
  are per-domain and honest, not yet cross-consistent.
- No offline outbox work (#9). Nothing in this change touches counter writes.

## Decisions

### D1 — Demo is a route prefix, and the demo role lives in the URL

Demo mode is `/demo/:role/*` — e.g. `/demo/owner/dashboard`,
`/demo/admin/menu`, `/demo/counter/billing`, `/demo/staff/home`. Real mode
mounts at the root (`/owner/…`, `/admin/…` when #4 lands). The two trees are
separate React Router branches with separate provider stacks; the demo branch
constructs only mock adapters (D4).

Choosing the prefix over a query flag settles the proposal's first question:

- **Structural, not guarded.** A flag (`?demo=1`, context boolean, storage
  key) makes "am I in demo?" a runtime condition every data path must check —
  and one forgotten check is a silent leak between modes. A route prefix makes
  mixing *unrepresentable*: the real tree and the demo tree never render at
  the same time, and the demo tree simply has no Supabase-bearing providers.
- **A clean shareable link.** `…/demo/owner` in a WhatsApp message is the
  franchise-sales artefact the roadmap keeps invoking.
- **Deep links and reload for free.** Putting the demo *role* in the path
  (rather than in a store) means a reload of `/demo/admin/inventory`
  reconstructs the whole session from the URL — no storage, no hydration
  order, nothing to get wrong. The role switcher is just navigation between
  prefixes, which also makes it trivially testable.

*Rejected: query param / context flag.* Guarded rather than structural, and
every guard is a future bug. *Rejected: separate demo build or separate
deploy.* Strongest isolation, but doubles hosting and CI, splits the QR-code
URL story, and the roadmap explicitly wants one deployed URL where demo and
(later) real coexist.

Role path segments are `owner`, `admin`, `counter`, `staff` — short, and they
match how the business talks about the people rather than the internal enum
(`super_admin`, `franchise_admin`, `biller`, `employee`), keeping shared links
readable.

### D2 — Adapter granularity: one interface per domain area; this change ships the machinery plus one exemplar

The seam is one TypeScript interface per domain area, matching the feature
folders and `docs/DATA_MODEL.md`'s domains: `outlets`, `menu`, `billing`,
`inventory`, `expenses`, `cash`, `attendance`, `staff`, `alerts`, `devices`.
Per-screen interfaces would mean forty of them and mocks assembled per screen;
one monolithic interface would make every `*-live` change touch every mock.
Per-domain matches how `*-live` changes are actually scoped on the roadmap
(#10 billing, #11 expenses+inventory, #12 cash, #13 owner console).

**This change ships the machinery and exactly one domain adapter** —
`OutletsAdapter` (list/get outlets), with both `MockOutletsAdapter` and
`SupabaseOutletsAdapter` implementations — because the shells themselves need
outlet names, and because an untested pattern is not a pattern. The remaining
interfaces are deliberately *not* designed now: an interface designed before
its screen exists is exactly the "screens the data model cannot serve"
failure inverted. Each `ui-*` change adds its interface plus mock; each
`*-live` change adds/wires the Supabase implementation.

Mechanics:

- `src/data-access/adapters.ts` defines `DataAdapters` (the bag of domain
  interfaces — one member today, growing per `ui-*` change).
- `src/data-access/mock/` holds mock implementations and fixtures;
  `src/data-access/supabase-adapters/` holds real ones. Fixtures are typed
  from the generated schema types (`Tables<'outlets'>` …), so drift is a
  compile error.
- A React context (`AdaptersProvider`) supplies `DataAdapters` to features.
  The demo branch always constructs mocks; the real branch always constructs
  Supabase adapters. There is no mode parameter on a shared factory — a
  factory that takes `'demo' | 'real'` is a guard again (D1's lesson), so
  instead each branch imports only its own factory.

*Rejected: per-screen adapters* (mock explosion, no reuse across screens that
share a domain). *Rejected: one big `AppAdapter`* (every `*-live` change
rewires everything; mocks become monolithic). *Rejected: defining all ten
interfaces now* (designing against imagined screens; the seam's value is that
interfaces crystallise from real screen needs).

### D3 — The gate registry is a build-time typed constant

`src/gates/registry.ts` declares every surface from `docs/SCREENS.md` with its
role, path, nav metadata, and state — `hidden` | `demo` | `live` — in one
file. Navigation and routing *derive* from the registry: `hidden` surfaces
produce no nav entry and no route in demo mode; `demo` surfaces render only
under `/demo`; `live` surfaces (none yet) render in both trees.

Build-time constant, not runtime config:

- The state of the product is a property of a *release*. Promoting a gate is
  the visible outcome of a `*-live` change — a reviewed diff on one line of
  one file, exactly as the proposal wants ("readable at a glance").
- Runtime config adds a fetch, a failure mode, and a way for production to
  disagree with the repo — all cost, and the only benefit (flipping a surface
  without deploying) is something this project explicitly does not want:
  gates move via changes, not toggles.
- A typed constant lets the registry drive types: `SurfaceId` is a union, and
  a route or nav item referencing a surface that does not exist fails to
  compile.

*Rejected: runtime config (DB table / JSON fetch)* — drift and failure modes
for an anti-feature. *Rejected: env-var overrides per environment* — same
reasoning; the demo deploy and the real deploy are the same build by design.

At the end of this change the registry holds each role's home surface in
`demo` and every other surface `hidden` — which is an honest statement of
what the product is today.

### D4 — Demo write-incapability is layered: structural first, then tripwire, then network proof

The requirement is "structurally incapable, with a test that fails if a write
escapes". Four layers, cheapest first:

1. **Structural — no path to the client.** The demo branch's provider stack
   imports only `src/data-access/mock/`. Mock adapters are plain objects over
   fixtures; the module graph under `/demo/*` never reaches
   `src/data-access/supabase.ts`. An eslint `no-restricted-imports` rule adds
   teeth: nothing under `src/data-access/mock/**` (or `src/demo/**`) may
   import the Supabase client module or `supabase-adapters/`.
2. **Runtime tripwire.** The demo root layout marks a module-level demo scope
   on mount (cleared on unmount); `getSupabaseClient()` **throws** when
   called inside demo scope. Sound because the route split (D1) guarantees
   the two trees never coexist in one document. This converts "someone later
   wires a real adapter into the demo tree by mistake" from a data leak into
   an immediate, loud crash in dev, test and CI alike.
3. **Unit proof.** A Vitest test mounts the demo tree, exercises every mock
   adapter method (including every write), and asserts (a) a spied global
   `fetch` saw zero requests, and (b) `getSupabaseClient` throws while demo
   scope is active.
4. **End-to-end proof.** A Playwright spec walks all four demo role shells
   with a route interceptor that **fails the test on any request** leaving
   the app origin (Supabase or otherwise, static assets excepted). This is
   the network-level restatement of the roadmap gate.

*Rejected: relying on RLS / anon key limits.* RLS protects real data from
real sessions; it is not a statement about what the demo bundle can attempt.
The requirement is about the client's structure, not the server's defences.
*Rejected: a mode flag consulted inside one shared adapter factory* — a
guard, not a structure; see D1/D2.

(For completeness: no RLS policies, money arithmetic, or offline semantics
change in this change. Mock fixtures store money as integer paise like the
schema they are typed from, and render through the existing formatter.)

### D5 — A real session gates demo entry behind an explicit interstitial

Entering any `/demo/*` URL while a Supabase auth session is present in
storage renders a full-screen interstitial *instead of* the demo shell: it
names the signed-in state, states that demo shows fabricated data, and offers
two explicit actions — "Continue to demo" (proceed for this tab; the choice
is held in `sessionStorage`, so it does not outlive the tab and never
silently sticks) or "Back to the app". No auth flows exist until #4, so today
the check reads supabase-js's persisted session directly (`getSession()`);
the guard and its test land now so #4 inherits a working gate rather than a
TODO.

The reverse direction needs no guard: demo mode issues no credentials, so
there is nothing a demo session could leak *into* real mode; leaving `/demo`
simply unmounts the demo tree.

*Rejected: silently allowing it* — the proposal names a biller ringing fake
bills as a real operational hazard. *Rejected: forcing sign-out to enter
demo* — hostile to the legitimate case (the owner demonstrating the product
from their own signed-in phone), and sign-out is a real action with real
consequences taken to satisfy a navigation whim.

### D6 — The demo banner is chrome, not state

Every demo shell renders a persistent banner strip ("Demo — fabricated data",
with the role switcher beside it) as an unconditional part of the demo
layout component. It has no close affordance, no state, no prop that hides
it; the only way to remove it is to leave `/demo`. It is `position: fixed`
company: part of the shell frame (like the Biller chrome), not a toast or
dialog. Tests assert its presence on every demo route and the absence of any
dismiss control.

On the Biller shell — fixed chrome, every pixel budgeted — the banner is a
slim strip in the fixed header region rather than a floating overlay, so it
can never occlude the settle button; "never dismissible" and "never in the
way of taking money" are both load-bearing.

### D7 — Phone roles get bottom tabs; the Biller gets fixed tablet chrome

Franchise Admin, Super Admin and Employee shells use a **bottom tab bar** on
phone widths: one-handed reach (the proposal's stated test), always-visible
state, and no gesture conflict with browser back. The registry drives the
tabs; at most five entries, and when a role later exceeds that, the fifth
becomes "More" (that decision is recorded now so #7 does not improvise).
On tablet/desktop widths the same registry renders as a left rail — same
data, different arrangement.

The Biller shell is its own layout: landscape tablet, fixed header (outlet
name, shift placeholder, sync indicator placeholder, theme toggle, demo
banner strip), fixed content region, nothing that scrolls unexpectedly.
It deliberately shares layout primitives but not the phone nav.

The Employee shell is near-empty by design: home and (later) my-attendance.
It still gets the full shell treatment — it is the role most people in the
business will hold.

*Rejected: a drawer* — two hands or a reach to the top corner, hides
navigation state, and the roadmap's manager personas live on phones. 

### D8 — One set of shell components, two provider stacks

The four shell layouts, nav components, and layout primitives are shared
modules consuming `SessionContext` (role, outlet, display name) and
`AdaptersContext`. The demo branch wraps them in `DemoSessionProvider`
(role parsed from the URL, persona fixtures, mock adapters); the real branch
will wrap the same components in providers built by #4. What this change
ships for the real branch is deliberately thin: `/` renders a minimal landing
("sign-in arrives with auth-and-roles") with a prominent link into the demo.
No route yet mounts the real shells, but because demo mode exercises the same
shell components, #4 wires providers rather than building UI.

Session shape:

```ts
type Session =
  | { mode: 'real'; userId: string; role: Role; outletId: string | null; displayName: string }
  | { mode: 'demo'; role: Role; outletId: string | null; persona: DemoPersona }
```

Features read role/outlet/name uniformly; anything demo-specific (the
switcher) lives in demo chrome, not in features.

### D9 — Layout primitives are thin compositions over shadcn/ui

`PageHeader`, `DataTable`, `EmptyState`, `FormSheet`, `ConfirmDialog` land in
`src/components/layout/` as compositions of shadcn primitives (dialog, sheet,
table added from the registry as needed), consuming semantic tokens only:

- `PageHeader` — title, optional back link, optional primary action slot.
- `DataTable` — semantic `<table>` over typed rows: column defs, right-aligned
  tabular-numeral money cells (via the existing `Money` component), phone
  density 40px rows / tablet 44px, and an empty-state slot so "No data" never
  ships bare.
- `EmptyState` — icon, one sentence of *what to do next*, optional action.
- `FormSheet` — bottom sheet on phones, side sheet on wide screens; 16px
  inputs (iOS zoom rule) — the container later feature forms fill.
- `ConfirmDialog` — destructive confirmation that says what will happen in
  plain words; the only place "danger" styling is composed.

Each primitive gets a component test now, because every later `ui-*` change
builds on them sight-unseen.

### D10 — Fixtures: real outlets and menu, invented people, typed from the schema

`src/data-access/mock/fixtures/` carries the demo dataset for this change:
the two real outlets (public fact, matching seeds), and four invented demo
personas (one per role) with obviously synthetic names. Every fixture is
typed from generated schema types (`Tables<'outlets'>`, `Tables<'profiles'>`
…) — no hand-rolled shapes. A type-level test
(`fixtures.test-d.ts` with `@ts-expect-error` cases) demonstrates the
roadmap gate literally: a fixture with a column the schema lacks fails to
compile.

## Risks / Trade-offs

- **[Registry ambition]** Declaring every SCREENS.md surface now means #6–#8
  may rename/split surfaces. → Acceptable: renaming a registry entry is a
  one-file diff inside the change that renames the screen; the alternative
  (registry grows ad hoc) forfeits "readable at a glance" exactly when the
  surface count grows.
- **[Exemplar-only seam]** Later `ui-*` changes could each invent their own
  adapter idiom. → The `outlets` exemplar plus the `DataAdapters` bag and
  this design are the convention; `/opsx` review of those changes checks
  against it.
- **[Tripwire is global state]** The demo-scope flag is module-level. → Sound
  under D1 (trees never coexist); the unit test asserts both set-on-mount and
  clear-on-unmount so a leak would fail fast. The flag lives beside
  `getSupabaseClient` in data-access, not in feature code.
- **[Interstitial depends on supabase-js storage shape]** `getSession()` is
  the supported API and survives storage-format changes; the e2e test seeds a
  session through the same client rather than hand-writing localStorage, so a
  format change breaks the test, not the guard.
- **[Bottom tabs with one visible surface look sparse today]** True and
  accepted: the shells' job this change is to be *correct*, not busy; #6–#8
  fill them within two waves.
- **[Both-theme × both-viewport matrix]** Four shells × 2 themes × 2
  viewports is a real review cost every UI change from now on. → The e2e
  suite carries screenshots for the matrix so the cost is automated once.

## Migration Plan

Pure addition: new routes, new modules, no schema change, no data migration.
`RootLayout`'s current placeholder home is replaced by the landing + demo
trees; nothing else consumes it yet. Rollback is reverting the change.

## Open Questions

- Whether the Super Admin's outlet-switcher context (pick an outlet, browse
  it read-only) belongs in the session or in per-surface state — deferred to
  #8, where the owner console actually exercises it; the session shape above
  does not preclude either.
- The exact "More" overflow threshold interaction (sheet vs page) — deferred
  until a role actually exceeds five nav entries (#7 at the earliest).
