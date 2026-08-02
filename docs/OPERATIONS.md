# Operations

> Hosting and the production Supabase project are live. A person is created
> once, with one admin-chosen username and every starting assignment, before
> one activation link is issued. They open it, type the username shown there
> and the same new password twice. Ordinary account creation needs no email;
> any associated email is an alternate sign-in, and every live Super Admin
> requires one as a future recovery/security foundation. Forgotten passwords
> for every role use an admin-issued one-time link. Menu, tablet enrolment
> and opening cash float are still to come, and the steps below say which.

## Environments

| Environment | Purpose | Data |
|---|---|---|
| **Local** | Development | Supabase local stack, synthetic seed data |
| **Staging** | Verification before release | Separate Supabase project, synthetic data only |
| **Production** | The live counters | Separate Supabase project, real business data |

**Production data is never copied into staging or local.** It contains customer and employee PII. When a production-shaped dataset is needed for debugging, generate a synthetic one at the same scale.

**Production is provisioned and live** (2026-07-27), with the attendance and setup schema and screens deployed to it. Whatever is in it is real, and the first outlet created there is the business's own. Staging is still not provisioned; changes go from local to production, which is acceptable at this size and worth revisiting before the next franchise.

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

The verification suite is defined **once**, in `.github/workflows/verify.yml`,
as a reusable workflow nothing triggers directly. It has three jobs, split by
what each one needs — which is also the fastest way to guess why one is red:

| Job | Needs | Steps |
|---|---|---|
| `lint, types, unit tests` | nothing but the repo | lint → format check → typecheck → unit tests → contrast validator → production build |
| `e2e browser tests` | a browser | Playwright, including the offline app-shell suite; uploads its report on failure |
| `database + auth tests` | Docker and a database | fresh local Supabase stack, pgTAP, REST/RLS, the authenticated four-role Playwright suite, and generated-type drift |

Two workflows call it, and that single definition is the point — **what a pull
request is judged on and what a publish is gated on cannot drift apart**:

- `.github/workflows/ci.yml` runs it on every pull request.
- `.github/workflows/deploy.yml` runs it on every push to `main`, as the gate
  in front of the publish — see [Deployment](#deployment).

**Nothing runs it twice.** `ci.yml` deliberately does not trigger on a push to
`main`, because the deploy workflow's gate is that run. One suite per commit,
and on `main` it is the one that decides whether the commit reaches a counter.

### Reading the checks on a commit

A push to `main` produces five checks, and **they do not all appear at once**:

```
Deploy / gate / lint, types, unit tests
Deploy / gate / e2e browser tests
Deploy / gate / database + auth tests
Deploy / build
Deploy / deploy
```

**Read a check name right to left.** The last segment is the only part that
says what that job did; the two before it say where it sits. `Deploy` is the
workflow, which GitHub prepends to all five. `gate` is the stage — the job
that has to pass before anything is built or published. On a pull request the
same three read `CI / verify / …`, because there is no gate there, only the
suite.

**Four of the five start together.** The three gate jobs and `build` have no
dependencies, so they run at once; `build` finishes first, in about half a
minute. Only `deploy` waits, on both the gate and the build, and GitHub creates
a check when its job *starts* — so `deploy` cannot exist until the other four
have finished. A commit showing four checks is still being decided; five means
decided. There is no way to pre-declare it as pending.

**`build` does not wait for the tests, on purpose.** Nothing the suite produces
feeds it, so sequencing them only delays the answer by the length of the suite.
It also means `npm run auth:readiness` — the only check that probes the live
identity backend, and the one most likely to fail for reasons that have nothing
to do with the commit — reports in well under a minute rather than after five.
The artifact it uploads on a commit that then fails the gate is inert: `deploy`
needs both jobs, so nothing can publish it.

Add a step to `verify.yml` and both callers get it. Add one anywhere else and
only one of them does, which is the failure mode this structure exists to
prevent. The list in [`AGENTS.md`](../AGENTS.md) mirrors `verify.yml`; keep the
two in agreement in the same commit.

Every checkout uses `fetch-depth: 0` because the build stamps the short commit SHA into the UI.

## Deployment

The frontend is a static SPA — build, upload, done.

```bash
npm run build
```

Hosting is **GitHub Pages**, published by `.github/workflows/deploy.yml` on
every push to `main` that passes verification.
Hostinger holds the `shawarmania.in` DNS zone; the `ops` CNAME points to
`abdatta.github.io`, while GitHub Pages terminates TLS and serves the
deployment. Cloudflare Pages or Vercel remain later alternatives if the
repository becomes private or the hosting requirements outgrow Pages.

### A push to `main` publishes, once the suite agrees

**Pushing to `main` still deploys.** What changed on 2026-08-02 is what has to
happen first.

The two workflows used to be independent: both fired on a push to `main`, and
the deploy one ran only `npm ci`, the auth readiness probe and `npm run build`.
Nothing connected it to the tests. So a push published to the counters as soon
as the code *compiled*, while the suite was still running beside it or had
already gone red — and on 2026-08-01 that is exactly what happened three times
in one day. Attendance is in real use on staff phones, so that was live
exposure rather than a hypothetical.

**The deploy workflow now runs the whole verification suite as a job the
publish depends on**, from the same `verify.yml` a pull request uses. The
production build runs alongside it rather than behind it, and the publish
itself waits on both. A failure in either one means the publish job is never
created, so the previous Pages deployment stays live and untouched.

The gate includes the Docker-backed database job, and that was a deliberate call.
Most of that job tests the tenancy boundary, which a static bundle cannot
change — but it also holds `test:e2e:auth`, the only suite that drives all four
roles signing in against a real backend. A bundle that breaks sign-in is the
worst thing a publish could hand to somebody standing at a counter, and no
other job would notice.

**The cost is the wait.** A push to `main` now reaches the counters some
minutes later rather than immediately, and only if the suite agrees. That is
the trade being made on purpose.

**Rollback is unchanged**: **Actions → Deploy → Run workflow**,
choosing an earlier commit. It re-verifies that commit on the way through.
Accepted deliberately — the commit being rolled back to passed the same suite
when it landed, so the re-run is expected green, and a rollback only reaches a
counter tablet on its next launch anyway (see *Service worker caution* below).
CI minutes are not the slow part of a rollback.

One deploy runs at a time (`concurrency: pages`, never cancelled mid-flight),
so two pushes in quick succession queue rather than racing; cancelling a
half-finished publish is how a partial build gets served.

Before the workflow builds or uploads, `npm run auth:readiness` posts one
non-sensitive action to the hosted `email-sign-in` function. It permits
  publication only when the #24 database invariant confirms canonical
  Auth/profile/email-identity alignment, an active live Super Admin with private
  account email. A missing function or migration, timeout, non-success,
  malformed response, absent public build variable, or negative boolean stops
  the job before artifact upload, so the previous Pages deployment remains
  live. The public endpoint reveals only `ready`; direct database execution is
  service-role-only.

One prerequisite, and it is not optional: **the repo is public.** Pages from a private repo requires a paid GitHub plan.

Beyond that the workflow is self-provisioning — `actions/configure-pages` enabled Pages on the first run, so the **Settings → Pages → Source** dropdown never had to be touched. If Pages is ever reset, that step will re-enable it rather than failing.

The canonical production origin is **https://ops.shawarmania.in/**. GitHub Pages redirects the former `https://abdatta.github.io/shawarmania-ops/` project URL to the custom domain. Assets are immutable and hashed, so a rollback is re-running the deploy workflow on an earlier commit (`Actions → Deploy → Run workflow`).

### The base path

The custom domain serves from `/`, and that path is baked into the production build by `BASE_PATH: /` in the deploy workflow. The Vite configuration still defaults a plain local `npm run build` to `/shawarmania-ops/`; this keeps the sub-path contract exercised by local builds and the E2E suite instead of letting a root-absolute asset regression reach production.

Two consequences worth knowing before touching anything asset-related:

- **Never hard-code a root-absolute URL in application code.** Use `import.meta.env.BASE_URL`, or a path Vite rewrites. A `/icons/logo.png` written by hand works locally at the root and 404s in production. The E2E suite runs under the sub-path and fails on any request that 404s, so this is caught in CI rather than on a tablet.
- **Deep links depend on `404.html`.** Pages has no rewrite rules, so an unmatched path is a genuine 404; the build emits a copy of the shell as `404.html`, which Pages serves instead, and the app then routes the URL itself. A `.nojekyll` marker ships with it.

**Changing the base path on an origin that has already served the app orphans the old service worker.** A worker registered at the old scope keeps serving the old shell, and the old shell's router does not recognise the new path — the app loads and then claims every route does not exist, which reads as a routing bug rather than a caching one. If that happens, unregister the worker and clear its caches for that origin. It does not apply to a custom-domain move (the origin changes, so there is no overlapping registration) but it does apply to a repo rename.

### Custom domain

Three pieces must agree:

- `.github/workflows/deploy.yml` builds with `BASE_PATH: /`.
- `public/CNAME` contains exactly `ops.shawarmania.in`, so every Pages artifact records the intended hostname.
- Hostinger DNS has a CNAME record for host `ops` targeting `abdatta.github.io`; GitHub Pages has the same custom domain saved and HTTPS enforced.

To test the production shape locally, use PowerShell (`$env:BASE_PATH="/"; npm run build`). Git Bash on Windows rewrites a bare `/` into a Windows path before Node sees it, and the build silently comes out with a base of `/Program Files/Git/`.

The 2026-07-30 cutover changed the origin, so **every PWA installed from the old GitHub URL must be reinstalled from `ops.shawarmania.in`** — an installed app is bound to its origin. Re-enrol counter tablets deliberately once device enrolment exists; the current personal-login counter path only needs the app reinstalled.

Privatising the repo at the same time needs a paid GitHub plan for Pages, or a move to different hosting. Worth deciding together with the domain, since both are disruptive in the same window.

Database changes deploy as migrations. **Migrations are forward-only**; a
mistake is corrected by a new migration, not by editing a released one.

**The verified migration goes first, then the front end, in one workflow.** A
push to `main` runs the complete suite, then the `production-database` job runs
`supabase db push` through a project-scoped pooler URL stored as the environment
secret `SUPABASE_DB_URL`. Pages publication depends on that job. A missing
secret, connection failure, rejected migration or failed backfill assertion
leaves the existing frontend live; a transactional migration leaves production
unchanged when it fails.

That CI identity may push migrations and nothing broader. It receives no
service-role key, never reaches the browser bundle, and the workflow must never
run `db reset`, seed data or `config push` against the hosted project. The new
schema is live briefly before the new frontend, so every migration must remain
compatible with the currently published build for that ordering window. Split
a change when it cannot survive that order.

The repository needs one private GitHub environment named
`production-database`. Add its `SUPABASE_DB_URL` secret with:

```sh
gh secret set SUPABASE_DB_URL --env production-database
```

Paste the production project's Session pooler connection URL with the database
password percent-encoded. Do not use a personal Supabase access token, anon
key or service-role key for this job. After rotating the database password,
replace this secret before the next push to `main`; an absent or stale value is
expected to stop publication.

A manual workflow dispatch republishes an earlier frontend but deliberately
does not touch migration history. Database rollback remains forward-only: add a
corrective migration instead of asking an old commit to remove released schema.

### Installing the app

Open `https://ops.shawarmania.in/` in the browser. When the browser confirms
that the PWA is eligible, the download action appears in the public header and
continues into a signed-in role shell. Tap it to open the browser's native
install prompt. On iPhone or iPad Safari, tap the action and follow the shown
path: **Share → Add to Home Screen**, turn on **Open as Web App**, then tap
**Add**.

The action is intentionally absent when the app is already running from an
installed window, when the browser offers no supported path, and in demo mode.
If installation should be available but the action is missing, first confirm
the canonical HTTPS origin is open and that the browser has not already
installed the app. Do not clear site data on a counter tablet merely to recover
the prompt; once offline billing lands, that would destroy its pending outbox.

### Service worker caution

The PWA caches the app shell, which means **a bad deploy can persist on a counter tablet that has not refreshed**. Two mitigations, both non-optional, and both now implemented:

- The service worker checks for a new version on launch and applies it on the next load. It never reloads the page mid-use — that could discard a half-rung order with a customer waiting — so a new build takes effect one launch later. For the same reason `clientsClaim` is off: a worker that claimed an already-open page would start serving new-build assets to old-build code mid-shift.
- The build identifier (short commit SHA and build time) is visible in the app footer, so "what build is that tablet on?" is answerable over the phone rather than by driving to the outlet.

If a tablet needs forcing onto a new build, closing and reopening the app twice is enough. Do **not** clear site data as a first resort — from `counter-devices-and-offline` (#9) onward that destroys the outbox and any bills waiting in it.

## Onboarding a new franchise outlet

The repeatable path. **If any step here requires a code change, that is a bug** — outlet number seven must be a data operation.

> ⚠ **Steps 4, 5 and 7 are not built yet** and are marked below. Everything else is done in the app — no SQL console, at any step. **Order matters**: an outlet has to exist before anybody can be assigned to it.

1. **Create the outlet** (Super Admin → Outlets → *Add outlet*): short code, name, location label, address, phone, business-day cutover. Use **Find the address** to fill the address block from a search rather than typing five fields — it fills the District from the PIN code, which is the part nobody remembers. Check what it filled before saving; OpenStreetMap data is contributed rather than surveyed, and this address is what a GST invoice will carry. If it finds nothing, type it: the search is a shortcut and never a step. **The business-day cutover is not the opening time** — it is where one trading day ends and the next begins, so it belongs in the quiet hours (04:00 is the default and the owner-confirmed value for both outlets). The form resolves a whole session against whatever you type and warns if it would split one night across two days; leave it at 04:00 unless you have a reason. On a brand-new installation this is the only thing there is to do, and the empty screen says so.
2. **Capture the coordinates in the app, standing at the counter** (Super Admin → Outlets → *Capture position here*). Not from a map search, and not by typing them in — there is deliberately no field for that. The screen samples for a few seconds, keeps the tightest reading, and refuses to save a fix looser than ±50 m; step outside if the counter cannot produce one. Until an outlet is captured, its check-ins are recorded but not measured against any fence, and the Outlets screen shows it as unsurveyed.
3. **Create the Franchise Admin** (Super Admin → People): name, username and
   every outlet they manage, plus any optional staff facts. No email is needed.
   Send the one activation link. The outlet must exist first; if the same admin
   runs several outlets, select all now — one account and code cover every
   assignment.
4. **The Franchise Admin sets up the menu** — copy the standard menu, adjust prices if they differ. *(Not built — demo only until #10.)*
5. **Enrol the counter tablet**: sign in on the device, enrol it to this outlet,
   confirm it appears under Devices. *(Not built — #9.)* Until then a Biller
   signs in with their own username on the tablet; shift PINs arrive with
   enrolment.
6. **Add employees and billers** (People), sending each activation link.
   Creating a person requires name, username, one role and one or more outlets;
   job title, phone and joined date are optional. It writes the account and
   every selected assignment before showing one code, so the person appears on
   every selected outlet's attendance day immediately. A one-outlet manager
   keeps that outlet preselected. Later assignment changes keep the same
   account. A pending link is replaced transactionally; an activated person
   gets no code unless an admin explicitly chooses **New code**.
7. **Set the opening cash float** for the first business day. *(Not built — #12.)*
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

3. **Configure hosted Auth deliberately.**

   The committed `supabase/config.toml` is the local configuration: its
   `site_url` and redirect paths point at localhost. **Do not run `supabase
   config push` against production from that file.** In
   Authentication settings:

   - disable public signup; keep password/email provider support enabled
      because Supabase's username alias uses that provider;
   - keep email confirmation enabled and every admin-created account explicitly
     pre-confirmed;
   - set Site URL to `https://ops.shawarmania.in`;
   - keep Secure Email Change and double confirmation enabled, so a
     client-requested alias replacement cannot complete through the current
     non-deliverable alias;
   - do not register a Send Email Hook. This version sends no authentication
     mail.

   There is no access-token hook. Authority is resolved from
   `public.assignments` on every request, so a token carries nothing about what
   a person may do.

4. **Deploy all identity Edge Functions.**

   ```
   npx supabase functions deploy admin-accounts
   npx supabase functions deploy redeem-invite
   npx supabase functions deploy email-sign-in
   ```

   `redeem-invite` is declared `verify_jwt = false` in `config.toml`, because
   somebody who has never set a password has no token to present. Check it took
   effect: an unauthenticated `POST` with a wrong code must answer `400
   invalid_code`, not `401`.

5. **Create the first Super Admin.** Nothing in the app can bootstrap authority
   from an empty database — see
   [`supabase/snippets/bootstrap-first-admin.sql`](../supabase/snippets/bootstrap-first-admin.sql),
   which creates the profile, required private account email and owner
   assignment together, and is safe to re-run. The Auth user is created first
   at the chosen username alias. It is the only account ever created by hand.

6. **Sign in as that Super Admin and create the outlets in the app** (Outlets →
   *Add outlet*). Nothing here needs SQL, and nothing here should be given
   coordinates from a map: create the row, then **capture each position
   standing at the counter**, as described under *Onboarding a new franchise
   outlet* above. An outlet with no position records check-ins without judging
   them, which is honest; a placeholder judges everyone against a point nobody
   has stood on.

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

8. **Verify, in this order.** Sign in with the Super Admin username and then
   its associated email → People lists that account and its own read-only
   email → provision a
   username-only Franchise Admin → open the activation link in a private window
   → type the displayed username and matching passwords → that admin sees only
   their managed outlet → issue another Super Admin a reset link and confirm the
   handover uses the same three-field form. Subsequent deployment verification
   is read-only.

## Existing-account username migration

This is a supervised, one-time procedure. The operator tool is service-role
only, writes sensitive material under the ignored
`supabase/.username-migration/` directory with restricted permissions, and
never prints account emails. Do not run it in CI.

1. **Rehearse locally from a fresh production-shaped synthetic reset.**

   ```powershell
   npm run db:reset
   # Set the three local values from `supabase status` in this shell only.
   npm run auth:usernames:rehearse
   ```

   The rehearsal proves checkpoint interruption/resume, existing password and
   access/refresh-session survival, profile/assignment/attendance/invite row
   preservation, pending-invite preview/redeem, postflight, rollback and
   forward repair. It is hard-locked to `http://127.0.0.1:54321`.

2. **Confirm hosted Auth protects the alias.** Secure Email Change and double
   confirmation must be enabled before touching live identity. This migration
   does not add outbound mail or self-service recovery; one Super Admin remains
   the password-reset path for another.

3. **Apply the schema and deploy all three functions while retaining the current
   safe frontend.** Email-or-username is the steady-state contract, not a
   temporary compatibility mode. Before an Auth alias is migrated, the current
   email still signs in directly; afterwards an approved associated email
   signs in through `email-sign-in`. Do not push the permanent frontend yet.

   ```powershell
   npx supabase db push
   npx supabase functions deploy admin-accounts
   npx supabase functions deploy redeem-invite
   npx supabase functions deploy email-sign-in
   ```

   The migration copies every current live Super Admin's real Auth email into
   the private account-email table before it enforces the one-way Super Admin
   requirement. It does not rename an Auth user.

4. **Generate and review the private production mapping.** Supply the hosted
   URL and service-role key in the operator shell only:

   ```powershell
   npm run auth:usernames -- --dry-run
   ```

   First rerun dry-run with `--approve-email <profile-uuid>` once per account
   whose current real email is approved for retention; this is mandatory for
   every live Super Admin. Then open
   `supabase/.username-migration/mapping.json` locally. The business owner
   reviews and edits **every** proposed username, resolves collisions, and
   confirms every retained email. The approval flags
   regenerate the mapping, so do not edit usernames before that final dry run.
   Never paste the mapping into chat, an issue, logs, or source control.

5. **Seal the explicit approval, then apply.**

   ```powershell
   npm run auth:usernames -- --approve-mapping --approved-by business-owner
   npm run auth:usernames -- --apply
   npm run auth:usernames -- --postflight
   ```

   The seal covers every user ID, old identifier, username, alias and approved
   account email. Any later edit invalidates it. Apply also reloads Auth first and
   refuses before its first write if a user appeared, disappeared, or drifted
   after review. It checkpoints after each user and is idempotent.

6. **Open the static publication gate.** Run the same probe locally with the
   hosted public URL/key in the shell, then push the permanent frontend:

   ```powershell
   npm run auth:readiness
   ```

   GitHub repeats the probe before build/upload. Do not bypass it by publishing
   `dist` manually. Once the permanent build is live, delete the obsolete
   `VITE_AUTH_CUTOVER_MODE` repository variable; the final frontend has no
   compatibility branch.

7. **Prove the live migration.** Confirm each
   existing password works with its approved username, an already-open session
   still reads and refreshes, every pending invite previews the approved
   username, and assignments/attendance counts match the preflight. Confirm
   every approved associated email reaches the same Auth user as its username.
   Hand each active person their username. Confirm one authorized Super Admin
   can issue another Super Admin a reset link without sending mail.

8. **Close the rollback window.** Verify the permanent username-or-email form
   plus production health using read-only actions. Keep the reviewed mapping
   only for the agreed short rollback window; then run:

   ```powershell
   npm run auth:usernames -- --destroy-mapping
   ```

   After destruction, repair is forward-only: correct a username or account
   email through the supported privileged path rather than trying to recreate
   deleted staff PII.

**Rollback before the mapping is destroyed:** run
`npm run auth:usernames -- --rollback`. This restores reviewed legacy Auth
emails without recreating users, passwords or sessions; no application
rollback is needed because dual sign-in is permanent. The active schema still
requires each live Super Admin account email, so those private rows remain.
The checkpoint is unwound,
allowing a corrected approved mapping to be applied forward again. Do not edit
or reverse a released SQL migration.

## Managing accounts

Accounts are admin-provisioned; there is no self-service signup. Activation and
reset links for every role are handed over by the administrator rather than
sent by the app. This version sends no authentication mail.

- **Super Admin → People** manages every account across all outlets.
- **Franchise Admin → People** manages Billers and Employees only at the outlets where that admin holds a live Franchise Admin assignment. One managed outlet stays preselected; several become a checkbox list. The limits are enforced server-side from the caller's own session, not by the form.

**To give someone access**: add the account with name, username, role and
role-appropriate outlets. Phone, title and joining date are optional. Only a
Super Admin also needs an account email. Every selected assignment is written
before the handover is shown **once**, alongside the username—read it before
sending anything. Send the activation link (WhatsApp is what the business
already uses): they open it, see “Your username is …”, type that username and
the same new password twice, and are signed in. The QR is for handing a phone
across a counter. The link contains only the code. If it is lost, issue a new
one; that cancels the old one automatically.

**If you change an assignment before activation**: finish the grant or end action and use the replacement link that appears. The database changes the assignment, invalidates the old link, and creates the replacement in one transaction, so there is no state where the placement changed but the admin has no working handover. If no activation link was outstanding, the assignment changes with no code panel.

**If somebody says the username is wrong**, fix it with *Change username*.
The same outstanding link immediately previews the correction and remains
usable, although telling the person the correction is still necessary.

**If the People screen says failed activations are unusually high** (owner only), somebody is trying codes. Nothing is at immediate risk — a code is 50 bits, single-use, and expires in a week — but it is worth knowing when it happens. Outstanding codes are unaffected by another person's guessing; the endpoint refuses the guesser, not the invite.

**To fix a wrong username**: *Change username* on their row. The current user
ID, password, sessions, assignments and outstanding code remain. The old
username stops signing in and the corrected one starts.

**To reset a password**: issue a new code and hand over its link. This is the
path for every role, including Super Admin; one Super Admin helps another. An
associated email remains an alternate sign-in and does not currently grant
self-service recovery.

**To fix a Super Admin account email**: another Super Admin chooses *Change
email*. One's own value is read-only in People; use another Super Admin or
the operator fallback rather than weakening the self-management boundary.

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
- **Identity functions**: monitor `admin-accounts`, `redeem-invite`, and
  `email-sign-in` non-2xx rates plus email-sign-in abuse limits. Logs may name
  an action/result but never a raw account email, password, Auth alias, token
  hash or invite code.
- Supabase's built-in error and usage dashboards cover the rest.

No third-party analytics or session-recording tooling. The app handles customer PII and employee location; sending that to an analytics vendor is not a trade worth making.

**Two public lookup services are contacted only from the outlet form.**
`photon.komoot.io` (OpenStreetMap geocoding) and `api.postalpincode.in` (India
Post's PIN directory) answer postal-address search. Both are keyless. They see
only what an admin types while finding their shop; no customer, employee,
billing or identity data reaches either. If either disappears the address
block remains manually typeable.

## Runbook stubs

**A counter tablet is lost or stolen** → revoke the device immediately (Franchise Admin → Devices). Any unsynced bills on it are lost; note the gap on that day's cash record. Enrol a replacement.

**Bills are not syncing** → check the device's pending count and network. The queue is durable; bills are not lost while the device is intact. Do not reinstall or clear site data — that destroys the outbox.

**Cash does not reconcile** → check for late-synced bills against a closed day (they surface as reconciliation exceptions), then cash expenses recorded under the wrong business date, then withdrawals not recorded.

**Someone cannot sign in** → read the username on their People row and confirm
they type it without `@`, or use the associated email when one exists. Sign-in
gives one message for an unknown username/email and wrong password alike.
Correct a typo with *Change username*; an outstanding
 link remains attached to the account. Confirm the profile is active and still
 has a live assignment. If the password is forgotten, issue a new one-time link.
 This is also the current path for a Super Admin; one owner must help another.

**An activation link will not work** → it expires after seven days, works once,
and is cancelled when a newer one is issued. Granting or ending an assignment
while it is pending immediately shows the transactional replacement. The page
must show the expected username. A different typed username consumes nothing;
correct the account or explain the spelling. Every code-state failure remains
identical. If the latest link was lost, issue a new one. Nobody can retrieve
the old plaintext because only its hash was stored.

**Every Super Admin is locked out** → verify each person's identity out of band,
then use the service-role operator repair to issue or restore access to one
existing account. That owner can issue another owner an ordinary reset link.
Do not create a replacement owner, weaken assignment policies, expose account
email, or enable unreviewed authentication mail to solve the lockout.

**"Too many activation attempts from this connection"** → the endpoint's own rate limit, not a problem with the code. It clears within fifteen minutes. A working activation never counts toward it — only failures do — so seeing this means something on that connection has been failing repeatedly.

**An outlet was created by mistake** → Outlets → **Mark closed**, then **Delete**. Deletion is offered only on a closed outlet, so the reversible step comes first, and it cannot be undone. It will work only while nothing at all references the outlet; if anything does, the screen names what — staff, accounts, tablets, recorded days — and nothing is removed. Move or remove those and it becomes deletable on its own, with nothing to re-mark afterwards. **An outlet that ever traded cannot be deleted, by anyone, ever** — that is the point, not a limitation: its bills and attendance are the business's history. Mark it closed instead. And note that an outlet which has ever had a Franchise Admin cannot be emptied simply by deactivating them; see [Limitations](LIMITATIONS.md).

**Someone must lose access now** → deactivate the account (People / Access). It takes effect on their very next request, without waiting for their session to expire, and their open app ends its session and says why. Reactivating restores it; their password still works.

**An employee cannot check in** → in order: are they on People at this outlet, active, and not departed? A departed or deactivated person keeps their history but is not offered a check-in. Then: they are outside the geofence or GPS will not fix — which no longer blocks anything, so tell them to **record it anyway** and approve it yourself; or **enter the arrival for them** (Attendance → their row): past times only, on today's business day, recorded as entered by you and settled by the act of recording it. If check-in is refused outright with a message about the outlet being closed, somebody marked it closed on Outlets; reopening it is one tap and needs nothing else.

**A day shows as absent and shouldn't** → in order: is an arrival recorded at all? If it is, nobody has approved it — the day counts for nothing until somebody does, so approve it from the attendance day (one tap from inside the outlet on the day itself, a typed reason otherwise). If there is no arrival, the day is *derived* absent rather than written that way: either record the arrival for them, or **mark the day as leave** if they were genuinely off. Nothing in the app knows a roster, so a weekly off reads as absent until somebody marks it ([Limitations](LIMITATIONS.md)).

**Everyone is reading as late** → check the outlet's **Staff are expected by** time on Outlets. It defaults to 13:00 and is per outlet, so a shop that opens in the afternoon needs its own. Changing it applies from then on only: every day already recorded keeps the deadline it was recorded under, by design, so fixing the setting will not fix yesterday's labels. Lateness is a tag either way and deducts nothing on its own.

**Days are piling up unapproved** → the Attendance tab itself carries a count, so this is visible from wherever you are rather than only from the screen that needed reading. On the attendance surface the owner gets a chip per outlet with its own count — visible without opening each shop, and choosing one brings the view to it — while the day picker counts the day on screen and its two arrows carry a dot when **that same outlet** holds unapproved arrivals on earlier or later days. Follow the dots back until they go. Each day is then approved on its own: there is deliberately no bulk action, because a button that settles a whole morning is how an arrival nobody saw gets counted. The position is read once and reused for a minute, so a run of approvals is not a run of GPS reads. Approving from away from the outlet is allowed and asks for a reason, which is stored on each day and readable by the person it is about — so a week of approvals given from home is a week of visible reasons rather than an invisible habit.
