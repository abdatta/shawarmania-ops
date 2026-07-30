## 1. Dependency and identity constants

- [x] 1.1 Confirm `multi-outlet-hiring` (#23) is archived and its multi-outlet provisioning, assignment, and invite contracts are present in the main `identity-and-access` spec before applying this change.
- [x] 1.2 Add one shared canonical-username validator/normalizer and reserved Auth-alias encoder/parser for the browser and Edge Functions, with a mirrored database validation table covering every accepted and refused boundary case.
- [x] 1.3 Add unit tests for 3–30 character limits, lowercase normalization, allowed period/underscore characters, leading/trailing/consecutive period refusal, `@`, spaces, hyphens and Unicode refusal, and case-insensitive collisions.

## 2. Private account-email schema and database boundaries

- [x] 2.1 Add `account_emails` with normalized unique email, profile foreign key, timestamps, RLS enabled, no client policies, and explicit grant revocation from `anon`, `authenticated`, and `public`.
- [x] 2.2 Add deferred transaction checks and privileged assignment/provisioning RPC changes so every live Super Admin has one account email while another role may have zero or one, including role grant, final-role end, rollback, and the last-owner guard.
- [x] 2.3 Change invite preview/redemption RPCs to parse the current canonical username from the reserved Auth alias, return username only to a live code holder, compare submitted username before consumption, and preserve uniform dead-code and existing rate-limit behavior.
- [x] 2.4 Add a hashed-IP/email attempt ledger and service-only resolver for email sign-in, with no client-visible resolution.
- [x] 2.5 Add pgTAP coverage for account-email privileges, anon/Employee/Biller/Franchise Admin read refusal, the one-way Super Admin invariant against direct assignment writes, email uniqueness, email-sign-in resolution, username-match redemption, dead-code uniformity, and no leaked alias or account email.
- [x] 2.6 Regenerate Supabase TypeScript declarations after a fresh reset and prove the checked-in types match the database.

## 3. Privileged identity functions

- [x] 3.1 Replace `admin-accounts` email actions and payloads with `username`, `identifiers`, and `set-username`, retaining caller-token authority derivation, self-change refusal, all-outlet Franchise Admin scope, Auth-user cleanup, and named username conflicts.
- [x] 3.2 Make provisioning require account email only for Super Admin, create the Auth alias plus random unknown password, and commit profile, account email, every requested assignment, and one invite atomically before returning the handover.
- [x] 3.3 Extend assignment grant/end actions to accept or preserve Super Admin account email in the same transaction while retaining conditional outstanding-invite replacement from #23.
- [x] 3.4 Update `redeem-invite` preview and redeem actions to return username, accept username plus password, distinguish non-consuming username mismatch from uniform invalid code, and update the existing Auth user without returning a session.
- [x] 3.5 Record automated Super Admin email recovery as a late roadmap todo instead of shipping a provider, Send Email Hook, public recovery route, or outbound authentication mail in this change.
- [x] 3.6 Keep Supabase Secure Email Change and double confirmation enabled so a signed-in user cannot silently replace the reserved Auth alias.
- [x] 3.7 Add a real-backend security probe proving a client-requested Auth email change does not replace the current alias or create another usable sign-in.
- [x] 3.8 Add the public `email-sign-in` function: private active-account resolution, hashed abuse limits, a request-local anon-key password grant, access/refresh-token-only success, uniform failure, and no raw credential, identifier, alias, or token logging.

## 4. Reviewed in-place account migration

- [x] 4.1 Build an operator-only dry-run command that lists current Auth users and assignments, proposes canonical handles, flags placeholders/collisions/missing owners, writes an access-restricted untracked mapping, and refuses to apply without complete owner approval.
- [x] 4.2 Make email-or-username sign-in permanent: username authenticates directly with the reserved alias; an associated email authenticates through the narrow bridge; newly provisioned ordinary accounts require no email.
- [x] 4.3 Implement the idempotent `--apply` migration through the Auth Admin API and privileged account-email SQL, checkpointed by user ID, preserving password hashes, refresh sessions, profiles, assignments, attendance, invites, active state, and Auth identities.
- [x] 4.4 Add preflight, postflight, and rollback reports proving canonical unique aliases, required Super Admin account email, explicit approval for every retained account email, live pending-invite preview, placeholder-email removal, and safe reversal through the reviewed mapping before the rollback window closes.
- [x] 4.5 Rehearse dry-run, interrupted resume, full migration, both permanent sign-in identifiers, existing-password sign-in, existing-session survival, pending-invite redemption, and rollback against a production-shaped local backup without committing or logging the sensitive mapping.
- [x] 4.6 Keep the approved production usernames exclusively in the gitignored operator mapping, prove neither is introduced by the change diff, document secure destruction of the mapping, and make post-migration repair forward-only.
- [x] 4.7 Add a fail-closed Pages pre-publication check backed by a non-sensitive Edge readiness action and service-only database invariant for canonical Auth/profile/identity alignment and active owner email.

## 5. Typed adapters and demo data

- [x] 5.1 Replace account `email` fields/actions with `username` and narrowly authorized `accountEmail` across `AccountSummary`, `NewAccount`, errors, the Accounts adapter, and generated-schema-derived types.
- [x] 5.2 Update the Supabase adapter to fetch privileged identifiers, provision without ordinary email, change another person's username, handle account-email fields only for current Super Admin operations, and never surface the reserved Auth alias.
- [x] 5.3 Update the mock adapter to enforce the same canonical namespace, username-change and invite-preview behavior, required Super Admin account email, and admin-reset flow without making any real-data or mail call.
- [x] 5.4 Replace demo account email/placeholder fixtures with invented canonical usernames, retain internally consistent roles/outlets/invites, and add type-level fixture checks proving only the Super Admin fixture currently carries account email.

## 6. Sign-in, activation, reset, and People UI

- [x] 6.1 Replace required email sign-in with a username-or-email form and uniform identifier/password error, using stable names, `autocomplete="username"` and `autocomplete="current-password"`, and never accepting `@username`.
- [x] 6.2 Rebuild activation/reset as one real form that previews “Your username is …”, requires typed username plus two matching new passwords, applies `username`/`new-password` autocomplete tokens, preserves the code on local or server username mismatch, signs in, and navigates away on success.
- [x] 6.3 Keep forgot-password help on the admin-issued one-time-link path for every role, including Super Admins; expose no public recovery route.
- [x] 6.4 Change People creation to require name, username, role and role-appropriate outlets; keep phone, title and joined date optional; show Email only for Super Admin; and remove every ordinary email/placeholder/“Needs an address” field and state.
- [x] 6.5 Add authorized username correction and Super Admin account-email management to People while refusing self-username change and preserving any outstanding activation link.
- [x] 6.6 Update sign-in help, account menu, activation handover, statuses, accessibility labels, loading/errors, and mobile keyboard hints so terminology consistently distinguishes username, optional private account email, and admin-issued reset.
- [x] 6.7 Expand component tests for all field requirements, one/multi-outlet provisioning, collision/mismatch/refusal copy, password-manager metadata, permanent dual sign-in, navigation, all-role admin-reset guidance, private account-email visibility, and demo no-write behavior.

## 7. Real-backend and browser flows

- [x] 7.1 Extend REST account-flow coverage through all four roles for username provisioning/sign-in, associated-email sign-in, uniform email refusal, case collision, cross-outlet refusal with no residual account, username correction, invite preservation, staff reset, and Super Admin account-email invariants.
- [x] 7.2 Add hand-crafted security probes proving a staff session cannot read an account email, change its Auth alias, resolve an email to an account, grant Super Admin without email, or obtain another outlet's identifiers.
- [x] 7.3 Rewrite authenticated Playwright setup and four-role flows to use usernames, activate through the three-field form, preserve existing sessions through a username change, and reset accounts through an admin.
- [x] 7.4 Update normal Playwright/demo walkthroughs so People creates username-only staff, no screen asks ordinary roles for email, every activation handover remains demo-safe, and all four role shells still walk.
- [x] 7.5 Manually inspect Chrome with password saving enabled in a normal profile, record whether activation and sign-in offer save/fill behavior, and treat DOM semantics plus successful navigation—not browser-owned prompt UI—as the acceptance evidence.

## 8. Durable documentation and forward-looking cleanup

- [x] 8.1 Update `AGENTS.md` and `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md` to the completed username and admin-reset model.
- [x] 8.2 Update deployment/runbook material for Auth email-change protection, owner lockout fallback, migration rehearsal, rollback window, and private-data handling without an email-delivery dependency.
- [x] 8.3 Reconcile roadmap, todos, non-archived seeded/active proposals, fixtures, tests, code comments, and user-facing copy so no future or live behavior assumes ordinary staff email; leave every `openspec/changes/archive/**` file byte-for-byte untouched.
- [x] 8.4 Run a scoped repository sweep that classifies every remaining non-archive `email` mention as optional private account email, required Super Admin email/future-security prerequisite, email-sign-in plumbing, migration/history wording, deferred recovery scope, or an error to remove; record the classification in verification evidence.

## 9. Verification and phase gate

- [x] 9.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`; fix and rerun until green.
- [x] 9.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth`; prove generated types are drift-free and rerun every affected Docker gate after fixes.
- [x] 9.3 Inspect sign-in, activation/reset, People create/edit, pending/deactivated/unassigned states, and demo mode on phone and tablet viewports in light and dark themes, including console/network state and email/alias leakage.
- [x] 9.4 Validate the OpenSpec change, run `npm run roadmap:sync`, and confirm the previous #23 dependency plus every documentation and non-archive cleanup task is complete.
- [x] 9.5 Prove the deployment guard succeeds only for a canonical local identity state and fails for missing/malformed endpoint responses, legacy Auth identifiers, identity/profile drift, missing owner email, and missing build variables.
- [x] 9.6 PHASE GATE — Wave D `username-sign-in-and-owner-recovery` (#24): an admin creates an ordinary person without email; the person opens one activation link, types the username shown there and matching new passwords, Chrome-compatible semantics can save that username/password pair, and the person signs in with it; any account with an associated email can also sign in with that email; every Super Admin has one; every role can receive an admin-issued reset; every existing account, assignment, password, session, invite, attendance row, and tenancy boundary survives the move.
