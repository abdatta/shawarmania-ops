# Verification evidence

Evidence is being collected on 2026-07-30 against the local Supabase stack and
production-shaped fixtures. Production discovery has been read-only; no
production database or Auth state has been changed.

## Product contract

- Every human account has one canonical username and password.
- An associated account email is optional by default and required for every
  live Super Admin. It is private account data, a permanent alternate sign-in
  identifier, and a foundation for future recovery or security features.
- People does not ask for email when an ordinary Employee, Biller, or Franchise
  Admin is created. The schema and sign-in boundary nevertheless support an
  associated email for another role if an authorized flow is added later.
- Forgotten-password recovery remains an admin-issued one-time link for every
  role, including Super Admin. This change exposes no public recovery request
  and sends no authentication mail.
- The permanent sign-in form accepts username or associated email. There is no
  temporary cutover mode and no later username-only phase.
- Static publication fails closed before build/upload until the hosted
  `email-sign-in` readiness action confirms the schema, canonical Auth/profile
  state, and live-owner email.

## Automated gates

| Gate | Evidence |
|---|---|
| `npm run lint` | Passed; one pre-existing attendance fast-refresh warning only |
| `npm run format:check` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 57 files, 590 tests passed |
| `npm run contrast` | 50 light/dark token pairs passed |
| `npm run build` | Passed |
| `npm run test:e2e` | 160 browser tests passed |
| `npm run db:reset` | Fresh local reset passed |
| `npm run test:db` | 597 pgTAP assertions passed |
| `npm run test:rls` | 117 RLS/real-HTTP assertions passed |
| `npm run test:e2e:auth` | 14 real-backend browser tests passed |
| `npm run db:types` | Generated declarations refreshed from the reset database |
| `npm run auth:readiness` | Passed against the real local Edge Function/database boundary; an invalid public key failed closed with the generic result |
| `npm run auth:usernames:rehearse` | Interruption/resume, username and email sign-in to one account, password and refresh-session survival, pending invite, postflight, rollback, forward repair, publication close/reopen, and private-artifact destruction passed |
| `npx openspec validate username-sign-in-and-owner-recovery --strict` | Change is valid |
| `npm run roadmap:sync` | Roadmap already in sync; 0 rows updated |

Email-sign-in tests prove that an associated email and username reach the same
account and that unknown-email and wrong-password failures are
indistinguishable. Database tests prove normalized private lookup and hashed
abuse limits. A real-backend probe hand-crafts an Auth email-change request and
proves Secure Email Change plus double confirmation leave the reserved alias
unchanged and the attempted alias unusable.

The publication guard has independent test layers. Tooling tests refuse missing
build variables, a missing endpoint, negative or malformed responses,
timeouts/network errors, and response-detail leakage. pgTAP proves the database
function is service-role-only and flips false for a legacy Auth address,
mismatched email identity, or missing live-owner email; the REST suite proves
the public Edge action returns only `{ "ready": true }` for canonical local
state.

## Browser and password-manager contract

- Sign-in uses one `name="username"` field with `autocomplete="username"` and
  one `name="password"` field with `autocomplete="current-password"`. The label
  says “Username or email”; no reserved Auth alias is exposed.
- Activation displays “Your username is …” and asks the person to type that
  username plus a password and re-typed password. The fields use `username` and
  `new-password` autocomplete tokens.
- Forgot-password help points every role to a Franchise Admin or Super Admin
  for a new one-time link; no recovery-address field or route exists.
- People asks ordinary accounts for name, username, role and outlets, retaining
  the existing optional profile fields. Selecting Super Admin adds one required
  Email field.

Chrome owns the save-password prompt and does not expose it to page automation.
Acceptance therefore uses the standard form semantics plus successful
navigation. Chrome may offer to save a newly entered password when password
saving is enabled; the prompt is not guaranteed when saving is disabled,
managed by policy, or previously declined for the site.

The final in-app browser inspection covered 390×844 and 1024×768 viewports in
light and dark. Sign-in, activation/reset, and People had no horizontal
overflow or console warning/error. The ordinary People form had no Email field;
selecting Owner added exactly one private Email field and removed outlet/profile
fields that do not apply to a Super Admin.

## Scoped email sweep

Every retained non-archive `email` mention must fit one of these reviewed
classes:

1. **Optional private account email** — durable documentation, the active
   change, the privileged People response, typed adapters, private schema, and
   their tests. It is required only by the live Super Admin invariant.
2. **Associated-email sign-in** — the narrow public Edge Function, uniform
   failure copy, and abuse controls.
3. **Provider/Auth plumbing** — the non-deliverable reserved Auth alias,
   Supabase Secure Email Change/double-confirmation settings, environment names,
   and security tests. No reserved alias is rendered or returned as a person's
   email.
4. **Migration or historical baseline** — immutable database migrations,
   migration/rehearsal scripts, rollback wording, and the current main
   `identity-and-access` baseline that the delta replaces during sync/archive.

No live or future ordinary-account flow requires email. Archived changes are
excluded and remain byte-for-byte untouched.

## Production-data boundary

The approved production usernames exist only in
`supabase/.username-migration/mapping.json`, beneath a gitignored,
operator-private directory. A tracked-diff scan for both approved values
returns no match. The values are not copied into a proposal, task, test,
fixture, seed, command transcript, or verification artifact.

The production migration will read that ignored mapping and run through
`npx supabase`; it will not add a production-data file to the repository.
Postflight is forward repair only. After the rollback/repair decision is closed,
the operator destroys the local mapping and any private copies.

## Production rollout gate

Read-only discovery found two live Super Admin accounts, both still using their
legacy Auth emails, with no username aliases or #24 schema. The repository
change defines one supervised in-place data migration; that is rollout work,
not a temporary authentication phase. The final application permanently
supports both username and associated-email sign-in.

Before production rollout can complete, the operator must:

1. regenerate and seal the ignored mapping with both approved usernames and
   explicitly approved account emails;
2. confirm hosted Secure Email Change and double confirmation are enabled;
3. deploy the schema and three Edge Functions;
4. apply the ignored mapping, run postflight, and verify both sign-in
   identifiers reach each account;
5. require the public readiness action locally, then push; the Pages workflow
   repeats the check before it can build or upload the permanent frontend;
6. confirm one Super Admin can issue another a reset link before the final
   read-only production verification.

The final prerequisite check will be repeated immediately before rollout.

### Earlier access-repair deployment

Production commit `45394b2` briefly served a username-only checkpoint while the
two live Auth users still had legacy email identifiers. Commit `c2b283c`
restored access through a temporary static compatibility build without changing
production Auth or database state.

This change removes that build-time branch. Once the permanent dual-sign-in
implementation is deployed, the temporary GitHub variable is inert and will be
deleted.
