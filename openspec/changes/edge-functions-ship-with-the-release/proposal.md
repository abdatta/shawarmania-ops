# Proposal: Edge Functions Ship With The Release

> **Model**: Opus · **Kind**: delivery tooling and a production bug fix, not a roadmap change · **Gate**: **a push to `main` deploys every Edge Function after the migration and before the bundle that calls them is published**, with no function named in any list; a function carrying no gateway configuration fails the suite; and on the tablet path a server-side fault reads as a fault to report, never as a bad connection and never as a dead setup code, while a genuine transport failure still reads as a connection problem and every code-related refusal stays indistinguishable.

## Why

**`counter-devices` and `counter-setup` have never existed in production.** Both
were added by `counter-devices-and-offline` (#9) on 2026-08-09 and neither has
ever been deployed. Probed against the live project on 2026-08-11:

```
counter-devices   404  {"code":"NOT_FOUND","message":"Requested function was not found"}
counter-setup     404  {"code":"NOT_FOUND","message":"Requested function was not found"}
admin-accounts    401  Missing authorization header          (deployed)
redeem-invite     400  {"error":"weak_password"}             (deployed)
email-sign-in     401  {"error":"invalid_credentials"}       (deployed)
```

The whole tablet handshake is unreachable: a counter cannot be set up, and
therefore no shift can be opened on one. This is the failure
`outlet-and-staff-setup` was written about, happening a second time. That
proposal opens "Attendance (#5) shipped a feature that cannot be reached", and
#9 shipped the same way for a different reason.

**The reason is structural.** `deploy.yml` applies migrations and publishes the
bundle. It has never deployed an Edge Function. Functions are deployed by hand
from a runbook that enumerates them, and that list still names the three
identity functions it named when it was written. Nothing anywhere reconciles the
list with the directory, so #9 could not have been caught.

The comment above the `migrate` job says a bundle "cannot reach staff phones
while production is still missing a function, table or column it calls". That is
true of database functions and false of Edge Functions, and this is the proof.

**Then the app blamed the wrong thing, twice.** An owner tried to register a
tablet from their own phone on 2026-08-11 and was told:

> Could not reach Shawarmania. Try again in a moment.

The phone reached Shawarmania perfectly. `failureCode` looks for `body.error`,
the gateway's 404 body carries `code` and `message` instead, and
`(await failureCode(error)) ?? 'unavailable'` turns every unrecognised failure
into the connection message. Had a code been issued, the tablet would have said
`That setup code did not work. It may have expired or already been used.`,
because `setUpCounterDevice` funnels every non-transport failure into
`invalid_code`. Somebody would have burned codes on a deployment that never
happened.

This is the defect `attendance-position-free-commands` fixed one adapter ago:
"a command the backend cannot accept at all stops masquerading as a transient
failure". It fixed attendance. The counter path was never looked at, and it has
the same lie in three places.

## What Changes

- **The release deploys Edge Functions**, after the migration and before Pages
  publishes, so the schema, the privileged code and the bundle land in
  dependency order. A failed function deploy leaves the current build live, on
  the same terms as a failed migration.
- **No function is named anywhere.** The release deploys every function in
  `supabase/functions/`, so adding one cannot leave it behind.
- **The project a function is deployed to is derived from the URL the bundle is
  built against**, so functions cannot reach a different project than the
  published app talks to.
- **A function with no gateway configuration fails the suite.** A missing
  `[functions.<name>]` block silently defaults to `verify_jwt = true`, which is
  exactly what would break `counter-setup`, whose entire purpose is to answer a
  tablet that holds no token.
- **A server-side fault on the tablet path is reported as one.** A missing
  endpoint, a 500, or a body carrying no recognised reason now says the action
  could not be sent and asks for it to be reported. It never blames the
  connection and never blames the code.
- **A genuine transport failure still reads as a connection problem**, and every
  code-related refusal stays indistinguishable, so neither enumeration safety
  nor the existing connection guidance is weakened.
- **The runbook stops enumerating.** `docs/OPERATIONS.md` deploys all functions
  in one command and states that the release does this from now on.

## Impact

- **Specs**: `pwa-and-deployment` (the release includes Edge Functions),
  `counter-device-sessions` (a server-side fault is never reported as a bad code
  or a bad connection).
- **Code**: `.github/workflows/deploy.yml`, `src/data-access/auth.ts`,
  `src/data-access/supabase-adapters/counter.ts`, a new
  `scripts/check-edge-functions.mjs` wired into `lint`.
- **Docs**: `docs/OPERATIONS.md`, `docs/TESTING.md`, `AGENTS.md` verification
  list.
- **No migration, no policy, no money arithmetic, and no change to the demo
  seam.** The offline outbox is untouched.
- **No ROADMAP.md row, number or wave**: this is delivery tooling plus a
  correction to shipped behaviour.
- 🧍 **One credential the owner must add before the release can deploy
  functions**: a Supabase access token, as an environment secret. Named in
  `docs/OPERATIONS.md` and in the verification report.
