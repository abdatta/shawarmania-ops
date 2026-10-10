# Operations

> Hosting and the production Supabase project are live. A person is created
> once, with one admin-chosen username and every starting assignment, before
> one activation link is issued. They open it, type the username shown there
> and the same new password twice. Ordinary account creation needs no email;
> any associated email is an alternate sign-in, and every live Super Admin
> requires one as a future recovery/security foundation. Forgotten passwords
> for every role use an admin-issued one-time link. Counter tablets are set up
> with a one-time code and open a shift through a two-device handshake. Menu is
> still to come, and the steps below say which. There is no opening cash float to
> set: an outlet's first drawer count is its anchor.

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

**A prose-only push produces no checks and no deployment, deliberately.** Both
`Deploy` and `CI` skip a commit that cannot change what is built, served or
migrated — the documentation tree, the change, spec and backlog directories, root
markdown — and the `Prose` workflow gates those instead (see
[`TESTING.md`](TESTING.md)). Nothing is published because nothing in such a commit
can reach a counter.

The visible consequence is the build stamp: **after a prose-only push,
`Build <sha>` in the app footer names the last commit that changed the app, not
the tip of `main`.** That is the more truthful number, since it names the code
actually running rather than whatever happened to be at the tip when Pages last
ran, but it does mean "the deployed build carries my commit" is the wrong check
after a docs commit. Compare against the last commit that touched the app instead.

To republish deliberately — a rollback, or forcing the stamp forward — use
`Actions → Deploy → Run workflow`. `workflow_dispatch` is never path-filtered.

## Deployment

The frontend is a static SPA — build, upload, done.

```bash
npm run build
```

Hosting is **GitHub Pages**, published by `.github/workflows/deploy.yml` on
every push to `main` that passes verification.
Hostinger held the `shawarmania.in` DNS zone until the receipt page needed a
Worker on the apex; see [The customer's receipt link](#the-customers-receipt-link-54)
for the move to Cloudflare and its rollback. This app is unaffected either
way: the `ops` CNAME points to
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

The 2026-07-30 cutover changed the origin, so **every PWA installed from the old GitHub URL must be reinstalled from `ops.shawarmania.in`** — an installed app is bound to its origin. A counter tablet moved to a new origin holds no session there, so it has to be **set up again**: remove the old tablet under Tablets, then generate a fresh setup code and type it at the counter.

Privatising the repo at the same time needs a paid GitHub plan for Pages, or a move to different hosting. Worth deciding together with the domain, since both are disruptive in the same window.

Database changes deploy as migrations. **Migrations are forward-only**; a
mistake is corrected by a new migration, not by editing a released one.

**A release is three things, and they land in dependency order:** the schema,
the Edge Functions that call the schema, and the bundle that calls those
functions. A push to `main` runs the complete suite, then `migrate`, then
`functions`, and publishes only after all of them agree. Every intermediate
state has the newer half waiting for callers, never a caller waiting for the
newer half.

`migrate` runs `supabase db push` through a project-scoped pooler URL stored as
the environment secret `SUPABASE_DB_URL`. A missing secret, connection failure,
rejected migration or failed backfill assertion leaves the existing frontend
live; a transactional migration leaves production unchanged when it fails.

`functions` deploys **every** Edge Function in `supabase/functions/`, naming
none of them, using an account access token stored as the environment secret
`SUPABASE_ACCESS_TOKEN`. The project it deploys to is derived from
`VITE_SUPABASE_URL`, the same variable the published bundle is built against, so
functions cannot reach a project other than the one the app talks to; the job
fails rather than guessing when that variable is absent or malformed. It never
passes `--prune`, so a function present in the project and absent locally is
left alone rather than deleted.

**Edge Functions were outside this workflow until 2026-08-11**, and that is
worth knowing rather than quietly fixed. They were deployed by hand from step 4
of *First production deploy*, which named three functions and was never updated
when more were added. `counter-devices` and `counter-setup` shipped with
`counter-devices-and-offline` on 2026-08-09, were never deployed, and answered
404 for two days while the bundle calling them was live: the tablet handshake
was fully built and entirely unreachable. Nothing reconciled the runbook against
the directory, so nothing could have caught it. The list is now gone rather than
corrected, because a corrected list drifts again on the next function.

That CI identity may push migrations and nothing broader. It receives no
service-role key, never reaches the browser bundle, and the workflow must never
run `db reset`, seed data or `config push` against the hosted project. The new
schema is live briefly before the new frontend, so every migration must remain
compatible with the currently published build for that ordering window. Split
a change when it cannot survive that order.

The repository needs two private GitHub environments, one per credential class.
They are kept apart on purpose: the job that pushes migrations must not also
hold a token that can deploy code.

**Create the environment before setting its secret.** `gh secret set --env` does
not create a missing environment; it fails fetching the encryption key, and the
error names the public-key URL rather than the environment, so it reads as a
permissions problem:

```
failed to fetch public key: HTTP 404: Not Found
  (.../environments/production-functions/secrets/public-key)
```

```sh
gh api -X PUT repos/:owner/:repo/environments/production-database
gh api -X PUT repos/:owner/:repo/environments/production-functions
```

Both are idempotent, so re-running them on an environment that already exists
changes nothing.

`production-database` holds `SUPABASE_DB_URL`:

```sh
gh secret set SUPABASE_DB_URL --env production-database
```

Paste the production project's Session pooler connection URL with the database
password percent-encoded. Do not use a personal Supabase access token, anon
key or service-role key for this job. After rotating the database password,
replace this secret before the next push to `main`; an absent or stale value is
expected to stop publication.

`production-functions` holds `SUPABASE_ACCESS_TOKEN`:

```sh
gh secret set SUPABASE_ACCESS_TOKEN --env production-functions
```

Paste a Supabase account access token from
**Account → Access Tokens**. It deploys function code and nothing else: it is
not the service-role key, never reaches the browser bundle, and the job needs no
database credential because the deployment is an API call rather than a
connection. An absent token stops publication rather than silently skipping the
functions, which is the whole point: a release that quietly omits half the
backend is the failure this job was added to prevent.

**One token per consumer.** A Supabase access token is scoped to the *account*,
not to a project, so any token here can reach every project the account owns.
That is why the `functions` job pins `--project-ref` derived from
`VITE_SUPABASE_URL` instead of letting the CLI choose a default, and it is why
this token is not shared with another repository's CI: sharing one would give
that repository's workflow the ability to deploy code to this production
backend, and would couple the two rotations so that rotating for one silently
stops the other's releases. Confirm what is set rather than assuming:

```sh
gh secret list --env production-functions
```

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
the prompt; that destroys its pending billing outbox.

### Service worker caution

The PWA caches the app shell, which means **a bad deploy can persist on a counter tablet that has not refreshed**. Two mitigations, both non-optional, and both now implemented:

- **The app looks for a new build on launch, on returning to the foreground, on regaining connectivity, and every five minutes while it stays open.** No cooldown suppresses a check, so closing and reopening the app is always a dependable way to force one. A device that stays open and connected therefore picks up a deploy within five minutes at worst, rather than waiting for somebody to relaunch it.
- **A found build is activated immediately but never applied to the running page unasked.** The app takes it by reloading itself only from a state where a reload costs nothing: online, nothing typed on screen worth keeping, no order being composed, no write in flight. It waits a few seconds and re-checks before reloading, so a reload cannot land in the gap between two orders.
- **When the page is busy, the header offers an Update action instead**, and the app takes the build by itself the moment the page frees up. The action keeps expanding and collapsing while it waits, because a counter tablet is not being watched. A device that stays busy all shift keeps the action and takes the build on its next launch, which is what it did before this existed.
- `clientsClaim` is off, which governs one thing only: a **first** worker does not adopt the page that installed it, so the shell is offline-capable from the next launch. It says nothing about updates. An updated worker that skips waiting takes control of open pages by definition, and what actually protects an open page is the app owning the reload rather than the registration library performing it. An earlier version of this page claimed otherwise.
- The build identifier (short commit SHA and build time) is visible in the app footer, so "what build is that tablet on?" is answerable over the phone rather than by driving to the outlet.

If a tablet needs forcing onto a new build, closing and reopening the app twice is enough. Do **not** clear site data as a first resort — from `counter-devices-and-offline` (#9) onward that destroys the outbox and any bills waiting in it.

From Billing V2.1, a compatible build also keeps one complete resume record. To
rehearse it, approve a real test shift online, read the menu/pipeline/bills once,
close the app, take the backend away and reopen it. The same counter must open
with every remembered surface labelled by read time. Capture work, close and
reopen once more, then reconnect: tablet/shift resolution must happen before the
queue drains, and authoritative reads replace remembered ones only after drain.
Never clear site data to repair an unsupported record; preserve it and every
envelope, reconnect, and let a compatible/current build write a fresh record.

## The public menu *(the-menu-is-public)*

The same Worker serves `shawarmania.in/menu/<address>/` — each trading outlet's
menu, read live through `public_menu()` and cached at Cloudflare for a minute —
and redirects `/menu/` to Kalyani Cafe's. There is no setup: an outlet's address
is made from its name when it is created, and its menu is public as soon as it
has an item. To take one off, mark the outlet closed or empty its menu; the page
then says the menu was not found, exactly as for an address nobody holds.

Managers use item Move up/down and Edit highlights in Menu to save outlet-local ordering and a named selection. After the ops migration and app release, the existing Worker consumes nonempty highlights as its first ordinary-shaped section; no brand-site deployment or credential change is required. Dishes remain in their categories, and an empty selection publishes no section. Changes become visible on the next cache miss within the existing minute; an ops outage continues to use the Worker's existing last-good fallback. Whole-bill discount shortcuts are configured in the outlet's Orders settings, with their own Save, independently of service settings. A highlight title never creates a discount.

## The customer's receipt link *(#54)*

The receipt page is **not deployed from this repo.** It is a Cloudflare Worker
living in the brand site's repo,
[`abdatta/shawarmania`](https://github.com/abdatta/shawarmania), routed on
`shawarmania.in/bill*`. This repo owns the link, the
token and the reader function; that one owns the page and the PDF. Neither half is
useful alone.

### The address, and what it is registered as *(#66)*

| Address | Serves |
|---|---|
| `https://shawarmania.in/bill?t=<token>` | the receipt; `&view=counter` is the counter's View receipt |
| `https://shawarmania.in/bill/<token>.pdf` | its PDF, linked from the page |
| `https://shawarmania.in/bill/<token>` | a 301 to the first row, keeping `view` |

**`https://shawarmania.in/bill?` is registered on Airtel DLT as the sender's
dynamic CTA URL**, and the receipt SMS template's `{#url#}` is validated against it.
So the part before the `?` must never change: a new domain, a new path or a link
shortener is a new CTA registration, and until it is approved every receipt SMS
fails DLT's check. Changing `VITE_RECEIPT_BASE_URL` in production is the same
event.

The Worker's receipt route is `shawarmania.in/bill*`. **Not an exact
`shawarmania.in/bill`**: Cloudflare does not match a pattern with no wildcard once
the URL carries a query string, which is every receipt link. That was deployed
first on 2026-10-02 and let `/bill?t=…` fall through to GitHub Pages' 404 for a
few minutes. The site has no page under `/bill`, and the Worker answers anything
there it does not own with a 404.

**A change to the address releases the Worker first.** The live app keeps handing
out the old shape until its own deploy lands, and the counter's View receipt frames
it; a Worker that answers both shapes is what makes the order safe.

### The DNS move — completed 2026-09-10

A Worker cannot be routed on the apex path until the zone is on Cloudflare. The
owner completed that move at a quiet hour on 2026-09-10 and verified both the
marketing site and the receipt route afterwards.

Cloudflare is now the authoritative DNS provider for `shawarmania.in`; Hostinger
remains the registrar and retains the former records for rollback. The imported
records were checked against this list before the nameserver change:

| Record | Value |
|---|---|
| apex `A` × 4 | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (GitHub Pages) |
| apex `AAAA` | the matching GitHub Pages addresses |
| `www` `CNAME` | `abdatta.github.io` |
| `ops` `CNAME` | `abdatta.github.io` (this app) |

The completed runbook was:

1. Create the `shawarmania.in` zone in Cloudflare and let it import the existing
   records.
2. **Verify every imported record against the table above before touching the
   nameservers.** This is the step that makes the move safe.
3. Set SSL mode to **Full**.
4. Switch the nameservers at Hostinger.
5. Add the Worker route on `/bill/*` (`/bill*` since #66).

GitHub Pages keeps serving everything, including this app on `ops`; Cloudflare
only adds the one route. **Rollback is switching the nameservers back** to
Hostinger, whose records are unchanged throughout. The landing site never moves
and `public/CNAME` never changes.

Both repos were first built and verified against a `workers.dev` URL; the apex
route was the last step. If the move is ever reverted, the fallback is
`bill.shawarmania.in` as a `CNAME` at Hostinger pointing at the Worker — a
different URL, no migration.

### The Worker's secret

The Worker holds the **ops project's service-role key** as a Cloudflare Worker
secret. It is the one credential it needs and the only privileged thing it can
do with it is call `bill_public_receipt()` and `public_menu()`.

- Never in either repo, never in a committed config file, never in a bundle. The
  standing rule about the service-role key is unchanged; the Worker is a
  server-side runtime, not a browser.
- To rotate: rotate the key in Supabase, set the new Worker secret, redeploy the
  Worker. Receipts refuse identically while the two disagree, which is a visible
  outage of the receipt page and nothing else — no counter, no ops surface and no
  billing path touches it.

### Revoking one link

A link leaked, was screenshotted into a group chat, or went to the wrong number.
Revocation is immediate, permanent for that token, and kills **no other bill's
link**:

```sql
select public.revoke_bill_public_link('<bill id>');
```

The customer who legitimately needs a receipt is not permanently refused one — a
fresh token can be minted, and the revoked one stays dead:

```sql
select public.reissue_bill_public_link('<bill id>');
```

Both are service-role only and there is no UI for either, so they are run from
the production project's SQL editor in the Supabase dashboard. **Neither can
modify the bill**, which is the reason the token lives in its own table.

To find the bill behind a link somebody sends you, read the token, not the URL:

```sql
select bill_id, created_at, revoked_at
  from public.bill_public_links where token = '<token>';
```

### The kill switch

Turning the whole public endpoint off, for every link at once, **with no
deploy**:

```sql
update public.public_receipt_settings set enabled = false;
```

Every request then gets the same refusal an invented token gets, so nobody
learns from the outside that it was switched off rather than broken. Turning it
back on restores every link that was not individually revoked:

```sql
update public.public_receipt_settings set enabled = true;
```

Reach for this when something is wrong at scale — a harvesting attempt in the
access record, a page bug showing the wrong bill — and for one bad link reach for
revocation instead.

### Reading the access record

Written only when a token resolves, so it holds openings rather than attempts.
The most-opened links, and the busiest clients, over a week:

```sql
select token, count(*) as opens, max(viewed_at) as last_open
  from public.bill_public_link_views
 where viewed_at > now() - interval '7 days'
 group by token order by opens desc limit 20;

select client_address_digest, count(distinct token) as receipts, count(*) as opens
  from public.bill_public_link_views
 where viewed_at > now() - interval '7 days'
 group by 1 order by receipts desc limit 20;
```

One client reading many distinct receipts is the shape of a harvest. One receipt
opened many times is a customer, or a chat app building previews. The digest is
salted and cannot be turned back into an address; it is there to tell one client
from another, not to identify anybody.

### Automatic receipt SMS *(#59)*

DLT sender `DEDTTL` and MSG91 template `6ac1321521ce1c2d3f08a382` send earned
points, outlet balance and `https://shawarmania.in/bill?t=<token>`. Providing a
valid number opts into this service receipt. The sender is disabled on migration;
publish matching `/messages/`, `/terms/` and `/privacy/` before enabling it.

Deploy `send-bill-receipts` and `bill-receipt-report`. Set server-only
`MSG91_AUTHKEY`, `RECEIPT_WORKER_SECRET` and `RECEIPT_WEBHOOK_SECRET`; use distinct
random credentials of at least 32 characters. With service authority call
`bill_receipt_configure(false, <sender URL>, <worker secret>)` to save the endpoint
and credential in Vault. Configure MSG91's final-report webhook to the report
function URL, header `x-receipt-webhook-secret`, and JSON fields `billId` from
`UUID`, `requestId` from `requestId`, and `status` from `status`. No mobile field
is needed. Then call `bill_receipt_configure(true)`; its cutoff excludes all bills
paid earlier, even if their offline commands arrive later.

The deferred settlement trigger creates a job after points are written. `pg_net`
wakes the worker after commit and the minute `bill-receipt-recovery` cron retries
queued wakeups. Claims are atomic and an automatic submission is never repeated.
**Submitted** means MSG91 accepted it; **Delivered** requires its final report.
An abandoned claim or lost response becomes **Uncertain**. In Billing history,
open Customer details to see the status; reload to see a later report. Use Send
receipt on WhatsApp for failures or uncertainty. Never reset a claimed job to
queued: that risks sending twice. To pause new work and claims, call
`bill_receipt_configure(false)`; payment keeps working. Previously queued work can
resume after re-enabling; historical bills are never backfilled. Check cron
health and MSG91 webhook auto-pause when reports stop arriving.

### Sending a receipt on WhatsApp *(#63)*

When automatic SMS delivery fails or is uncertain, a receipt can go out by hand.
In Billing history, expand the bill:

- **Send receipt** (green, WhatsApp's mark) shows when the bill carries the
  customer's number. It opens WhatsApp on that number with the bill number, its
  total and the receipt link typed. **Check the chat is the right person, then
  tap Send.** Nothing goes until you do.
- **Open receipt** shows when there is no number. It opens the receipt page; its
  ⋮ menu shares, copies the link, downloads the PDF or opens it in full Chrome.

**At the counter, a biller can show the bill instead.** In Bills this shift,
expand the bill and tap **View receipt**: the receipt opens over the counter,
which is blurred behind it, and **Close** returns to the counter. Nothing is sent.
A bill rung offline shows the button greyed out until it syncs.

**Ask before sending.** A customer gives their number to earn points, and that is
not permission to message them.

**The message comes from whichever WhatsApp is signed in on that phone.** On the
owner's phone that is the owner's personal number, name and photo, for every
customer. If that is not wanted, put the free **WhatsApp Business** app on a
dedicated outlet number (named for the outlet, with a profile and an away
message) on the phone used for this. Where a phone has both WhatsApp and WhatsApp
Business, Android asks which to open, or uses the one set as default.

## Onboarding a new franchise outlet

The repeatable path. **If any step here requires a code change, that is a bug** — outlet number seven must be a data operation.

> Everything here is done in the app—no SQL console. **Order matters**: the
> complete real menu is entered before the tablet is set up, and ledger handover
> is scheduled only after shadow billing succeeds.

1. **Create the outlet** (Super Admin → Outlets → *Add outlet*): short code, name, location label, address, phone, business-day cutover. Use **Find the address** to fill the address block from a search rather than typing five fields — it fills the District from the PIN code, which is the part nobody remembers. Check what it filled before saving; OpenStreetMap data is contributed rather than surveyed, and this address is what a GST invoice will carry. If it finds nothing, type it: the search is a shortcut and never a step. **The business-day cutover is not the opening time** — it is where one trading day ends and the next begins, so it belongs in the quiet hours (04:00 is the default and the owner-confirmed value for both outlets). The form resolves a whole session against whatever you type and warns if it would split one night across two days; leave it at 04:00 unless you have a reason. On a brand-new installation this is the only thing there is to do, and the empty screen says so.
2. **Capture the coordinates in the app, standing at the counter** (Super Admin → Outlets → the outlet → **Capture** on its check-in fence). Not from a map search, and not by typing them in — there is deliberately no field for that. The screen samples for a few seconds, keeps the tightest reading, and refuses to save a fix looser than ±50 m; step outside if the counter cannot produce one. Until an outlet is captured, its check-ins are recorded but not measured against any fence, and the outlet's page shows its fence as *Not captured*.
3. **Create the Franchise Admin** (Super Admin → Team): name, username and
   every outlet they manage, plus any optional staff facts. No email is needed.
   Send the one activation link. The outlet must exist first; if the same admin
   runs several outlets, select all now — one account and code cover every
   assignment.
4. **The Franchise Admin prepares the menu**—copy the standard menu and adjust
   prices where this outlet differs.
5. **Enter the outlet's complete real menu through Menu.** Create every item,
   check prices, category order and availability, then remove a test item and
   confirm historical captured lines do not change. Do this before a tablet is
   set up; a counter with an incomplete menu is not ready for shadow billing.
   The outlet's page shows its **Public menu** address; that is the menu
   customers read, live, from the moment it has an item. Print the table QR
   codes from that address, and do not change it afterwards — printed codes stop
   working if it changes.
6. **Set the counter tablet up**: on your own phone, open **Outlets**, tap the
   outlet, and choose **Set up** on its Tablets. Name the tablet what is written
   on the back of it, and generate a **setup code**. Walk to the counter, open the app on the tablet at
   `/counter/setup`, and type the code. The tablet is then that outlet's counter
   and appears under that outlet's Tablets.

   Three things worth knowing before you do it. The code is shown **once**, is
   good for **fifteen minutes**, and works **once** — generate another if you
   lose it, which costs nothing. **No password is ever typed on the tablet**, at
   setup or afterwards. An outlet may hold **several** tablets, each set up by
   its own code and each removable alone; what it may not hold is two live
   counters answering to the same label. Replacing one
   means removing the old one first, which is permanent and immediate.

   **An enrolled tablet can later be edited from its outlet's page.** A Super Admin may
   change its name and current outlet; a Franchise Admin may rename a tablet at
   an outlet they manage, while its outlet remains fixed in the form. Renaming
   does not require the counter to be idle. Moving an outlet is an atomic
   maintenance operation: both outlets must be active, the tablet must have no
   live shift or pending request, its most recent report must be within 30
   minutes and say that no local work is unresolved, and the new name must be
   unique there. The existing machine identity, proven session and browser
   credentials survive, so no setup code is issued. A move changes only the
   tablet's current and future context; bills and other historical rows remain
   attributed to the outlet recorded on them, and the device cannot read its
   former outlet after the move. If the preconditions are not met, finish or
   cancel the counter work and re-read its state before trying again.

   **Then choose how the counter serves** (the outlet's page → **Orders**). A new
   outlet has chosen nothing and bills exactly as the counter always has, with no
   question about dine-in or takeaway and no packaging line. Turn on what the shop
   actually does — dine-in, takeaway, table numbers, a packaging charge per bag or
   flat, free for gold members — and **Save**. The outlet's own manager can do this
   too. The tablet picks it up at its next menu refresh, or at once on a reload.

7. **Add employees and billers** (Team), sending each activation link.
   Creating a person requires name, username, one role and one or more outlets;
   job title, phone and joined date are optional. It writes the account and
   every selected assignment before showing one code, so the person appears on
   every selected outlet's attendance day immediately. A one-outlet manager
   keeps that outlet preselected. Later assignment changes keep the same
   account. A pending link is replaced transactionally; an activated person
   gets no code unless an admin explicitly chooses **New code**.
8. **Count the drawer once, on the Cash drawer screen.** That first count is the
   outlet's anchor: it carries no opening, no expected total and no difference,
   because there is nothing before it to compare against. Every later opening is
   the previous count's carry-forward. There is no opening float to set anywhere
   else, and no screen asks for one.
9. **Verify isolation before going live** — sign in as the new Franchise Admin and confirm no other outlet is visible anywhere. This is a real step, not a formality: it is the last point at which a misconfiguration is cheap to fix.
10. **Confirm the outlet reads on the derived Ledger.** Nothing is started or
   switched on: the Ledger assembles each day from bills, expenses, aggregator
   figures, drawer cash out and observations, so a date nobody has touched still
   renders in full. Check that yesterday reads, and that the outlet appears in
   the switcher.
11. **Shadow billing before taking customer money.** Open a real tablet shift,
   ring direct and handover payments with test amounts, force it offline and back
   online, verify exactly one server bill per payment, and correct both an
   immediate and an on-handover payment inside their five-minute windows. Force
   a response loss and restart once with the payment/correction chain unsent;
   verify one bill, one correction revision and effective Cash/UPI totals after
   recovery. Open Finish day while the edit window is still live, verify it is
   advisory and choose Finish day now, then cancel the test orders and have a
   manager void the test bills with reasons. Also rehearse Leave counter while
   offline: the later sale must settle once under the old operator with an
   After operator left marker, never under the incoming operator.
12. **Take customer money.** There is no handover step to schedule any more.
   The Outlets form no longer offers a counter-billing start date, because there
   is no second record to hand over from: bills are the Cash and UPI of every
   trading day from the first one the outlet rings.

Roll billing out at **Kalyani first**, because it has the first tablet. Trade one
full business day and close it cleanly before repeating setup and handover at
Kanchrapara.

**The shakedown was a parallel run, not a shadow test.** Kalyani's tablet took
real customer money from 12 Aug 2026, and every bill it rang was also written
down by hand. That was deliberate: the bugs worth finding are the ones a real
queue of customers produces, and the hand-written record was the second copy that
made it safe to look for them. It ran until the two records agreed over enough
trading to trust the system.

**The parallel run ended on 2026-08-31**, when `retire-the-manual-ledger` (#12)
carried the hand-written rows into the live records and removed the second one.
The per-outlet handover it was building towards never had to be performed: a
handover moves an outlet from one of two records to the other, and there is now
only one. A new outlet therefore has no parallel run to complete — it opens on
the live records directly, which is what steps 8 to 12 above describe.

## Kitchen tablets *(#70)*

**Setting one up.** On the outlet's page, **Tablets → Set up**, name it, choose *Use this tablet for:* **Kitchen**, and type the code on the tablet as for any counter. It opens on the kitchen's shift-start screen; somebody who may hold a counter shift starts one from their phone.

**Two kitchens.** Pair them as *Only these* on one and *Everything except* — the same list — on the other, so every dish lands somewhere and a category added later lands on the second. Two *Only* lists can leave a category on neither; each tablet's header says what it shows, which is how to spot it.

**Turning a counter into a kitchen** (Tablets → Edit → *Use this tablet for*). Refused, naming the orders, while it holds unsent work or orders it took that are still unfinished — only it can finish them, so finish, pay or cancel them there first. Any live shift on it ends with the change.

**Sound and screen.** After a reload the browser holds sound back until the screen is touched; the tablet says so and one tap restores it. Where the browser cannot keep the display awake, set the tablet's own display to stay on while charging. A kitchen tablet must stay online: it shows *Out of sync* whenever it cannot trust what it shows.

## Counting the drawer *(the live nightly job — #11)*

**Under a minute, from a phone, standing at the counter.** The drawer opens on a
balance rather than a date, because that is the question you have when you walk
in.

1. **Drawer**, pick the outlet if you manage more than one. Read *In the drawer
   now*, at the top right of the card, with the last count and anything worth
   knowing about it on the chips beneath.
2. **Count & Collect.** Three inputs: when you counted it, what was in it, how
   much you are taking. The count and the collection are one act, so they are
   one button.
   - *Counted when?* defaults to **Now**, with **15m ago** and **30m ago**
     beside it and a date and time field for a count you are catching up
     on days later. **Every count is approximate**, whichever you pick, because
     counting takes a few minutes and the counter keeps selling while you do it.
     The screen states in rupees how much cash moved near your time.
   - *Cash counted before collection* shows the difference as you type, in words
     as well as by sign.
   - *Cash collected, if any* starts at **0**, so a night you collect nothing is
     three taps and one number. **A minus means you are putting money IN**, which
     is what happens when a thin drawer gets topped up. The screen says so on the
     keystroke.
3. **If the screen names an exact run of bills**, that is a fact about your timing,
   not a suggestion. Move the boundary if you recognise those bills; leave it if
   you do not. **It will never propose a time for you**, deliberately.
4. **Where you are is read, not typed.** Standing at the outlet, the sheet says
   *at the outlet* and asks nothing. Anywhere else — or if your phone cannot get
   a fix at all — it asks why, and it wants an answer before it will save.
   Nothing is refused for being elsewhere; the record just says where you were.
5. **Collecting without counting?** Use **Only Collect**. It states that nothing
   is verified, which is the point.
6. **Bought something out of the till?** Use **Other Spend**, with a reason.
   It moves the drawer and stays out of the month's operating costs.
7. **Past counts** are underneath, newest first: tap one to see who recorded it,
   what they took, why they were away, and the control to adjust it. Older ones
   load as you reach the bottom of the list.

**A skipped day needs nothing special.** Come back two days later and count; the
screen says how many days the count covers before you take it, and the arithmetic
sums all of them by the same path as a single evening.

**Nothing here is a "close".** There is no seal, no signature, and no day that
stops accepting work. A bill that lands after a count is reported beside it, and
you either accept it or count again.

## Recording a trading day by hand

**There is no longer a way to do this, and that is the point.** The notebook
(#36) was the hand-typed record of the trading period before each outlet's
tablet existed. `retire-the-manual-ledger` (#12) carried its rows into the drawer
and the one expense record and removed the surface, so no screen accepts a typed
cash figure, opening float or aggregator amount for a trading day any more.

What used to be typed here is now recorded where it happens:

- **Cash and UPI** come from settled bills at the counter.
- **The drawer** is counted on the Cash drawer screen — see *Counting the
  drawer* above — and every later opening is the previous count's carry-forward.
- **Cash added and cash withdrawn** are drawer cash out, signed: a collection is
  positive, a top-up is negative, and equipment bought with drawer cash is a
  spend with its reason, never an expense.
- **Expenses** are recorded on the Expenses screen by whoever spent the money.
- **Aggregator trade** arrives from the sync, or from an operator statement when
  the sync is blocked — see the section below.

Reading a day, including every date that predates the tablets, is the derived
**Ledger**. Carried dates render through the same reader as yesterday, showing
the date they were recorded for and **no time of day** — the notebook never
captured an hour, and a plausible one nobody wrote down would be worse than
none. On the Drawer, where the list is not scoped to a date, a carried count
shows its date in the place an ordinary one shows its date and time.

## Bringing a period in by hand when the sync is blocked *(#43)*

Zomato revenue and Hyperpure expenses are read automatically twice a day and can
no longer be typed. The day the automation is blocked — Zomato changed an API,
blocking got aggressive, a CI policy changed — a person recovers the period by
uploading the operator's own statement, on **Super Admin → Ledger → Delivery →
Zomato → Upload a statement**. A Hyperpure statement is parsed by the same code the
robot uses, so that path is exercised on every scheduled run. A Zomato payout workbook
is not what the Zomato robot reads, so its parser is held to the robot's rules instead:
it settles a week only when Zomato has paid it, under the same cycle, with the same
deductions (`zomato-upload-settles-like-the-sync`).

Three files, each downloaded from the operator's own portal and recognised by
what is inside it, never by its name:

| File | Where | Covers |
|---|---|---|
| Zomato order history | Order history → **Download data → Order history** (a zip) | revenue to **yesterday**, commission undetermined |
| Zomato payout workbook | Finance → **Payouts →** download a **PAID** cycle (xlsx), **one outlet at a time** | a settled week: commission, and the Hyperpure bills, ads, TDS and additions the payout carried |
| Hyperpure statement | menu → **Account statement** → dates → **Download** (xlsx, ≤92 days) | supply purchases, one per order |

Notes that save a support call:

- **Order history stops at yesterday** — the portal says so — and the settlement
  workbook exists only once a cycle is **paid**, so the current week's commission
  is obtainable by no route until Zomato settles it. That is why a commission can
  read "not known yet" and a month total is a ceiling.
- **A Zomato week is uploadable only after its payout date.** Until Zomato marks
  a week PAID, its workbook says `pending` against every order and the upload is
  refused with exactly that: *Zomato has not paid 21 Sep 2026 - 27 Sep 2026 yet: 54
  of 55 orders are still pending settlement.* Nothing is written. The robot waits
  for the same signal, because a closed week's payout can already reflect a
  deduction that its deduction list does not show for another two days.
- **A Zomato workbook is refused, by reason, when it cannot be settled
  faithfully:** it names no week, it covers two restaurants, its restaurant is not
  one you may write for, its itemised deductions do not add up to its own totals
  (both amounts are named), or it carries an adjustment from a previous week,
  whose sign no workbook has yet proved.
- **A week the robot already settled is left alone.** The upload says so, and
  says whether your file agrees with the payout held, to the rupee.
- **The upload writes only the outlets you may reach**, derived from your own
  session, and a stored statement is reachable only from those outlets. A file
  that matches no known shape is refused in the file's own words and writes
  nothing.
- **Re-uploading the same file changes nothing.** A purchase is keyed on its order
  number and a settled day is final, so nothing is counted twice.

### Changing Hyperpure's physical delivery outlet

Hyperpure attribution changes by invoice date, not by changing the provider
app's current address and not by flipping one undated outlet flag. Add a dated
row to `supplier_delivery_routes`; a statement spanning the boundary will then
route its orders to both outlets in one atomic ingest. Hyperpure order identity
is global across outlets, so replaying the normal 28-day window cannot create a
second expense after a cutover.

For a production cutover, pause only `hyperpure.yml`, apply the reviewed forward
migration and compatible parser, then change `HYPERPURE_OPS_OUTLET_ID` in
`abdatta/shawarmania-sync` to the outlet that should own future **run-health**
rows. That variable does not route expenses and historical health rows stay
where they were recorded. `HYPERPURE_DELIVERY_OUTLET_ID` is the account-level
API header and does not change merely because physical delivery moved.

Verify first with `rehearse=true`, then one ordinary read, using only the stored
session. The rehearsal downloads and reconciles but posts nothing. If the stored
session is unavailable or lapsed, stop and report that blocker: this procedure
does not dispatch `login.yml`, start capture/reconnect, open a code request, or
request or submit an OTP. After the ordinary read, verify the dated outlet split,
global source-reference uniqueness, the expected anchor order and unchanged
paise under replay before resuming `hyperpure.yml`.

Outside this guarded cutover procedure, if the reader itself has merely lost its
session, prefer **Reconnect** on the same page over an upload: it repairs the
session and the next scheduled run catches up. During this cutover, a lapsed
session is a stop condition and never authorises reconnect or OTP work.

One reconnect covers both channels *(#44)*. Pressing it first checks what is
actually broken, then does the least repair that works: if only Hyperpure has
lost its session while Zomato is still signed in, a runner quietly re-mints the
Hyperpure session from the live Zomato login — no second sign-in, no code, a few
minutes. If Zomato itself has been signed out, the full sign-in runs, and only
then does a code box appear — at the moment Zomato has actually sent one, not
before. If nothing is wrong at all, the screen says you are still signed in and
starts nothing. The manual upload above stays valid in every state for the day
even the fallback path is wanted.

## Reading the run history *(#48)*

**Super Admin → Delivery** is one entry for both restaurant channels. The badge
on it is the sum across them; the switch at the top of the surface shows each
channel's share without being selected, so nothing is waiting invisibly behind
the channel that is not on screen. The channel is in the address
(`…/ledger/delivery/zomato`), which is what makes a link to one of them land on
it — and where exactly one channel has work waiting, opening the entry opens on
that channel. The old `…/ledger/zomato` and `…/ledger/swiggy` links still work
and redirect.

Beneath **Needs you**, **What has happened** is the history: every run the sync
has made for the selected channel and outlet, newest first, loading a page at a
time as you scroll. Reading it:

- **A row is a run**, not a summary of a day. The ones that moved figures say
  what moved, in rupees and from → to, on the row itself — `12 Aug revised
  ₹9,410.00 → ₹9,286.50`, `Week 3–9 Aug paid ₹10,642.70`, `3 Hyperpure orders
  added`. Nothing has to be expanded to see a figure.
- **A collapsed line stands for several runs** that told an identical story, and
  it always says how many and over what span — `3 reads · 5:15 am–11:15 pm`.
  Tap it to see each run's time. Runs never collapse across a change of outcome,
  a run that moved a figure, a run you asked for, a channel, or a day, so a line
  never claims a continuity that did not happen.
- **A run you asked for is always its own line**, marked `you asked`. Four taps
  of **Read now** are four lines, however identical, because you will look for
  yours by its time.

**Finding a healed outage.** A repair takes the matter out of *Needs you* and
clears the badge, and it deliberately leaves the failures alone. So when the
question is "what happened last Tuesday", scroll the history to that day: a
session that died overnight reads as one `Signed out` line carrying the count of
reads that failed while it was out, followed by the run that fixed it. That
evidence is the reason a row is a run — nothing else in the app records it, and
the badge is designed to stop mentioning it the moment it is resolved.

**Runs older than the summaries.** Below a marked line, the history reaches runs
recorded before it kept track of what they changed. They say when they ran and
how they went and nothing more, and that is permanent: what a run changed can
only be worked out while it is running, because once a figure is written a day
restated identically is indistinguishable from a day that moved.

**How often it reads is the runner's answer, not the app's.** The caption beside
the last-run time — `four times a day` — and the wait before **Read now** does
anything again both come from a number the runner reports with each run: it
parses the cron in its own workflow file and posts what it fires. So changing a
cron in `abdatta/shawarmania-sync` corrects both, on the next run, with no
deploy here. Until a reader has reported once, the app shows its own fallback of
four. The history shows the cadence each run ran under rather than today's, so a
schedule change leaves older rows reading correctly.

**Rehearsals never appear.** A rehearsal reads a real cycle and throws the
writes away, so it says nothing about the figures and is not part of this
record.

## How often a table was shared, and dine-in went without one *(#60)*

Two numbers the owner asked for once outlets choose how they serve. Both are read
from the SQL editor; neither has a screen.

**Two open orders on one table.** The counter refuses a busy table, but the
database never does: two tablets that could not see each other, a tablet working
from a stale pipeline, and a payment taken back after the table was seated again
can each put a second open order on it, and by then the food may be served. So
the server marks every order involved as it happens, in the write's own
transaction, and never unmarks one. An order does not remember its table's
history, so this mark is the only reliable record.

```sql
-- How many incidents, per outlet and day: one row per table that was shared.
select o.name as outlet, r.business_date, r.table_number, count(*) as orders
  from public.orders r join public.outlets o on o.id = r.outlet_id
 where r.table_shared
 group by o.name, r.business_date, r.table_number
 order by r.business_date desc, o.name, r.table_number;
```

`count(*) where table_shared` alone is the number of orders that shared a table.
The mark survives payment and cancellation, so a day's figure does not shrink as
its orders are settled.

**Dine-in with no table.** Nothing is recorded specially; the order says so.

```sql
select o.name as outlet, r.business_date,
       count(*) filter (where r.table_number is null) as without_a_table,
       count(*) as dine_in
  from public.orders r join public.outlets o on o.id = r.outlet_id
 where r.service_type = 'dine_in' and r.status <> 'cancelled'
 group by o.name, r.business_date
 order by r.business_date desc, o.name;
```

An order does not record whether its outlet had table numbers switched on when it
was rung, so *No table* chosen at the pad and an outlet with no table numbers
read alike. Read the figure against the outlet's settings, which change rarely.

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

4. **Deploy every Edge Function.**

   ```
   npx supabase functions deploy --project-ref <ref>
   ```

   No function is named, deliberately: the command deploys every directory
   under `supabase/functions/`, so a function added later cannot be left behind
   by a list nobody updated. This step is for bootstrapping a project that has
   no CI yet. **From 2026-08-11 the release does this on every push to `main`**,
   between the migration and the publication, so a hand deploy afterwards is a
   recovery action rather than routine.

   Then prove the gateway is serving each token-free function as one. Any
   function declared `verify_jwt = false` in `config.toml` exists to answer a
   caller who holds no token — `redeem-invite` for somebody who has never set a
   password, `counter-setup` for a tablet that has never been set up — and if
   the declaration did not take effect they answer `401` to every legitimate
   request while looking perfectly healthy. An unauthenticated `POST` carrying a
   junk payload must be refused by the **function**, not the gateway:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://<ref>.supabase.co/functions/v1/redeem-invite \
     -H 'content-type: application/json' -d '{"action":"preview","code":"NOPE"}'
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://<ref>.supabase.co/functions/v1/counter-setup \
     -H 'content-type: application/json' -d '{"code":"NOPE"}'
   ```

   `400` is correct. `401` means the flag did not take effect. `404` means the
   function is not deployed at all. `npm run lint:functions` checks the
   declaration exists in the repository; only this probe checks the platform
   honoured it, which is why both are kept.

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
   its associated email → Team lists that account and its own read-only
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

3. **Apply the schema and deploy the functions while retaining the current
   safe frontend.** Email-or-username is the steady-state contract, not a
   temporary compatibility mode. Before an Auth alias is migrated, the current
   email still signs in directly; afterwards an approved associated email
   signs in through `email-sign-in`. Do not push the permanent frontend yet.

   ```powershell
   npx supabase db push
   npx supabase functions deploy
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

- **Super Admin → Team** manages every account across all outlets.
- **Franchise Admin → Team** manages Billers and Employees only at the outlets where that admin holds a live Franchise Admin assignment. One managed outlet stays preselected; several become a checkbox list. The limits are enforced server-side from the caller's own session, not by the form.

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

**If the Team screen says failed activations are unusually high** (owner only), somebody is trying codes. Nothing is at immediate risk — a code is 50 bits, single-use, and expires in a week — but it is worth knowing when it happens. Outstanding codes are unaffected by another person's guessing; the endpoint refuses the guesser, not the invite.

**To fix a wrong username**: *Change username* on their row. The current user
ID, password, sessions, assignments and outstanding code remain. The old
username stops signing in and the corrected one starts.

**To reset a password**: issue a new code and hand over its link. This is the
path for every role, including Super Admin; one Super Admin helps another. An
associated email remains an alternate sign-in and does not currently grant
self-service recovery.

**To fix a Super Admin account email**: another Super Admin chooses *Change
email*. One's own value is read-only in Team; use another Super Admin or
the operator fallback rather than weakening the self-management boundary.

**To remove access**: deactivate the account. Do not delete it — history references it, and reactivating is one tap if the person comes back.

## Backups

Supabase takes automated daily backups on paid plans; the free tier does not, which is worth knowing before production data matters.

Beyond the provider default:

- **A weekly logical dump stored outside Supabase.** A backup that lives only with the provider does not protect against an account-level problem.
- **Restore must be tested, not assumed.** An untested backup is a hypothesis. Restore into a scratch project and confirm the data is actually usable.
- Dumps contain PII. They are encrypted at rest, never committed, and never placed in shared storage.

### Production historical repairs

A narrowly scoped, owner-authorised repair of already recorded trading is an
operator procedure, not an ordinary migration or an admin-screen action. Before
the maintenance window, take a full logical snapshot outside the repository,
restore it into an isolated scratch project, and prove that the relevant graph
and tablet session are usable there. Immediately before the live transaction,
take a second targeted before-image of every affected row, the device and shift
state, counters, and the catalog definitions the operation depends on. Checksum
the bundle and generate its compensating reversal before applying anything.

The operator's plan must pin the reviewed outlet pair, business date, row
counts, totals, number high-water marks and menu mapping. A fresh read that
drifts from that fingerprint is a stop, not a new set of inputs. Apply only in a
single locked transaction with an explicit confirmation; a failed assertion
must leave production unchanged. Run an independent postflight from a fresh
connection before either counter reopens. If it disagrees, use the rehearsed
database-only reversal while no later dependent work has arrived; never improvise
a partial SQL correction or wait for an outlet tablet.

If the repair moves cash bills or cash expenses across outlets, canonical bill,
effective-payment and expense totals are only the first check. Find every
stored drawer observation whose `(previous counted_at, counted_at]` interval
contains a moved row. Preserve the physical count and any collection; recompute
only its copied expected/difference pair from the corrected interval. Never add
a cash movement to make the screen look right — the notes already existed and
that would double-count them. If a tablet was renamed or transferred, split its
effective-dated identity at the reviewed cutover so pre-cutover bills keep the
old name and future work receives the new one.

The maintenance laptop, database services and the external backup destination
are sufficient for the closed-hours cutover. Outlet tablets, printers and
networks may remain powered off. Keep the targeted before-image and reversal
outside Git until the next-opening and next-day checks agree, then destroy them
under the retention decision; keep the full snapshot under normal backup
retention. Retain only non-sensitive checksums and aggregate results in the
change record.

## Monitoring

Deliberately minimal at this scale — the useful signals are operational rather than infrastructural:

- **Sync backlog**: a tablet with a persistent unsynced queue is the most valuable alert in the system. It means bills exist in exactly one place.
- **Device last-seen**: a counter device silent during trading hours means something is wrong at that outlet.
- **Cash differences**: a consistently non-zero difference at one outlet is a business signal, and the app already computes it.
- **Identity functions**: monitor `admin-accounts`, `redeem-invite`, and
  `email-sign-in` non-2xx rates plus email-sign-in abuse limits. Logs may name
  an action/result but never a raw account email, password, Auth alias, token
  hash or invite code.
- **Egress**: the free plan allows 5 GB a month, and a read that over-fetches
  spends it long before the business grows into it. See below for how to find
  out which endpoint is spending it.
- Supabase's built-in error and usage dashboards cover the rest.

### Attributing an egress spike

Reported 2026-09-21: 2.75 GB in one cycle against a 51 MB database and seven
monthly active users. The route from *"the number is wrong"* to *"this line of
code"* is two steps, and worth keeping because the answer was four levels down.

**1. Which service.** Dashboard → **Usage** → hover a bar on *Egress per day*.
The tooltip splits it by PostgREST, Realtime, Auth, Functions and Storage. Only
one of those is ever the answer; on the day above PostgREST was 99.2%, which
ruled out realtime and the aggregator sync before any code was read.

**2. Which endpoint.** Dashboard → **Logs** → *Explorer*. `response.headers.
content_length` is absent on chunked responses — exactly the large ones — so
rank by rows returned via `content_range` instead of by bytes:

```sql
select
  log_attributes['request.path'] as path,
  count(*) as requests,
  sum(toUInt64OrZero(substring(cr, position(cr,'-')+1, position(cr,'/')-position(cr,'-')-1)) + 1) as rows_sent
from (
  select log_attributes, coalesce(log_attributes['response.headers.content_range'],'') as cr
  from logs
  where source = 'edge_logs' and log_attributes['request.path'] like '/rest/v1/%'
)
group by path
order by rows_sent desc
limit 30
```

Group by `log_attributes['request.search']` to get the exact query shape once a
path stands out. Free-plan log retention is one day, so run it while the spike
is still recent.

Note the trap: a `\d` inside a SQL string literal reaches the engine as a bare
`d`, so a regex written the obvious way silently matches nothing and returns a
tidy, wrong answer. The `substring`/`position` form above avoids it.

No third-party analytics or session-recording tooling. The app handles customer PII and employee location; sending that to an analytics vendor is not a trade worth making.

**Two public lookup services are contacted only from the outlet form.**
`photon.komoot.io` (OpenStreetMap geocoding) and `api.postalpincode.in` (India
Post's PIN directory) answer postal-address search. Both are keyless. They see
only what an admin types while finding their shop; no customer, employee,
billing or identity data reaches either. If either disappears the address
block remains manually typeable.

## Runbook stubs

**A receipt link has to be killed** → revoke that one link rather than switching
the endpoint off; it is immediate, permanent for that token, and kills no other
bill's link, and a fresh one can be issued for a customer who still needs a
receipt. Both commands are in [The customer's receipt link](#the-customers-receipt-link-54).
Switching the whole endpoint off is for something wrong at scale, and needs no
deploy. **A revoked link cannot be recalled from somebody who already opened it**
— nothing can, which is why the page names no customer (it shows four digits of
the number and a gold label at most, never a name).

**A receipt link says the bill is cancelled** → that is correct and deliberate.
The page is built at the moment it is asked for, so a bill voided after its link
was sent reads `Cancelled` rather than presenting a valid-looking receipt. The
same is true of a corrected tender split.

**A counter tablet is lost or stolen** → remove it immediately (Tablets → Remove). Removal is permanent and takes the live shift with it, so nothing further can be rung on it. Any unresolved local bills on it are lost; the confirmation names how many it last reported, but an **out of touch** report is old evidence rather than a current count. Record that uncertainty with the physical cash count and set a replacement up with a fresh code. **Nobody's account is compromised** — a tablet holds no password.

**A counter tablet needs a new name or outlet** → use **Tablets → Edit**. A
name-only edit is safe while a shift is open. An outlet move is for a Super
Admin and must wait until the tablet has no live shift or pending request and
has recently reported an empty local queue; check both outlets are active and
the destination name is unique. Confirm the source and destination shown in the
sheet. The same machine identity and session continue, and no setup code is
needed. Verify the tablet is grouped under the destination and reconnect it
before opening the next shift. Historical rows stay with their recorded outlet.
If the tablet is powered off or the report is stale, this normal path must
refuse; use a separately approved, fingerprinted operator repair only when a
closed-hours incident requires it.

**A completed trading day is attributed to the wrong outlet** → stop ordinary
billing edits and preserve the evidence. Take and restore-test a full snapshot,
then take a targeted before-image and checksum it. Produce a read-only plan
whose exact date, outlet pair, row graph, totals, counters and menu mapping are
reviewed by the owner. Apply once in the locked transaction, run independent
postflights, and keep the counter hardware out of the critical path. If any
postflight disagrees before a new dependent shift or command exists, use the
rehearsed database-only reversal; otherwise stop and escalate. Never void and
re-ring a day merely to change its outlet, and never lower a committed number
counter.

**Bills are not syncing** → check whether Tablets says **unresolved** or **out of touch**, then check the counter's network. Unresolved names the tablet's fresh retained-envelope count; out of touch means even a displayed zero is no longer current evidence. The queue is durable while the device is intact. Bring the counter app to the foreground and wait through a minute heartbeat; do not reinstall or clear site data, because that destroys the outbox.

**A paid order is still on the rail the morning after** → it should not be
*(#69)*. The day change marks every paid order nobody ticked Prepared as prepared
at the cutover ending its payment's business day, within ten minutes of that
cutover. If one survives, the job has stopped: check
`select status, start_time from cron.job_run_details where jobid = (select jobid
from cron.job where jobname = 'day-change-finishes-paid-orders') order by
start_time desc limit 5`. Nothing is wrong with the data while it is stopped —
the stamp is computed from stored dates, so when the job resumes it writes the
same rows it would have written on time. An **unpaid** order is never finished
this way: money is still to be collected, so it stays on the rail, and Finish Day
still refuses over it.

**`pg_cron` keeps a week of run history.** Every scheduled job writes a row per
run to `cron.job_run_details`; `cron-run-history-keeps-a-week` deletes rows older
than seven days each morning at 05:00 IST. A week is enough to answer "did it run
last night?". If the database grows unexpectedly, check that job is still
scheduled before anything else.

**How often did the counter forget the Prepared tick?** Every order the day
change finished says so. Counting started at #69's deploy:

```sql
select o.name, b.payment_business_date, count(*)
  from orders x
  join bills b on b.id = x.bill_id
  join outlets o on o.id = x.outlet_id
 where x.prepared_source = 'day_change'
 group by 1, 2 order by 2 desc;
```

A tick that was made but delivered late — a tablet offline overnight — replaces
the stamp with the counter's own time and is not counted. The laptop repair this
replaced, `backfill_prepared_history()`, was dropped in the same change: it did
the job by hand, outlet-wide, at `paid_at`. Order 35 at Kalyani (paid 17 Sep
22:05, cleared by it on the 19th) is why the day change exists.

**Finish Day closes a day a minute after a payment** → that is correct, and it
is deliberate *(#55)*. **Closing the day ends any open payment-edit window
early.** The sheet still names a still-editable payment as an advisory so the
biller can review it before going home, but it is not a blocker: a biller
closing the day is leaving, and if they wanted to undo a payment they would not
be closing the day. The guard that used to refuse the close for five minutes
after any settled payment was withdrawn with that decision, because the sheet
had been promising the opposite since it shipped and nothing in the app handled
the refusal. **After the day is closed, nothing can be unwound on that tablet**
— taking a payment back, cancelling after payment and correcting a tender all
run through the live-shift requirement, and finishing the day ends the shift, so
all three are refused by the database. Anything genuinely wrong after that point
is a manager void plus a manual re-ring, as it always was.

**The counter resumed offline and has reached expiry or cutover** → do not move
the clock or clear storage. Restore the backend; the tablet must re-resolve
itself before delivering. The next operator opens a new shift from their own
phone. Finish Day remains outstanding until the old tablet drains and confirms
online.

**Cash does not reconcile** → check for late-synced bills against a closed day (they surface as reconciliation exceptions), then cash expenses recorded under the wrong business date, then withdrawals not recorded.

**Someone cannot sign in** → read the username on their Team row and confirm
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

**Someone must lose access now** → deactivate the account (Team / Access). It takes effect on their very next request, without waiting for their session to expire, and their open app ends its session and says why. Reactivating restores it; their password still works.

**An employee cannot check in** → in order: are they on the Team list at this outlet, active, and not departed? A departed or deactivated person keeps their history but is not offered a check-in. Then: they are outside the geofence or GPS will not fix — which no longer blocks anything, so tell them to **record it anyway** and approve it yourself; or **enter the arrival for them** (Attendance → their row): past times only, on today's business day, recorded as entered by you and settled by the act of recording it. If check-in is refused outright with a message about the outlet being closed, somebody marked it closed on Outlets; reopening it is one tap and needs nothing else.

**A day shows as absent and shouldn't** → in order: is an arrival recorded at all? If it is, nobody has approved it — the day counts for nothing until somebody does, so approve it from the attendance day (one tap from inside the outlet on the day itself, a typed reason otherwise). If there is no arrival, the day is *derived* absent rather than written that way: either record the arrival for them, or **mark the day as leave** if they were genuinely off. Nothing in the app knows a roster, so a weekly off reads as absent until somebody marks it ([Limitations](LIMITATIONS.md)).

**Everyone is reading as late** → check the outlet's **Staff are expected by** time on Outlets. It defaults to 13:00 and is per outlet, so a shop that opens in the afternoon needs its own. Changing it applies from then on only: every day already recorded keeps the deadline it was recorded under, by design, so fixing the setting will not fix yesterday's labels. Lateness is a tag either way and deducts nothing on its own.

**Days are piling up unapproved** → the Attendance tab itself carries a count, so this is visible from wherever you are rather than only from the screen that needed reading. On the attendance surface the owner gets a chip per outlet with its own count — visible without opening each shop, and choosing one brings the view to it — while the day picker counts the day on screen and its two arrows carry a dot when **that same outlet** holds unapproved arrivals on earlier or later days. Follow the dots back until they go. Days can then be settled together, but only after being picked one at a time: each waiting row carries a box ahead of its Approve and Deny, pressing it puts that one person in the set and replaces the day picker with the set's own bar, there is deliberately nothing that adds more than one person at once, and a confirmation names everybody before anything is written — because a button that settles a whole morning unlooked-at is how an arrival nobody saw gets counted. One position reading covers the action however many rows it settles, and the next action reads again. Approving from away from the outlet is allowed and asks for one reason covering the rows that need it, which is stored on each day and readable by the person it is about — so a week of approvals given from home is a week of visible reasons rather than an invisible habit.


## Sales and menu analytics

Analytics is a live, read-only Items/Sales group for owners and managers. Its migration (`20261012000000_sales_and_menu_analytics.sql`) creates two read functions and nothing else, so it deploys through the existing gated workflow with no data step. The website requires no change. There is no menu collector, GA account, tracking secret or retention job in this change; public-menu measurement and experiment advice are deferred in the behavior backlog.

Egress per page view is small and bounded: a Sales read for four 30-day windows, or an Items read, is tens of kilobytes of JSON before compression, and an Items chart series is two arrays of at most 368 integers and two of at most 96. Changing the measure, the grouping (Hour included) or Chart/Table reuses what was read; changing dates, outlet, the period count or the charted subject reads again, and a subject already charted on the page is not read twice.
