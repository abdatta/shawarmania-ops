# Operations

> The build and CI pipeline landed with `project-foundations`; hosting and the production Supabase project went live on 2026-07-27. `outlet-and-staff-setup` (#15) closed the setup gap: **creating an outlet and adding its people are both done in the app**, and no step of onboarding needs SQL — and `staff-as-accounts` (#21) then removed the roster and its link step entirely, so a person is created once, as an account. `activation-without-typing` (#16) then made the handover a link — **you send it, they tap it and choose a password**, and the address they will sign in with is on the screen for them to confirm. The menu, tablet enrolment and the opening cash float are still to come, and the steps below say which.

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

> ⚠ **Steps 4, 5 and 7 are not built yet** and are marked below. Everything else is done in the app — no SQL console, at any step. **Order matters**: an outlet has to exist before anybody can be assigned to it.

1. **Create the outlet** (Super Admin → Outlets → *Add outlet*): short code, name, location label, staff code prefix, address, phone, business-day cutover. The prefix arrives filled in from the short code — correct it now if you want something else, because it cannot change once anybody is on this outlet's staff list. Use **Find the address** to fill the address block from a search rather than typing five fields — it fills the District from the PIN code, which is the part nobody remembers. Check what it filled before saving; OpenStreetMap data is contributed rather than surveyed, and this address is what a GST invoice will carry. If it finds nothing, type it: the search is a shortcut and never a step. On a brand-new installation this is the only thing there is to do, and the empty screen says so.
2. **Capture the coordinates in the app, standing at the counter** (Super Admin → Outlets → *Capture position here*). Not from a map search, and not by typing them in — there is deliberately no field for that. The screen samples for a few seconds, keeps the tightest reading, and refuses to save a fix looser than ±50 m; step outside if the counter cannot produce one. Until an outlet is captured, its check-ins are recorded but not measured against any fence, and the Outlets screen shows it as unsurveyed.
3. **Create the Franchise Admin** (Super Admin → People) and send them their activation link. Needs the outlet to exist first — the form has no outlet to assign anyone to otherwise, and says so rather than showing an empty dropdown.
4. **The Franchise Admin sets up the menu** — copy the standard menu, adjust prices if they differ. *(Not built — demo only until #10.)*
5. **Enrol the counter tablet**: sign in on the device, enrol it to this outlet, confirm it appears under Devices. *(Not built — #9.)* Until then a Biller signs in with their own email on the tablet; shift PINs arrive with enrolment.
6. **Add employees and billers** (People), sending each their activation link. Creating a person is one step — name, email, role, role title, joining date — and the account *is* the staff record: the app issues the staff code, and the person appears on the attendance day the moment they exist. Someone whose address you do not have yet can be added anyway and shows **Needs an address** until you set a real one — they appear on attendance but cannot sign in until then, so it is worth reading down the list once before you finish.
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

8. **Verify, in this order.** Sign in as the Super Admin → People lists your
   own account → provision a Franchise Admin → open the activation link in a
   private window → that admin sees their outlet and nothing of any other.

## Managing accounts

Accounts are admin-provisioned; there is no self-service signup, and nothing is ever emailed or texted to anybody.

- **Super Admin → People** manages every account across all outlets.
- **Franchise Admin → People** manages Billers and Employees in that admin's own outlet, and nothing else. The limits are enforced server-side from the caller's own session, not by the form.

**To give someone access**: add the account (name, email, role, outlet). The handover is shown **once**, alongside the address that account will sign in with — read that address before you send anything, because it is the last cheap moment to catch a typo. Send the **activation link** (WhatsApp is what the business already uses): they tap it, confirm the address is theirs, choose a password — twice, so a blind typo cannot lock them out — and are in. The QR beside it is for handing a phone across a counter. Those are the only two ways offered; the link carries no address. There is nowhere to look it up afterwards, so if the message is lost, issue a new one; doing so cancels the old one automatically.

**If somebody says the address on the link is not theirs**, they are being told to come to you, which is the point: fix it with *Change email* and send the link again. The link keeps working after the correction, but sending it again is what tells them it is safe to continue.

**If the People screen says failed activations are unusually high** (owner only), somebody is trying codes. Nothing is at immediate risk — a code is 50 bits, single-use, and expires in a week — but it is worth knowing when it happens. Outstanding codes are unaffected by another person's guessing; the endpoint refuses the guesser, not the invite.

**To fix a wrong email address**: *Change email* on their row. The one-time code you already handed over keeps working, so there is no need to issue another. Addresses are visible only to the admins who manage that account — never on the counter tablet.

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

**Two external services are contacted, both only from the outlet form.** `photon.komoot.io` (OpenStreetMap geocoding) and `api.postalpincode.in` (India Post's PIN directory) answer the address search. Both are keyless and free, so there is nothing to provision, restrict or renew — and nothing to notice when it expires. They see only what an admin types while looking up their own shop's address; no customer, employee or billing data reaches either, and neither is contacted anywhere else in the app. If either disappears the address block simply goes back to being typed.

## Runbook stubs

**A counter tablet is lost or stolen** → revoke the device immediately (Franchise Admin → Devices). Any unsynced bills on it are lost; note the gap on that day's cash record. Enrol a replacement.

**Bills are not syncing** → check the device's pending count and network. The queue is durable; bills are not lost while the device is intact. Do not reinstall or clear site data — that destroys the outbox.

**Cash does not reconcile** → check for late-synced bills against a closed day (they surface as reconciliation exceptions), then cash expenses recorded under the wrong business date, then withdrawals not recorded.

**Someone cannot sign in** → **read the address on their row first** (People — the owner sees every outlet, a Franchise Admin their own). If the row says **Needs an address**, the account was created on a placeholder and cannot sign in at all until a real address is set. Sign-in gives one message for a wrong address and a wrong password alike, so a mistyped address looks exactly like a forgotten password. Activation no longer hides this — the link shows the address and invites them to say it is wrong — but sign-in still needs it typed. Fix it with *Change email*; the link you already sent still works afterwards. Then confirm the account is active. Issue a new code if the password is forgotten; there is no self-service reset.

**An activation link will not work** → it expires after seven days, works once, and is cancelled the moment a newer one is issued or the person is moved to another role or outlet. All of those look identical to whoever opened it, deliberately — a link that said *which* would be a way to ask whether an account exists. The person sees this on arrival, before typing anything. The fix is always the same: issue a new one. Nobody can look the old one up; only a hash was ever stored.

**"Too many activation attempts from this connection"** → the endpoint's own rate limit, not a problem with the code. It clears within fifteen minutes. A working activation never counts toward it — only failures do — so seeing this means something on that connection has been failing repeatedly.

**An outlet was created by mistake** → Outlets → **Mark closed**, then **Delete**. Deletion is offered only on a closed outlet, so the reversible step comes first, and it cannot be undone. It will work only while nothing at all references the outlet; if anything does, the screen names what — staff, accounts, tablets, recorded days — and nothing is removed. Move or remove those and it becomes deletable on its own, with nothing to re-mark afterwards. **An outlet that ever traded cannot be deleted, by anyone, ever** — that is the point, not a limitation: its bills and attendance are the business's history. Mark it closed instead. And note that an outlet which has ever had a Franchise Admin cannot be emptied simply by deactivating them; see [Limitations](LIMITATIONS.md).

**Someone must lose access now** → deactivate the account (People / Access). It takes effect on their very next request, without waiting for their session to expire, and their open app ends its session and says why. Reactivating restores it; their password still works.

**An employee cannot check in** → in order: are they on People at this outlet, active, and not departed? A departed or deactivated person keeps their history but is not offered a check-in. Then: they are outside the geofence or GPS will not fix — approve an override from the manager's phone, or **enter the check-in for them** (Attendance → their row): past times only, on today's business day, recorded as entered by you. If check-in is refused outright with a message about the outlet being closed, somebody marked it closed on Outlets; reopening it is one tap and needs nothing else.
