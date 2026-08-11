# Architecture

> The scaffold, schema, adapter seam, role shells, authentication, counter
> device flow and billing outbox exist. Later roadmap surfaces follow the same
> boundaries described below.

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
│                             │              │  · set up / remove tablet    │ │
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

A third rule governs what a real adapter *sends*. **Every argument of a database command is stated explicitly, including the ones that are unknown — an omitted key is not a null.** A payload is JSON, so a property that evaluates to `undefined` disappears on the way out; a function whose parameter carries no default then matches nothing, and PostgREST answers that it cannot find the function at all. That failure looks like a broken app rather than a missing value, and it cannot be caught by the mock adapter, which is handed the object rather than the JSON. It shipped once, in `attendance_submit_attempt`: `p_lat: reading?.latitude as number` broke every check-in taken without a position, showing "try again in a moment" while writing nothing. The cast is what hid it — do not silence the generated `Args` type over an optional chain. Write `?? null` first, and cast only a value that is provably never `undefined`.

Surfaces are `hidden`, `demo`, or `live`, declared in one registry (`src/gates/registry.ts`) that navigation and routing derive from. Full detail, including the safety rules that let demo mode ship to production, is in [Demo Mode](DEMO_MODE.md).

**Navigation and routing derive from the roles a session can *reach*, which is not the same question as the roles it holds** (`owner-reaches-every-outlet`, #28). `heldRoles(session)` is what a person's live assignments confer, and it stays the answer wherever the app *states* somebody's roles — the account menu is the one place that does. `reachableRoles(session)` adds one thing: a session holding the owner role reaches the outlet-level surfaces, at every outlet, holding no assignment at any of them. Three gates read it — the phone shell's navigation, `GatedSurface`, and the role-path check in `RealRoot` — and nothing else does.

Two properties are worth stating because the alternative is a UI that grants itself authority. **It is not a role hierarchy**: one specific reach for one specific role, and a manager assignment at Kalyani still confers nothing at Kanchrapara. And **reaching a surface confers nothing** — every write is decided by the policies from the assignment, which is why the owner reaches an outlet's cash surface and is still refused its drawer. No policy changed for #28 and no migration was needed; the isolation suite gained the cases instead.

A navigation entry also **keeps the reader in the shell they are in**: the owner's Attendance is `/owner/attendance`, not `/admin/attendance`. Both role branches mount the same surface routes and the gate resolves a path against reachable roles, so the surface is identical either way — but in demo mode the role lives in the URL, so linking into another role's segment would swap the persona mid-walk. A home is the exception, keeping its own segment, because two homes cannot share one address; only a role the person **holds** contributes one, which is what stops a second dashboard tab appearing on the owner's own shell.

A registry entry may also **declare that its surface has work waiting**, by naming a count source. The shell renders whatever number that source reports and knows nothing about what is being counted, so badging a further surface is a registry line plus one hook in `src/features/attention/sources.ts` — never an edit to either shell. The map is keyed by the id union the registry declares, so a source with no entry is dead code and an entry with no source does not compile. Counts are read on mount and again when the app returns to the foreground, never on a timer, and readers sharing an adapter share one request.

## How a bill flows

The database accepts one immutable, versioned command envelope. Recording an
order allocates a small daily order number; paying it atomically writes final
bill snapshots, marks the order paid, allocates one permanent bill number and
stores the replay receipt. Pay-now runs the same payment path without an order
and produces the same bill shape.

Envelope identity is command UUID, tablet, shift, type, creation time, schema
version and the SHA-256 of canonical payload JSON. The browser and PostgreSQL
share one canonicalization vector. Exact retry returns the stored result; a
changed envelope under the UUID is a permanent identity conflict.

The live adapter accepts that envelope into a versioned Dexie store before the
composer clears. Dependencies preserve each order chain without blocking
unrelated work; Web Locks elect one draining tab, with an IndexedDB lease as the
fallback. Exact replay, durable refusals and correction/discard traces all land
back in the same store. Detail and failure modes are in
[Offline And Sync](OFFLINE_AND_SYNC.md).

The counter is also the deliberate exception to the phone badge freshness
convention. It reads menu and activity on mount and whenever the app returns to
the foreground, and a shared Realtime channel treats menu, order and bill events
only as nudges to re-read under RLS. Neither path is load-bearing alone. A
mains-powered tablet stays on this screen for a whole shift, and its stale price
or availability is charged to the customer rather than merely shown as a late
count.

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

Because the policies read the table, **an assignment granted or ended bites at the very next request** — nothing is reissued and nobody is signed out. The same is true of everything else that must be immediate: removing a counter tablet and deactivating an account are status checks inside the policy, exactly as they always were. There is no longer any category of change that waits for a token.

## Privileged operations

Anything requiring the service-role key runs in an Edge Function. The service-role key bypasses RLS entirely and **must never reach the browser**.

- **Provision or repair an account** — create one Auth user at the deterministic
  username alias, create every assignment and the one-time invite atomically,
  rename another person's username, and issue admin-led resets.
- **Sign in by associated email** — privately resolve the email to the current
  Auth alias, apply hashed abuse limits, ask Supabase Auth to verify the
  password with the public credential, and return only Supabase session tokens.
- **Set up or remove a counter tablet** — mints the machine Auth identity behind a
  one-time setup code, and removes a tablet permanently along with its live shift.
  Setup takes no session at all, because a tablet that has never been set up has
  none; its protection is the code, the one-tablet-per-outlet invariant in
  Postgres, and a response that looks the same however the code fails.
- **The counter handshake** — mints the four-digit confirmation code for a
  requesting tablet, and confirms, rejects, cancels or ends on behalf of the
  person whose token presented itself. The two secrets are minted here rather
  than in Postgres for one reason: only the hash may ever reach the database, and
  the plaintext must be returned to exactly one caller and stored nowhere.

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
required for a live Super Admin while optional for another role. It is an
alternate sign-in and a foundation for later recovery or security features;
this version sends no authentication mail. Secure Email Change and double
confirmation keep a signed-in client from silently replacing the reserved Auth
alias.

Bill numbers live **inside the payment command transaction**: the landed trigger
allocates from a per-outlet counter, so a failed payment, cancelled order or
exact replay consumes none. Daily order numbers use a separate
per-outlet/per-business-date counter and restart after cutover.

## Offline boundary

Deliberately asymmetric, because the risk is asymmetric:

- **Reads that continue offline inside an already-open shift**: that shift's last
  successfully loaded menu plus local orders, bills and delivery state.
- **Writes that work offline**: direct payments and create, revise, cancel and
  pay-order commands.
- **Opening a shift is online-only**, and deliberately so: the handshake is a
  conversation between the tablet, the server and somebody else's phone, and
  nothing local can stand in for the person who types the four digits. The cost is
  bounded by the shape of the day — a shift lasts to the outlet's cutover, so the
  connection is needed once an evening rather than continuously, and a shift
  already open survives losing it.
- **Reloading or starting billing needs the backend and a fresh live shift.** Old
  queued work may still drain after cutover, but a persisted menu is not authority
  to open new work after a restart.
- **Finish day is online-only.** It drains the local date, refuses any unresolved
  command or open server order, ends the shift and writes the server confirmation
  under one outlet/date lock.
- **Everything else is online-only.** Inventory, expenses, cash close, P&L and admin screens are used by managers on phones who can wait for a connection. Making them offline-capable would multiply conflict-resolution complexity for no operational gain.

That line is a design commitment, not an accident. Revisit it in a proposal, not in passing.
