# Architecture

> The scaffold, schema, adapter seam and app shell exist (#1–#3). Feature surfaces, auth flows, Edge Functions and the outbox arrive with later roadmap changes; those parts below describe the design they will follow.

## Runtime shape

```
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   Counter tablet     │   │   Manager phone      │   │   Owner phone        │
│   (Biller)           │   │   (Franchise Admin)  │   │   (Super Admin)      │
├──────────────────────┤   ├──────────────────────┤   ├──────────────────────┤
│  React PWA (installed, same bundle, role-routed at the shell)              │
│  ┌────────────────┐                                                        │
│  │ IndexedDB      │  service worker: app shell + menu cache                │
│  │ outbox (Dexie) │  ← counter writes queue here first                     │
│  └───────┬────────┘                                                        │
└──────────┼─────────────────────────────────────────────────────────────────┘
           │  supabase-js  (public key + user JWT; no authority claims)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Supabase                                                                   │
│  ┌────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Auth      │  │ assignments          │  │ Edge Functions               │ │
│  │  (no       │  │ person × role ×      │  │ (service-role only, never    │ │
│  │   claims)  │  │ outlet — the truth   │  │  exposed to the browser):    │ │
│  └────────────┘  └──────────┬───────────┘  │  · provision staff account   │ │
│                             │              │  · enrol / revoke device     │ │
│  ┌──────────────────────────▼─────────────┐│                              │ │
│  │  Postgres — RLS on every table         ││                              │ │
│  │  policies resolve live assignments     │└──────────────────────────────┘ │
│  └────────────────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

One bundle serves all four roles. The session loader reads the person's live
assignments and mounts the corresponding navigation and route set; it does not
rely on routing for security, because the database evaluates those same
assignments independently on every request.

## Why this stack

### Postgres with Row-Level Security — the load-bearing choice

The hardest requirement in this project is *"Franchise Admins, Billers and Employees must not access another outlet's data."* That is a security boundary. Enforcing it in application code means every query, every endpoint, and every future feature must remember to filter — and multi-tenant systems leak precisely when someone forgets.

With RLS, isolation is one policy per table keyed off a JWT claim, evaluated by Postgres on every row of every query. A frontend bug cannot leak another outlet's data because the database will not return it. This is why the tenancy model gates the roadmap: it is inherited by everything downstream.

### Supabase over rolling our own

Auth, session management, password handling, and hosted Postgres are undifferentiated work for a two-outlet food business. Supabase provides them with RLS as a first-class concept. The free tier comfortably covers current scale, and it is self-hostable if that ever changes.

**Rejected:** a Node + Express + SQLite service. More control, no vendor coupling, but it means hand-building auth, user provisioning, multi-device sync and hosted persistence — months of work that earns the business nothing.

**Rejected:** Firebase/Firestore. Fast auth and realtime, but profit/loss, daily cash reconciliation and cross-outlet comparison are aggregate queries. Document stores make those awkward and expensive; SQL makes them one statement.

### Vite SPA, not Next.js

Every screen is behind auth, so server-side rendering buys nothing — there is no SEO surface and no anonymous first paint worth optimising. Meanwhile SSR actively complicates the offline story, which is a hard requirement here. A static SPA with a service worker is simpler to reason about, cheaper to host, and deploys as immutable assets to a CDN.

### Tailwind v4 + shadcn/ui

shadcn components are themed entirely through CSS custom properties, which is what makes the brand-token layering in [Design System](DESIGN_SYSTEM.md) clean rather than a fight. Components are copied into the repo rather than imported from a package, so adapting one for counter use (bigger tap targets, tabular numerals) is a normal edit.

## Layers

| Layer | Responsibility | Rule |
|---|---|---|
| **Routes** | Role-aware shells, navigation, page composition | No data access, no business logic |
| **Features** | One folder per domain area (`billing`, `inventory`, `cash`…) | Owns its components, hooks, and types |
| **Data access** | A typed adapter interface per domain area, with two implementations | The *only* layer that imports the Supabase client |
| **Domain** | Pure functions: totals, expected cash, business-date resolution, P&L | No I/O — trivially unit-testable, and where money correctness is proven |
| **Outbox** | Queue, retry, dedupe for counter writes | Feature code enqueues intent; it never calls Supabase directly for counter writes |

Money arithmetic lives in the domain layer as pure functions over integer paise. That is deliberate: the rules most expensive to get wrong become the rules easiest to test.

## The adapter seam

The data-access layer is **swappable**, and that single decision carries the project's delivery strategy.

```
   screens & features  ──depend only on──▶  typed adapter interface
                                                    │
                                        ┌───────────┴───────────┐
                                        ▼                       ▼
                                 SupabaseAdapter           MockAdapter
                                  (real data)        (fixtures, typed from schema)
```

Every screen is built against the mock adapter first, behind a feature gate, and made real later by swapping the implementation — not by rewriting the screen. The session provider splits the same way: a real Supabase session, or a demo session with an instant role switcher.

In code: interfaces in `src/data-access/adapters.ts` (one per domain area, added by the `ui-*` change that needs them), mocks and fixtures in `src/data-access/mock/`, real adapters in `src/data-access/supabase-adapters/`, contexts (`useAdapters()`, `useSession()`) supplying whichever pair the mounted tree constructed. The demo tree (`src/demo/`, mounted at `/demo/:role`) only ever constructs mocks, and a tripwire makes `getSupabaseClient()` throw while it is mounted.

Two rules keep this honest. **Mocks are typed from the generated schema types**, so a fixture that drifts from what the database can actually serve fails to compile. And **a screen that imports the Supabase client directly has broken the seam** — that is a review failure, not a style preference, and lint enforces it.

Surfaces are `hidden`, `demo`, or `live`, declared in one registry (`src/gates/registry.ts`) that navigation and routing derive from. Full detail, including the safety rules that let demo mode ship to production, is in [Demo Mode](DEMO_MODE.md).

## How a bill flows

The critical path, and the reason the outbox exists:

1. Biller taps items. State is local; **nothing is awaited**.
2. Biller settles. The client generates a UUID, resolves the business date, computes totals in the domain layer, and writes the bill to the IndexedDB outbox. The screen clears immediately.
3. The outbox drains in the background: it posts to Supabase keyed by the client UUID, so a retry that arrives twice inserts once.
4. The server assigns the per-outlet `bill_number` (sequence allocation must be server-side; two offline devices cannot safely agree on a number). The client shows a provisional local reference until the real number returns.
5. On success the outbox entry is dropped. On failure it stays queued with backoff, and the UI shows an honest pending count.

The biller is never blocked on the network at any step. Detail and failure modes in [Offline And Sync](OFFLINE_AND_SYNC.md).

## How permissions are evaluated

**Nothing about authority is carried in the access token** (owner, 2026-07-29). A person's roles and outlets are rows in `public.assignments`, and RLS policies resolve scope by membership:

```sql
create policy outlet_isolation_read on bills for select
  using (
    (select public.app_is_owner())
    or outlet_id in (select public.app_outlets_for('franchise_admin'))
  );
```

The helpers are `stable security definer`, which is what avoids the **RLS recursion trap**: a policy on `assignments` that queried `assignments` to determine access would recurse infinitely, and definer rights bypass RLS for that one lookup. Any policy needing a table lookup goes through such a function; none reads a table directly.

The per-row cost the old JWT claims existed to avoid is avoided differently. `app_outlets_for` is **set-returning**, so `outlet_id in (select public.app_outlets_for('franchise_admin'))` is a non-correlated subquery Postgres hoists to a hashed SubPlan — one lookup per query, not per row. `app_is_owner()` takes no argument, so `(select public.app_is_owner())` becomes an InitPlan for the same reason.

Because the policies read the table, **an assignment granted or ended bites at the very next request** — nothing is reissued and nobody is signed out. The same is true of everything else that must be immediate: revoking a counter device and deactivating an account are status checks inside the policy, exactly as they always were. There is no longer any category of change that waits for a token.

## Privileged operations

Anything requiring the service-role key runs in an Edge Function. The service-role key bypasses RLS entirely and **must never reach the browser**.

- **Provision or repair an account** — create one Auth user at the deterministic
  username alias, create every assignment and the one-time invite atomically,
  rename another person's username, and issue admin-led resets.
- **Sign in by associated email** — privately resolve the email to the current
  Auth alias, apply hashed abuse limits, ask Supabase Auth to verify the
  password with the public credential, and return only Supabase session tokens.
- **Recover a Super Admin** — resolve a private account email without exposing
  whether it matched, ask Supabase Auth to issue a recovery token, and route
  only that signed mail action through the configured transactional provider.
- **Enrol or revoke a counter device** — mints and invalidates the device's long-lived scoped session.

Each privileged function re-derives the caller from their token and reads live
assignments from the database. Being an Edge Function is not authorisation.

Supabase Auth has no first-class username field, so the provider identifier is
`<username>@login.shawarmania.invalid`. The browser derives that alias locally
and sends username passwords directly to Supabase. An associated email cannot
be exposed as an email-to-alias lookup, so only that sign-in path crosses a
narrow Edge Function: it resolves privately, delegates the password grant to a
request-local anon-key Supabase client, and returns the resulting access and
refresh tokens. It never verifies or retains passwords, mints sessions, or
returns aliases. Private account email lives in a no-client-access table and is
required for a live Super Admin while optional for another role. The signed
Send Email Hook permits only a live Super Admin's recovery action and refuses signup,
invite, magic-link, and email-change mail.

Bill numbers were originally sketched as a third Edge Function and deliberately moved **into the database**: a `before insert` trigger allocates from a per-outlet counter inside the insert transaction, which is atomic with the bill in a way a separate network call can never be — gapless on failure, race-safe under two devices, and the client's value is overwritten regardless.

## Offline boundary

Deliberately asymmetric, because the risk is asymmetric:

- **Reads that must work offline**: menu, current shift, today's bills on this device.
- **Writes that must work offline**: bills, and attendance check-in from the counter tablet.
- **Everything else is online-only.** Inventory, expenses, cash close, P&L and admin screens are used by managers on phones who can wait for a connection. Making them offline-capable would multiply conflict-resolution complexity for no operational gain.

That line is a design commitment, not an accident. Revisit it in a proposal, not in passing.
