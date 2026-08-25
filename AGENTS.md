# Agent Guide

Shawarmania Ops is a multi-outlet cash-counter and outlet-management PWA for **Shawarmania**, a quick-service shawarma business operating in Kalyani and Kanchrapara, West Bengal. It handles counter billing, employee attendance, menu, inventory, expenses, daily cash reconciliation, basic profit/loss estimates, and outlet↔owner messaging — with each outlet's data strictly isolated so the business can grow through franchises.

**Status: the whole UI is walkable, and it is being made real one surface at a time.** The schema, tenancy policies, the adapter seam, the four role shells, demo mode and authentication all exist. Every surface is built and walkable end to end at `/demo` over one internally consistent scenario spanning both outlets; each one becomes real when a `*-live` change swaps its adapter and promotes its gate.

**This file does not say which surfaces are real, deliberately.** That answer moves on somebody else's change, and a copy of it here goes stale silently, which is exactly what happened to the two sentences this paragraph replaced. Two sources carry it and neither can drift:

- [`openspec/changes/ROADMAP.md`](openspec/changes/ROADMAP.md) — what is built and what comes next, derived from the change folders by `npm run roadmap:sync`.
- [`src/gates/registry.ts`](src/gates/registry.ts) — `hidden`, `demo` or `live` per surface. This is the authority; it is what the app itself reads.

## North Star

The tablet at each counter takes money without ever stopping, and the owner sees every outlet's truth from their phone.

Two consequences follow from that sentence, and they outrank convenience everywhere in this repo: **billing must survive a dead internet connection**, and **an outlet must never see another outlet's data**.

## Hard Rules

### Tenancy

- Outlet isolation is a **database boundary, not a UI concern**. Every outlet-scoped table carries `outlet_id` and ships its Row-Level Security policy in the same change that creates the table.
- **Authority is an assignment, and nothing about it is in the access token.** A person holds rows in `public.assignments` (person × role × outlet); policies resolve scope by membership through `app_is_owner()`, `app_outlets_for(role)` and `app_has_role_at(role, outlet)`. There are no role claims — a change bites at the next request. One person has one login however many outlets they work at, and nothing is session-scoped: no active role, no switcher, no "acting as".
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
- **If a change alters a surface's layout, that surface's shimmer is reshaped in the same change.** A placeholder reserves the shape of what is arriving; when the arriving shape moves and the placeholder does not, the surface reflows again and nothing automated will say so.

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

- **Personal human accounts** (all four roles): an admin-chosen, business-wide username plus password. An account with a private associated email may use either identifier with the same password. Supabase stores the username as a reserved non-deliverable Auth alias; it is provider plumbing, never contact data. Phone numbers remain optional contact facts, not credentials.
- **Counter tablet** (Biller): the *tablet* is set up once, with a one-time code an admin generates on their own phone, and holds a long-lived device session scoped by RLS to exactly one outlet. A person then opens a **shift** by typing their username on the tablet and entering the tablet's four-digit code on their own phone; no password is ever typed on the tablet, nobody who cannot see the tablet can open a counter, and there is no fallback approver.

Three rules that follow, and that a change touching auth must not quietly undo:

- **Accounts are admin-provisioned with a username and one-time code, handed over by hand.** Activation and staff reset are never emailed or texted by the app. The code is stored only as a hash, in a column no client role can read — so it is shown to the issuing admin once and is genuinely unrecoverable afterwards. Every code-related failure returns one identical response; a username mismatch does not consume the code.
- **Every live Super Admin has a private account email.** It is a permanent alternate sign-in identifier and a foundation for future recovery or security messages. Another role may receive an associated email later without changing authentication, but ordinary account creation does not collect one. For now every role, including Super Admin, recovers through a fresh admin-issued one-time link; automated email recovery is deferred.
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
- `/quickfix` — the same journey for a **bug fix or small correction**, at the weight one deserves: reproduce, fix, pin with one test proved to fail without it, push and let CI gate. It refuses itself for migrations, policies, money, offline, the gate registry and the demo seam. See [The quickfix lane](#the-quickfix-lane) for why the shorter path is safe and where it is not.
- `/opsx:propose <name>` — expand a seeded change into design, specs, and tasks.
- `/opsx:apply <name>` — implement its tasks.
- `/opsx:archive <name>` — merge spec deltas into `openspec/specs/` and date-stamp the folder into `archive/`.
- `npm run roadmap:sync` — reconcile ROADMAP.md status cells from folder state. Never hand-stamp a status.

**When a change archives, its spec delta merges into `openspec/specs/` and every affected `docs/` page updates in the same change.** This is what stops the wiki rotting; treat a docs update as part of the work, not follow-up.

## Verification

**This list mirrors `.github/workflows/verify.yml`, and is meant to stay that way.** A gate that CI runs and this list omits is a gate nobody runs before pushing — which is exactly how `format:check` stayed red across two changes before anybody noticed. If you add a CI step, add it here in the same commit.

`verify.yml` is the one definition of the suite, and nothing triggers it directly. Two workflows call it: `ci.yml` on every pull request, and `deploy.yml` on every push to `main`, where it gates the production migration and Pages publication (the production build runs alongside verification, and its artifact is inert unless both verification and migration are green). **So this list is also what gates a release** — a check added here and to `verify.yml` protects both paths, and a check added anywhere else protects only one. A push to `main` still deploys; it applies forward production migrations after verification and publishes only when both succeed. A red commit or migration leaves the current production build live. See [Operations](docs/OPERATIONS.md#a-push-to-main-publishes-once-the-suite-agrees).

The suite runs three jobs. The first two need nothing but the repo (the verify
job also installs Deno 2.x for its typed Edge Function contract):

- **Any change**: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` — then `npm run test:e2e`, which builds for production and drives it. `npm run format` fixes formatting. `npm run lint` bundles four repo-invariant checks alongside ESLint: no hex outside tokens, the behaviour-backlog index, the living-spec capability index, and **`lint:functions`, which fails when an Edge Function carries no `[functions.<name>]` block** — an undeclared function silently gets `verify_jwt = true` and refuses every token-free caller at the gateway. The prose tier also runs both index checks, so a markdown-only archive cannot let either map drift.

- **`functions:typecheck` — generated-schema Edge boundary.** Deno compiles the shared restaurant-mapping helper against `src/data-access/database.types.ts`. Every automated query for a restaurant identity goes through that helper: `state` is the column and `enabled` is its value, never a boolean column. The app TypeScript project intentionally excludes Edge Functions, so this is a separate gate for that boundary.

The third job needs Docker, which is why it is the easy one to skip and the one worth being strict about:

```
npm run db:start && npm run db:reset
npm run test:db && npm run test:rls && npm run test:e2e:auth
npm run db:types
git diff --exit-code src/data-access/database.types.ts
```

- **`test:db` / `test:rls` — tenancy.** A session scoped to one outlet cannot read another's rows, for *every* outlet-scoped table; a new table without a matching test is an incomplete change. Run these whenever a migration, a policy or a table changes.
- **`test:e2e:auth` — the four roles against a real backend.** Signing in, provisioning end to end, deactivation ending an open session. **Run it for far more than changes to sign-in.** It asserts on what each role *lands on* and on the chrome around it, so anything under `src/auth/`, any shell, any account menu, and **any surface that is a role's index** is inside its blast radius. `ui-owner-console-and-demo` rewrote the owner's index and broke this suite while every other gate stayed green; "it does not touch auth" was the wrong question.
- **Generated types — schema parity.** After every migration change, regenerate from the reset schema and inspect the result. The final diff check must be clean once the expected generated file is staged; `typecheck` cannot detect a valid but stale schema snapshot.
- **Billing or offline changes**: exercise the offline path — go offline, ring up bills, come back online, confirm exactly-once settlement with no duplicates.
- **UI changes**: run the app and look at it, on a phone viewport and a tablet viewport, in both light and dark themes.
- **Theme changes**: run the contrast validator, in both themes. AA is the floor, not the goal.
- **`*-live` changes**: confirm the surface actually moved from `demo` to `live`, and that demo mode still works afterwards.
- Prefer real verification over asserting success. If a gate was not run, say so.

### The quickfix lane

**A bug fix is not a roadmap change.** Run it like one and most of the effort
goes on artifacts a correction does not need, and on local suites CI is about to
run anyway. Run `/quickfix` instead; the reasoning it encodes is below, because a
lane whose reasons live only in a skill file is a lane nobody trusts under
pressure. `attendance-position-free-commands` is the change that prompted this,
if you want a worked example.

**Why pushing early is safe here.** `deploy.yml` declares `migrate: needs: gate`
and `deploy: needs: [gate, build, migrate]`. A red gate publishes nothing and
migrates nothing, and the build already on the counter stays live. CI is a hard
gate, not an advisory one, so running the full suite locally buys a faster red
rather than a safer deploy — and it runs three jobs in parallel, which beats
running them yourself in series.

**A prose-only commit gets the `Prose` tier and no deployment**, so a fix whose
diff turns out to be documentation only will show no `Deploy` run and will not
move the `Build <sha>` in the app footer. That is correct, not a failed push:
there is nothing in such a commit to publish. Verify against the last commit that
touched the app, and use `Actions → Deploy → Run workflow` if you need the stamp
moved deliberately. See `docs/TESTING.md` for the two tiers.

**What a quickfix still owes, and none of it is optional:**

- **A reproduction before the change.** If you cannot make it fail on demand,
  you do not know what you are fixing.
- **One test that fails before the fix and passes after.** Prove it by reverting
  the fix and re-running, not by reasoning about it. This costs about a minute
  and is the only thing separating a fix from a hope.
- **For anything about the shape of a request, one cheap proof the database
  accepts the new payload.** A payload assertion proves what left; it says
  nothing about what the far end does with it. One rolled-back call closes that,
  and reading the function body to convince yourself does not — that is
  inference. This is the exact gap that let the original bug ship.
- **`npm run typecheck` and the test files the change touches.** Seconds.
- **A change folder**, which the spec-driven rule means literally: a
  one-paragraph `proposal.md` carrying the gate, and `tasks.md`. OpenSpec's own
  `applyRequires` is `["tasks"]`, and `design.md` plus a spec delta are for
  changes that decide something. **A fix that restores behaviour an existing
  requirement already demands needs no delta** — it was never a contract change,
  and the archive flow handles a change that has none.
- **If the reproduction shows an existing test could not have caught this,
  tighten that test in the same commit.** A test asserting only that something
  rejected, or counting rows it does not own, is green for a reason other than
  the one it claims — and will stay green when the bug returns. Cheap to fix
  while you are already in the file.
- **A one-line docs update where the fix implies a rule.** The essay can wait;
  the rule cannot, because the rule is what stops the recurrence.

**Where the lane is refused, and the reason is never "the tests might fail":**

- **Migrations.** `migrate` is forward-only and a manual frontend rollback keeps
  the forward schema. A migration that passes every test and is still wrong is
  not undone by a follow-up push.
- **RLS or policy changes.** Silent over-permission passes every functional test
  in this repo. That is what `test:db` and `test:rls` exist for.
- **Money arithmetic, offline and outbox semantics, the gate registry, and the
  demo seam.** Each fails in a way a green suite does not describe.

Anything on that list runs the full local gate set, including the Docker job,
before it is pushed. Everything else pushes on the strength of the list above
and lets CI decide.
