# Architecture

> Describes the system as designed. No application code exists yet.

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
           │  supabase-js  (anon key + user JWT carrying role + outlet_id)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Supabase                                                                   │
│  ┌────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Auth      │→ │ Access-token hook    │  │ Edge Functions               │ │
│  │            │  │ injects role,        │  │ (service-role only, never    │ │
│  │            │  │ outlet_id claims     │  │  exposed to the browser):    │ │
│  └────────────┘  └──────────┬───────────┘  │  · provision staff account   │ │
│                             │              │  · enrol / revoke device     │ │
│  ┌──────────────────────────▼─────────────┐│  · issue bill number         │ │
│  │  Postgres — RLS on every table         ││                              │ │
│  │  policies read outlet_id from the JWT  │└──────────────────────────────┘ │
│  └────────────────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

One bundle serves all four roles. The shell reads the role claim and mounts a different navigation and route set; it does not rely on that for security, because the database enforces access independently.

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

Two rules keep this honest. **Mocks are typed from the generated schema types**, so a fixture that drifts from what the database can actually serve fails to compile. And **a screen that imports the Supabase client directly has broken the seam** — that is a review failure, not a style preference.

Surfaces are `hidden`, `demo`, or `live`, declared in one registry. Full detail, including the safety rules that let demo mode ship to production, is in [Demo Mode](DEMO_MODE.md).

## How a bill flows

The critical path, and the reason the outbox exists:

1. Biller taps items. State is local; **nothing is awaited**.
2. Biller settles. The client generates a UUID, resolves the business date, computes totals in the domain layer, and writes the bill to the IndexedDB outbox. The screen clears immediately.
3. The outbox drains in the background: it posts to Supabase keyed by the client UUID, so a retry that arrives twice inserts once.
4. The server assigns the per-outlet `bill_number` (sequence allocation must be server-side; two offline devices cannot safely agree on a number). The client shows a provisional local reference until the real number returns.
5. On success the outbox entry is dropped. On failure it stays queued with backoff, and the UI shows an honest pending count.

The biller is never blocked on the network at any step. Detail and failure modes in [Offline And Sync](OFFLINE_AND_SYNC.md).

## How permissions are evaluated

A Supabase **custom access token hook** injects `app_role` and `app_outlet_id` into the user's JWT at issue time. RLS policies read those claims directly:

```sql
create policy outlet_isolation_read on bills for select
  using (
    (auth.jwt() ->> 'app_role') = 'super_admin'
    or outlet_id = (auth.jwt() ->> 'app_outlet_id')::uuid
  );
```

Reading the claim rather than sub-querying `profiles` matters for two reasons. It avoids a per-row lookup on every query, and — more importantly — it avoids the **RLS recursion trap**: a policy on `profiles` that queries `profiles` to determine access recurses infinitely. Any policy that genuinely needs a table lookup must go through a `SECURITY DEFINER` function that bypasses RLS for that specific check.

Claims are refreshed on token refresh, so a role or outlet reassignment takes effect at the next refresh rather than instantly. Changes that must take effect immediately (revoking a counter device, deactivating an account) are enforced by a status check in the policy, not by the claim alone.

## Privileged operations

Anything requiring the service-role key runs in an Edge Function. The service-role key bypasses RLS entirely and **must never reach the browser**.

- **Provision a staff account** — creating an auth user with a confirmed phone requires admin privileges.
- **Enrol or revoke a counter device** — mints and invalidates the device's long-lived scoped session.
- **Issue a bill number** — allocates from a per-outlet sequence atomically.

Each function re-checks the caller's role from their JWT. Being an Edge Function is not authorisation.

## Offline boundary

Deliberately asymmetric, because the risk is asymmetric:

- **Reads that must work offline**: menu, current shift, today's bills on this device.
- **Writes that must work offline**: bills, and attendance check-in from the counter tablet.
- **Everything else is online-only.** Inventory, expenses, cash close, P&L and admin screens are used by managers on phones who can wait for a connection. Making them offline-capable would multiply conflict-resolution complexity for no operational gain.

That line is a design commitment, not an accident. Revisit it in a proposal, not in passing.
