# Agent Guide

Shawarmania Ops is a multi-outlet cash-counter and outlet-management PWA for **Shawarmania**, a quick-service shawarma business operating in Kalyani and Kanchrapara, West Bengal. It handles counter billing, employee attendance, menu, inventory, expenses, daily cash reconciliation, basic profit/loss estimates, and outlet↔owner messaging — with each outlet's data strictly isolated so the business can grow through franchises.

**Status: the whole UI is walkable; most of it is not yet real.** The schema, tenancy policies, the adapter seam, the four role shells, demo mode and authentication all exist, and attendance runs in production. Every other surface — billing, menu, inventory, expenses, daily cash, and the owner's console, comparison, P&L, reports and alerts — is **built and demo-gated**, walkable end to end at `/demo` over one internally consistent scenario spanning both outlets. Making each one real is what the remaining `*-live` changes do. See [`openspec/changes/ROADMAP.md`](openspec/changes/ROADMAP.md) for what is built and what comes next; it is derived from the change folders, so it is never stale.

## North Star

The tablet at each counter takes money without ever stopping, and the owner sees every outlet's truth from their phone.

Two consequences follow from that sentence, and they outrank convenience everywhere in this repo: **billing must survive a dead internet connection**, and **an outlet must never see another outlet's data**.

## Hard Rules

### Tenancy

- Outlet isolation is a **database boundary, not a UI concern**. Every outlet-scoped table carries `outlet_id` and ships its Row-Level Security policy in the same change that creates the table.
- A Franchise Admin, Biller, or Employee MUST NOT be able to read or write another outlet's rows — including via a hand-crafted API request with a valid session.
- Only the Super Admin reads across outlets, and only through surfaces explicitly designed as cross-outlet.
- Never add an outlet-scoped table without an RLS policy. A table without a policy is a data leak, not a to-do.

### Money and time

- Store money as **integer paise**. Never floats — `0.1 + 0.2` problems in a cash-reconciliation app are unacceptable. Format to ₹ only at the display edge.
- Store timestamps as `timestamptz` (UTC). Display in **Asia/Kolkata**.
- **Never derive a business day from a UTC timestamp.** Each outlet has a business-day cutover time; a bill rung at 00:30 belongs to the business day that shift started on. Write `business_date` as an explicit column — do not compute it from `created_at` at read time.

### Billing integrity

- Bill line items **snapshot** `item_name` and `unit_price` at the moment of sale. Never join a historical bill to the live menu — a price change must not silently rewrite last month's revenue.
- Every counter write carries a **client-generated UUID** and is **idempotent**. The offline outbox will retry it, possibly more than once.
- Bill numbers are per-outlet sequential and are never reused.
- A bill is append-only once settled. Corrections are new records (void / adjustment), never in-place edits.

### Data protection

- Customer phone numbers are PII. Collect only what billing needs, never log them, never include them in analytics or exports without an explicit reason.
- Never commit `.env`, Supabase service-role keys, real customer or employee data, or database dumps.
- **The Supabase service-role key never reaches the browser.** Anything needing it runs in an Edge Function.
- Attendance location data is employee monitoring. Store what the policy requires (coordinates, accuracy, distance) and nothing more.

### Design

- Shawarmania brand values live **only** in the brand token layer (`brand.*`). Components consume semantic tokens (`surface`, `content`, `primary`, `danger`…). A franchise re-skin must be a one-file change.
- Never use raw hex values in a component.
- **Light and dark are both first-class.** Every UI change is checked in both, and the contrast validator gates both. A token that passes in one and fails in the other is a failure.
- This is an ops portal, not the marketing site. Density, legibility, and speed beat expressiveness. See [Design System](docs/DESIGN_SYSTEM.md) for the contrast rules — some brand colours fail AA and have prescribed substitutes.

### Delivery model — UI first, then made real

The whole UI is built and demonstrable before any of it is wired to a real backend. This is the delivery strategy, not a testing convenience, and these rules keep it honest:

- **Screens depend on the typed adapter interface, never on the Supabase client.** A screen that imports Supabase directly has broken the seam.
- **Mocks are typed from the generated schema types**, so a fixture the database could not actually serve fails to compile.
- **Every `ui-*` change ships behind a feature gate** in one of three states: `hidden`, `demo`, `live`. A `hidden` surface is absent from navigation, not greyed out.
- **Every `*-live` change swaps one adapter and promotes one gate. It does not redesign the screen.** If it has to rebuild UI, the mock was the wrong shape — fix the mock and record why.
- **Demo mode never writes to real data, and a real signed-in user can never enter it silently.** The demo indicator is never dismissible.

Full detail in [Demo Mode](docs/DEMO_MODE.md).

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite, as an installable PWA. React Router for routing.
- **Styling**: Tailwind CSS v4 + shadcn/ui, themed through CSS custom properties.
- **Backend**: Supabase — Postgres, Row-Level Security, Auth, Edge Functions for privileged operations.
- **Offline**: Service worker for the app shell; IndexedDB (Dexie) outbox for counter writes.
- **Hosting**: static SPA on Vercel or Cloudflare Pages.

Rationale for each of these choices is recorded in [Architecture](docs/ARCHITECTURE.md); do not relitigate them in a change proposal without reading it first.

## Authentication Model

Two device contexts, deliberately different:

- **Personal smartphones** (Super Admin, Franchise Admin, Employee): email + password, admin-provisioned with the address pre-confirmed. No SMS provider, no TRAI/DLT registration, no confirmation mail. (Owner-confirmed 2026-07-26; phone numbers are contact data, not credentials.) **Built.**
- **Counter tablet** (Biller): the *device* is enrolled once and holds a long-lived session scoped by RLS to exactly one outlet. Billers then unlock a shift with a short PIN, which selects attribution — it is not the security boundary. **Not built** — arrives with `counter-devices-and-offline`; until then a Biller signs in with their own email, which is recorded in [Limitations](docs/LIMITATIONS.md).

Three rules that follow, and that a change touching auth must not quietly undo:

- **Accounts are admin-provisioned with a one-time code, handed over by hand.** Nothing is ever emailed or texted. The code is stored only as a hash, in a column no client role can read — so it is shown to the issuing admin once and is genuinely unrecoverable afterwards. Every way redeeming it can fail returns one identical response.
- **Privileged account operations re-derive the caller's authority from their own token**, never from the request body. Being an Edge Function is not authorisation.
- **Deactivation is immediate at the database, and the client must not lag it.** A deactivated account cannot read its own profile row; that is the signal an open app uses to end its session rather than waiting out the token.

Full detail, including the revocation story, is in [Roles And Permissions](docs/ROLES_AND_PERMISSIONS.md).

## Docs

The durable wiki lives in [`docs/`](docs/README.md):

- [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) — what this app is, scope in and out, principles.
- [`docs/BUSINESS_CONTEXT.md`](docs/BUSINESS_CONTEXT.md) — Shawarmania itself: outlets, menu, payment rails, how the counter actually works.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime shape, layers, data flow, and why the stack is what it is.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — tables, keys, invariants.
- [`docs/ROLES_AND_PERMISSIONS.md`](docs/ROLES_AND_PERMISSIONS.md) — four roles × capability matrix, mapped to RLS policies.
- [`docs/SCREENS.md`](docs/SCREENS.md) — every screen, who sees it, what it does.
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — brand → semantic tokens, components, contrast rules, light and dark.
- [`docs/DEMO_MODE.md`](docs/DEMO_MODE.md) — the adapter seam, feature gating, and how a demo is run.
- [`docs/OFFLINE_AND_SYNC.md`](docs/OFFLINE_AND_SYNC.md) — the outbox, conflict rules, failure modes.
- [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) — PII, monitoring, key handling.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deploy, environments, backups, onboarding a new outlet.
- [`docs/TESTING.md`](docs/TESTING.md) — how to verify a change.
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — domain terms, defined once.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — known edges and deliberate non-features.

## Change Workflow

This repo is spec-driven. **No code change without a change folder.**

| Location | Answers | Tense |
|---|---|---|
| `docs/` | What the app **is** and why | present, no history |
| `openspec/specs/<capability>/spec.md` | What it is **contractually required** to do | present, testable |
| `openspec/changes/<id>/` | What is **changing** right now | proposal → design → tasks → spec deltas |
| `openspec/changes/archive/` | Every change ever made | dated, immutable |
| `openspec/changes/ROADMAP.md` | What's **next**, and why in that order | the board |
| `openspec/todos/` | Ideas not yet formal enough to sequence | backlog |

Commands:

- `/next-change` — what to work on next, which model, and the pre-flight checklist. Derived live from files, never from memory.
- `/propose-apply-verify <name>` — drive one change end to end: propose, apply, then an autonomous verify-fix-reverify loop ending in a verification report. Archiving stays a separate, deliberate step.
- `/opsx:propose <name>` — expand a seeded change into design, specs, and tasks.
- `/opsx:apply <name>` — implement its tasks.
- `/opsx:archive <name>` — merge spec deltas into `openspec/specs/` and date-stamp the folder into `archive/`.
- `npm run roadmap:sync` — reconcile ROADMAP.md status cells from folder state. Never hand-stamp a status.

**When a change archives, its spec delta merges into `openspec/specs/` and every affected `docs/` page updates in the same change.** This is what stops the wiki rotting; treat a docs update as part of the work, not follow-up.

## Verification

- **Any change**: `npm test` and `npm run lint` green, `npm run typecheck` clean, `npm run build` clean, `npm run format:check` clean. **Formatting is a CI gate too** — it is listed here because leaving it off this list is exactly how it went red unnoticed across two changes; `npm run format` fixes it.
- **Auth-touching changes**: `npm run test:e2e:auth` against the local stack — four roles signing in, provisioning end to end, deactivation ending an open session.
- **Tenancy-touching changes**: the RLS isolation test suite must pass. It asserts that a session scoped to one outlet cannot read another's rows for *every* outlet-scoped table — a new table without a matching test is an incomplete change.
- **Billing or offline changes**: exercise the offline path — go offline, ring up bills, come back online, confirm exactly-once settlement with no duplicates.
- **UI changes**: run the app and look at it, on a phone viewport and a tablet viewport, in both light and dark themes.
- **Theme changes**: run the contrast validator, in both themes. AA is the floor, not the goal.
- **`*-live` changes**: confirm the surface actually moved from `demo` to `live`, and that demo mode still works afterwards.
- Prefer real verification over asserting success. If a gate was not run, say so.
