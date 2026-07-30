# Verification evidence

Evidence was collected on 2026-07-30 against the local Supabase stack,
production-shaped fixtures, and the guarded production rollout. Production
identity writes ended before the permanent frontend was published; every final
production verification below was read-only.

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
| Production username apply/postflight | Migrated 2 approved accounts in place; postflight found 2 live owners, 2 private account emails, 0 live pending invites, and 0 findings |
| Production `npm run auth:readiness` | Passed through the deployed public `email-sign-in` action after the SQL invariant independently returned true |
| GitHub Pages run `30544249328` | Readiness, build, artifact upload, and production deployment passed |
| GitHub CI run `30544249439` | All three jobs passed, including normal E2E, the full local database/RLS suite, auth E2E, and generated-type drift |
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

The approved production usernames existed only in the gitignored
`supabase/.username-migration/mapping.json` operator artifact until the
production migration completed. An added-line scan across every commit in this
change found no approved username, and Git confirmed the mapping was never
tracked. The values were not copied into a proposal, task, test, fixture, seed,
command transcript, or verification artifact.

After production postflight, readiness, guarded publication, live read-only UI
inspection, and green CI, the operator ran `--destroy-mapping`. The mapping,
checkpoint, postflight, and rollback artifacts no longer exist locally.
Production repair is now forward-only through the supported privileged paths.

## Production rollout gate

The supervised production rollout completed in place:

1. Hosted public signup, anonymous access, and manual linking remained disabled;
   email confirmation was enabled; Secure Email Change and double confirmation
   remained enabled; no Send Email Hook was registered.
2. Migration `20260730000003` and the three identity Edge Functions were
   deployed before the permanent frontend. Function-list inspection confirmed
   the new active versions; this caught and repaired a deployment-control-plane
   collision before publication.
3. The sealed private mapping migrated both existing Auth users without
   replacing their user IDs. Postflight found 2 users, 2 live Super Admins, 2
   required private emails, no live pending invites, and no findings.
4. The SQL invariant returned true and the hosted readiness action passed. The
   Pages workflow repeated that check before building or uploading.
5. Production served build `d0415e4`. Read-only browser inspection confirmed
   “Username or email”, `autocomplete="username"`,
   `autocomplete="current-password"`, admin-issued reset guidance, and a
   not-found response for `/recover`.
6. The obsolete `VITE_AUTH_CUTOVER_MODE` repository variable was deleted only
   after the permanent build was live. The ignored migration artifacts were
   then destroyed.

No production password, reset link, assignment, attendance row, or session was
read or changed for verification. Password/session preservation and the
admin-issued reset flow are covered by the local production-shaped rehearsal
and 14 real-backend auth browser tests; the live migration changed only the
existing Auth email aliases and private account-email rows.

### Earlier access-repair deployment

Production commit `45394b2` briefly served a username-only checkpoint while the
two live Auth users still had legacy email identifiers. Commit `c2b283c`
restored access through a temporary static compatibility build without changing
production Auth or database state.

This change removed that build-time branch, deployed permanent dual sign-in,
and deleted the temporary GitHub variable after the guarded production
deployment passed.
