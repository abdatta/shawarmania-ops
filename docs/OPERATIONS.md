# Operations

> The build and CI pipeline landed with `project-foundations`. Hosting and the Supabase projects are **not yet provisioned** — those need an account holder, and are flagged below where they apply. Outlet onboarding lands at the end of the roadmap.

## Environments

| Environment | Purpose | Data |
|---|---|---|
| **Local** | Development | Supabase local stack, synthetic seed data |
| **Staging** | Verification before release | Separate Supabase project, synthetic data only |
| **Production** | The live counters | Separate Supabase project, real business data |

**Production data is never copied into staging or local.** It contains customer and employee PII. When a production-shaped dataset is needed for debugging, generate a synthetic one at the same scale.

**Neither staging nor production is provisioned yet.** Everything through the schema work runs on the local stack; the first change that genuinely needs a hosted project is attendance (#5), which puts real staff data in production.

⚠️ **The Supabase account already contains a project that has nothing to do with this system.** It is not linked to this repo and must not be. `supabase link` against it, or pointing `.env` at it, would run this project's migrations into unrelated data. When staging and production are created, they are **new projects** — confirmed with the owner on 2026-07-26. If a command ever reports this repo as linked, that is a mistake to undo rather than a convenience to accept.

## Configuration

Client-side environment variables — only ever the public pair:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The anon key is designed to be public; Row-Level Security is what protects the data. **The service-role key is never in client configuration.** It lives only in Edge Function secrets.

`.env.example` documents every variable. `.env` is gitignored and must stay that way.

Local development needs the Supabase CLI and Docker. `supabase start` brings the stack up from the committed `supabase/config.toml` and prints the local anon key to paste into `.env`. It prints a service-role key too — that one never leaves the terminal.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request, in two jobs:

| Job | Steps |
|---|---|
| `verify` | lint → format check → typecheck → unit tests → contrast validator → production build |
| `e2e` | Playwright, including the offline app-shell suite; uploads its report on failure |

`.github/workflows/deploy.yml` publishes to GitHub Pages on push to `main` — see below.

Both checkouts use `fetch-depth: 0` because the build stamps the short commit SHA into the UI.

## Deployment

The frontend is a static SPA — build, upload, done.

```bash
npm run build
```

Hosting is **GitHub Pages**, published by `.github/workflows/deploy.yml` on every push to `main`. It needs no third-party account and no DNS work, which is why it is the first-phase choice; Cloudflare Pages or Vercel remain better long-term hosting and are a workflow file plus DNS away.

One prerequisite, and it is not optional: **the repo is public.** Pages from a private repo requires a paid GitHub plan.

Beyond that the workflow is self-provisioning — `actions/configure-pages` enabled Pages on the first run, so the **Settings → Pages → Source** dropdown never had to be touched. If Pages is ever reset, that step will re-enable it rather than failing.

The site is live at **https://abdatta.github.io/shawarmania-ops/**, served at `https://<owner>.github.io/<repo>/`. Assets are immutable and hashed, so a rollback is re-running the deploy workflow on an earlier commit (`Actions → Deploy to GitHub Pages → Run workflow`).

### The base path

A GitHub Pages project site serves from `/<repo>/`, not from the root, and that sub-path is baked into the build. It is set by the `BASE_PATH` environment variable at build time, defaulting to `/shawarmania-ops/` so that a plain `npm run build` produces a deployable artifact.

Two consequences worth knowing before touching anything asset-related:

- **Never hard-code a root-absolute URL in application code.** Use `import.meta.env.BASE_URL`, or a path Vite rewrites. A `/icons/logo.png` written by hand works locally at the root and 404s in production. The E2E suite runs under the sub-path and fails on any request that 404s, so this is caught in CI rather than on a tablet.
- **Deep links depend on `404.html`.** Pages has no rewrite rules, so an unmatched path is a genuine 404; the build emits a copy of the shell as `404.html`, which Pages serves instead, and the app then routes the URL itself. A `.nojekyll` marker ships with it.

**Changing the base path on an origin that has already served the app orphans the old service worker.** A worker registered at the old scope keeps serving the old shell, and the old shell's router does not recognise the new path — the app loads and then claims every route does not exist, which reads as a routing bug rather than a caching one. If that happens, unregister the worker and clear its caches for that origin. It does not apply to a custom-domain move (the origin changes, so there is no overlapping registration) but it does apply to a repo rename.

### Moving to a custom domain later

Set `BASE_PATH: /` in `deploy.yml`, add a `CNAME` file, and point DNS at Pages. No source file changes.

To try a root build locally first, use PowerShell (`$env:BASE_PATH="/"; npm run build`). Git Bash on Windows rewrites a bare `/` into a Windows path before Node sees it, and the build silently comes out with a base of `/Program Files/Git/`.

Note that the origin changes, so **every installed PWA must be reinstalled** — an installed app is bound to its origin. Plan that for a quiet trading period and re-enrol counter tablets deliberately rather than discovering it mid-shift.

Privatising the repo at the same time needs a paid GitHub plan for Pages, or a move to different hosting. Worth deciding together with the domain, since both are disruptive in the same window.

Database changes deploy as migrations, applied to staging first and then production. **Migrations are forward-only**; a mistake is corrected by a new migration, not by editing a released one.

### Service worker caution

The PWA caches the app shell, which means **a bad deploy can persist on a counter tablet that has not refreshed**. Two mitigations, both non-optional, and both now implemented:

- The service worker checks for a new version on launch and applies it on the next load. It never reloads the page mid-use — that could discard a half-rung order with a customer waiting — so a new build takes effect one launch later. For the same reason `clientsClaim` is off: a worker that claimed an already-open page would start serving new-build assets to old-build code mid-shift.
- The build identifier (short commit SHA and build time) is visible in the app footer, so "what build is that tablet on?" is answerable over the phone rather than by driving to the outlet.

If a tablet needs forcing onto a new build, closing and reopening the app twice is enough. Do **not** clear site data as a first resort — from `counter-devices-and-offline` (#9) onward that destroys the outbox and any bills waiting in it.

## Onboarding a new franchise outlet

The repeatable path. **If any step here requires a code change, that is a bug** — outlet number seven must be a data operation.

1. **Create the outlet** (Super Admin → Outlets): name, address, contact, coordinates, geofence radius, business-day cutover.
2. **Set the coordinates accurately.** Attendance depends on them. Take them at the counter, not from a map search.
3. **Create the Franchise Admin** and hand over their one-time code.
4. **The Franchise Admin sets up the menu** — copy the standard menu, adjust prices if they differ.
5. **Enrol the counter tablet**: sign in on the device, enrol it to this outlet, confirm it appears under Devices.
6. **Add employees and billers** (Access), handing each their one-time code. Shift PINs arrive with counter-device enrolment; until then a Biller signs in with their own email on the tablet.
7. **Set the opening cash float** for the first business day.
8. **Verify isolation before going live** — sign in as the new Franchise Admin and confirm no other outlet is visible anywhere. This is a real step, not a formality: it is the last point at which a misconfiguration is cheap to fix.

## First production deploy

Once, per environment. Until it is done the deployed site is **demo-only**: the
demo tree needs no backend, and sign-in honestly reports that it cannot reach
the server.

⚠ **Create a new project.** The Supabase account holds an unrelated project;
linking this repo to it would run these migrations into someone else's data.

1. **Create the project.** Region `ap-south-1` (Mumbai) — every user is in West
   Bengal, and the round trip is the counter's latency. Keep the database
   password somewhere durable; it is not recoverable.

2. **Link and apply the schema.**

   ```
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

   `db push` applies migrations only. **Never run `supabase db reset` against a
   hosted project** — it drops everything and applies `seed.sql`, which creates
   synthetic staff whose password is published in this repo.

3. **Push the auth configuration.**

   ```
   npx supabase config push
   ```

   This carries the settings that make the whole permission model work:
   signup disabled, email confirmations off, and — the one that silently
   breaks everything if missed — the **custom access token hook**. Without it
   tokens carry no `app_role` or `app_outlet_id`, every policy denies, and a
   perfectly valid user sees a working app with nothing in it.

   Then correct one thing by hand: `config.toml` carries a localhost
   `site_url`, which is right for development and wrong for production. Set
   Site URL to the deployed URL in Authentication → URL Configuration. Nothing
   in v1 sends a link, so it is tidiness rather than function — until the first
   feature that does.

   Confirm in Authentication → Hooks that the access token hook is enabled and
   points at `public.custom_access_token_hook`.

4. **Deploy the Edge Functions** — after the migration, never before; they read
   tables and functions it creates.

   ```
   npx supabase functions deploy admin-accounts
   npx supabase functions deploy redeem-invite
   ```

   `redeem-invite` is declared `verify_jwt = false` in `config.toml`, because
   somebody who has never set a password has no token to present. Check it took
   effect: an unauthenticated `POST` with a wrong code must answer `400
   invalid_code`, not `401`.

5. **Create the first Super Admin.** Nothing in the app can do this — see
   [`supabase/snippets/bootstrap-first-admin.sql`](../supabase/snippets/bootstrap-first-admin.sql),
   which explains why and is safe to re-run. It is the only account ever
   created by hand.

6. **Create the outlets**, with coordinates captured standing at each counter.
   Also by hand for now; the Outlets screen lands with `outlet-onboarding`.

7. **Point the deployed site at the project.** Repository → Settings → Secrets
   and variables → Actions → *Variables*:

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the project's anon / publishable key |

   Variables rather than secrets, deliberately: both values are compiled into
   the JavaScript bundle and served to every visitor. That is the design — the
   anon key is public and RLS is the protection — and filing them as secrets
   would imply the service-role key is the same kind of thing. It is not, and
   it never leaves Edge Function configuration.

   Re-run the deploy workflow afterwards. A build that ran before the variables
   existed has the old (empty) values baked in; the variables are read at build
   time, not at page load.

8. **Verify, in this order.** Sign in as the Super Admin → People lists your
   own account → provision a Franchise Admin → redeem the code in a private
   window → that admin sees their outlet and nothing of any other.

## Managing accounts

Accounts are admin-provisioned; there is no self-service signup, and nothing is ever emailed or texted to anybody.

- **Super Admin → People** manages every account across all outlets.
- **Franchise Admin → Access** manages Billers and Employees in that admin's own outlet, and nothing else. The limits are enforced server-side from the caller's own session, not by the form.

**To give someone access**: add the account (name, email, role, outlet). A one-time code is shown **once**. Pass it on — WhatsApp is what the business already uses — and they set their own password at *Set your password* on the sign-in screen. There is nowhere to look the code up afterwards, so if the message is lost, issue a new one; doing so cancels the old code automatically.

**To reset a password**: issue a new code for that account. That is the entire reset story.

**To remove access**: deactivate the account. Do not delete it — history references it, and reactivating is one tap if the person comes back.

## Backups

Supabase takes automated daily backups on paid plans; the free tier does not, which is worth knowing before production data matters.

Beyond the provider default:

- **A weekly logical dump stored outside Supabase.** A backup that lives only with the provider does not protect against an account-level problem.
- **Restore must be tested, not assumed.** An untested backup is a hypothesis. Restore into a scratch project and confirm the data is actually usable.
- Dumps contain PII. They are encrypted at rest, never committed, and never placed in shared storage.

## Monitoring

Deliberately minimal at this scale — the useful signals are operational rather than infrastructural:

- **Sync backlog**: a tablet with a persistent unsynced queue is the most valuable alert in the system. It means bills exist in exactly one place.
- **Device last-seen**: a counter device silent during trading hours means something is wrong at that outlet.
- **Cash differences**: a consistently non-zero difference at one outlet is a business signal, and the app already computes it.
- Supabase's built-in error and usage dashboards cover the rest.

No third-party analytics or session-recording tooling. The app handles customer PII and employee location; sending that to an analytics vendor is not a trade worth making.

## Runbook stubs

**A counter tablet is lost or stolen** → revoke the device immediately (Franchise Admin → Devices). Any unsynced bills on it are lost; note the gap on that day's cash record. Enrol a replacement.

**Bills are not syncing** → check the device's pending count and network. The queue is durable; bills are not lost while the device is intact. Do not reinstall or clear site data — that destroys the outbox.

**Cash does not reconcile** → check for late-synced bills against a closed day (they surface as reconciliation exceptions), then cash expenses recorded under the wrong business date, then withdrawals not recorded.

**Someone cannot sign in** → confirm the account is active (People, or Access for one outlet) and that the **email address** matches exactly. Sign-in gives one message for a wrong address and a wrong password alike, so it will not tell you which. Issue a new code if the password is forgotten; there is no self-service reset.

**A one-time code will not work** → it expires after seven days, works once, is cancelled the moment a newer one is issued, and dies after five wrong attempts. All five look identical to the person typing it. The fix is always the same: issue a new code. Nobody can look the old one up — only a hash was ever stored.

**Someone must lose access now** → deactivate the account (People / Access). It takes effect on their very next request, without waiting for their session to expire, and their open app ends its session and says why. Reactivating restores it; their password still works.

**An employee cannot check in** → they are outside the geofence, or GPS will not fix. Use the counter tablet, or approve an override from the manager's phone.
