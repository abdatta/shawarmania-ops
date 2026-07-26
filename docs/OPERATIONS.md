# Operations

> Describes the intended setup. Nothing is provisioned or deployed yet; this lands with `project-foundations` and the operations work at the end of the roadmap.

## Environments

| Environment | Purpose | Data |
|---|---|---|
| **Local** | Development | Supabase local stack, synthetic seed data |
| **Staging** | Verification before release | Separate Supabase project, synthetic data only |
| **Production** | The live counters | Separate Supabase project, real business data |

**Production data is never copied into staging or local.** It contains customer and employee PII. When a production-shaped dataset is needed for debugging, generate a synthetic one at the same scale.

## Configuration

Client-side environment variables — only ever the public pair:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The anon key is designed to be public; Row-Level Security is what protects the data. **The service-role key is never in client configuration.** It lives only in Edge Function secrets.

`.env.example` documents every variable. `.env` is gitignored and must stay that way.

## Deployment

The frontend is a static SPA — build, upload, done.

```bash
npm run build
```

Deploys to Vercel or Cloudflare Pages on push to `main`. Immutable hashed assets, so a rollback is redeploying a previous build.

Database changes deploy as migrations, applied to staging first and then production. **Migrations are forward-only**; a mistake is corrected by a new migration, not by editing a released one.

### Service worker caution

The PWA caches the app shell, which means **a bad deploy can persist on a counter tablet that has not refreshed**. Two mitigations, both non-optional:

- The service worker checks for a new version on launch and applies it on the next load.
- A version identifier is visible somewhere in the UI, so "what build is that tablet on?" is answerable over the phone rather than by driving to the outlet.

## Onboarding a new franchise outlet

The repeatable path. **If any step here requires a code change, that is a bug** — outlet number seven must be a data operation.

1. **Create the outlet** (Super Admin → Outlets): name, address, contact, coordinates, geofence radius, business-day cutover.
2. **Set the coordinates accurately.** Attendance depends on them. Take them at the counter, not from a map search.
3. **Create the Franchise Admin** and hand over their one-time code.
4. **The Franchise Admin sets up the menu** — copy the standard menu, adjust prices if they differ.
5. **Enrol the counter tablet**: sign in on the device, enrol it to this outlet, confirm it appears under Devices.
6. **Add employees and billers**, issue PINs and app access.
7. **Set the opening cash float** for the first business day.
8. **Verify isolation before going live** — sign in as the new Franchise Admin and confirm no other outlet is visible anywhere. This is a real step, not a formality: it is the last point at which a misconfiguration is cheap to fix.

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

**Someone cannot sign in** → confirm the account is active and the phone number matches exactly. Regenerate a one-time code if the password is forgotten; there is no self-service reset.

**An employee cannot check in** → they are outside the geofence, or GPS will not fix. Use the counter tablet, or approve an override from the manager's phone.
