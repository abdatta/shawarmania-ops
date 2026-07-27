# Tasks: demo-mode-and-app-shell

## 1. The seam — session, adapters, fixtures

- [x] 1.1 Define the session contract in `src/session/`: `Role`, `Session` discriminated union (`real` | `demo`), `SessionContext` + `useSession()`, and the `DemoPersona` type. No providers yet — just the shape both modes implement (design D8).
- [x] 1.2 Define the adapter seam in `src/data-access/adapters.ts`: `DataAdapters` bag and the `OutletsAdapter` interface (list/get outlets), plus `AdaptersProvider`/`useAdapters()` context. Screens import these, never implementations (design D2).
- [x] 1.3 Create typed fixtures under `src/data-access/mock/fixtures/`: both real outlets (matching seeds) and four invented demo personas, every fixture typed from generated schema types (`Tables<'outlets'>`, `Tables<'profiles'>`…). Money values integer paise (design D10).
- [x] 1.4 Add the compile-time drift proof: a type-level test with `@ts-expect-error` cases showing a fixture with a wrong column or wrong value type fails typecheck (spec: mock fixtures typed from schema).
- [x] 1.5 Implement `MockOutletsAdapter` in `src/data-access/mock/` over the fixtures, and `SupabaseOutletsAdapter` in `src/data-access/supabase-adapters/` over the typed client — compile-level parity proof; the real one stays unused until #4.
- [x] 1.6 Extend eslint boundaries: nothing under `src/data-access/mock/**` or `src/demo/**` may import the Supabase client module or `supabase-adapters/` (design D4 layer 1).

## 2. Gate registry

- [x] 2.1 Create `src/gates/registry.ts`: `SurfaceId` union, surface entries (role, path, nav metadata, state) for every surface in `docs/SCREENS.md`; each role's home in `demo`, everything else `hidden` (design D3).
- [x] 2.2 Implement derivation helpers — `visibleSurfaces(role, mode)` and route-guard logic: `hidden` never renders; `demo` renders only in demo mode; `live` renders in both — with unit tests for all three states × both modes.

## 3. Demo mode — providers, safety, switcher

- [x] 3.1 Build the demo branch under `src/demo/`: `DemoSessionProvider` parsing role from `/demo/:role/*` (`owner`, `admin`, `counter`, `staff`), constructing mock adapters only, wiring persona + outlet context from fixtures (design D1, D8).
- [x] 3.2 Add the demo-scope tripwire in `src/data-access/`: demo root layout marks scope on mount and clears on unmount; `getSupabaseClient()` throws while marked. Unit-test set, clear, and the throw (design D4 layer 2).
- [x] 3.3 Build the demo banner: an unconditional strip in every demo shell's fixed chrome — "Demo — fabricated data" + role switcher — no dismiss affordance, no hiding state or prop; slim in the Biller header so it can never occlude billing actions (design D6).
- [x] 3.4 Build the role switcher as navigation between `/demo/<role>` prefixes, landing on the target role's home.
- [x] 3.5 Build the real-session interstitial: on entering `/demo/*` with a persisted Supabase session (`getSession()`), render the interstitial instead of the demo shell; "Continue to demo" held in `sessionStorage` (tab-scoped), "Back to the app" leaves; no session → straight in (design D5).
- [x] 3.6 Unit safety proof: mount the demo tree, exercise every mock adapter method, assert a spied `fetch` saw zero requests and `getSupabaseClient` throws in scope (design D4 layer 3).

## 4. Shells and layout primitives

- [x] 4.1 Add the shadcn/ui primitives needed (dialog, sheet, table) themed via semantic tokens only — no hex, `npm run lint:tokens` stays green. *(Shipped as a single native-`<dialog>` `Modal` base — top layer, focus containment and Escape from the platform, no new dependency — which FormSheet and ConfirmDialog compose; table markup lives in DataTable.)*
- [x] 4.2 Build the layout primitives in `src/components/layout/`: `PageHeader`, `DataTable` (typed rows, money columns right-aligned tabular via `Money`, empty-state slot, 40/44px density), `EmptyState` (what-to-do-next sentence), `FormSheet` (bottom sheet on phones, side sheet wide, 16px inputs), `ConfirmDialog` (plain-words consequence). Component test each (design D9).
- [x] 4.3 Build the phone shell (Super Admin, Franchise Admin, Employee): bottom tab bar derived from the registry on phone widths, left rail on wide screens, theme toggle in chrome, ≤5 tabs (design D7).
- [x] 4.4 Build the Biller tablet shell: fixed header (outlet name, shift + sync placeholders, theme toggle, demo strip), fixed content region, nothing scrolls unexpectedly (design D7).
- [x] 4.5 Build each role's demo home surface with the layout primitives, served through `useAdapters()` (outlet names via the outlets adapter) — thin overviews proving the seam, not dashboards.
- [x] 4.6 Wire routing: `/` renders the landing (sign-in arrives with #4; prominent demo link); `/demo` redirects to `/demo/owner`; `/demo/:role/*` mounts the demo providers + shells; registry-driven route guards; unknown routes to the existing NotFound.

## 5. End-to-end verification

- [x] 5.1 Playwright: walk all four demo role shells via the switcher; interceptor fails the test on any request leaving the app origin (static assets excepted) (design D4 layer 4).
- [x] 5.2 Playwright: banner visible on every demo route with no dismiss affordance; deep link `/demo/admin/…` reloads to the same role and surface; fresh-context open works.
- [x] 5.3 Playwright: seed a fake Supabase session through the client's own storage, navigate to `/demo/*`, assert the interstitial; continue is tab-scoped (new context sees it again); no-session case goes straight in.
- [x] 5.4 Screenshot matrix: four shells × light/dark × phone/tablet viewports, committed as the automated both-theme both-viewport check. *(Shipped as assertions — banner, theme attribute, shell anchor — per matrix cell, with screenshots attached to the Playwright report; pixel-baseline comparison was deliberately avoided because font rendering differs across the OSes CI and laptops run, and a flaky gate teaches people to ignore it.)*

## 6. Gates, docs, and hygiene

- [x] 6.1 Full local gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run contrast`, `npm run build`, `npm run test:e2e` all green.
- [x] 6.2 Update `docs/DEMO_MODE.md`, `docs/ARCHITECTURE.md`, `docs/SCREENS.md` to present tense for what now exists (adapter seam mechanics, gate registry location, role path segments, shells); note remaining future parts stay future-tense.
- [x] 6.3 Run `npm run roadmap:sync` and confirm the change folder state is reflected on the board.
