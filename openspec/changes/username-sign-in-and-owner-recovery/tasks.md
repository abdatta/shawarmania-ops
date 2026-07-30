## 1. Dependency and identity constants

- [ ] 1.1 Confirm `multi-outlet-hiring` (#23) is archived and its multi-outlet provisioning, assignment, and invite contracts are present in the main `identity-and-access` spec before applying this change.
- [ ] 1.2 Add one shared canonical-username validator/normalizer and reserved Auth-alias encoder/parser for the browser and Edge Functions, with a mirrored database validation table covering every accepted and refused boundary case.
- [ ] 1.3 Add unit tests for 3–30 character limits, lowercase normalization, allowed period/underscore characters, leading/trailing/consecutive period refusal, `@`, spaces, hyphens and Unicode refusal, and case-insensitive collisions.

## 2. Private recovery schema and database boundaries

- [ ] 2.1 Add `account_recovery_contacts` with normalized unique email, profile foreign key, timestamps, RLS enabled, no client policies, and explicit grant revocation from `anon`, `authenticated`, and `public`.
- [ ] 2.2 Add deferred transaction checks and privileged assignment/provisioning RPC changes so every and only live Super Admin has one recovery contact, including role grant, final-role end, rollback, and the last-owner guard.
- [ ] 2.3 Change invite preview/redemption RPCs to parse the current canonical username from the reserved Auth alias, return username only to a live code holder, compare submitted username before consumption, and preserve uniform dead-code and existing rate-limit behavior.
- [ ] 2.4 Add the hashed-IP/address owner-recovery attempt ledger and a service-only resolver that returns an active live Super Admin target without exposing resolution to a client.
- [ ] 2.5 Add pgTAP coverage for recovery-table privileges, anon/Employee/Biller/Franchise Admin read refusal, Super Admin invariant enforcement against direct assignment writes, recovery uniqueness, username-match redemption, dead-code uniformity, and no leaked alias or recovery contact.
- [ ] 2.6 Regenerate Supabase TypeScript declarations after a fresh reset and prove the checked-in types match the database.

## 3. Privileged identity and mail functions

- [ ] 3.1 Replace `admin-accounts` email actions and payloads with `username`, `identifiers`, and `set-username`, retaining caller-token authority derivation, self-change refusal, all-outlet Franchise Admin scope, Auth-user cleanup, and named username conflicts.
- [ ] 3.2 Make provisioning require recovery email only for Super Admin, create the Auth alias plus random unknown password, and commit profile, recovery contact, every requested assignment, and one invite atomically before returning the handover.
- [ ] 3.3 Extend assignment grant/end actions to accept or remove Super Admin recovery contact in the same transaction while preserving conditional outstanding-invite replacement from #23.
- [ ] 3.4 Update `redeem-invite` preview and redeem actions to return username, accept username plus password, distinguish non-consuming username mismatch from uniform invalid code, and update the existing Auth user without returning a session.
- [ ] 3.5 Add the enumeration-safe `owner-recovery` function with input/IP normalization, private resolver, canonical production redirect, uniform accepted response, and no raw address in application logs.
- [ ] 3.6 Add a Standard Webhooks-verified Supabase Send Email Hook backed by Resend that sends only recovery actions to freshly authorized Super Admin recovery contact and fails closed for signup, invite, magic-link, email-change, and every other Auth mail action.
- [ ] 3.7 Configure local Auth hook behavior and add function tests for invalid signatures, provider failure, email-change denial, active-owner delivery, inactive/former-owner refusal, redirect allow-list, enumeration uniformity, and rate limiting.

## 4. Reviewed in-place account migration

- [ ] 4.1 Build an operator-only dry-run command that lists current Auth users and assignments, proposes canonical handles, flags placeholders/collisions/missing owners, writes an access-restricted untracked mapping, and refuses to apply without complete owner approval.
- [ ] 4.2 Add an explicit transitional sign-in mode that accepts current email or canonical username only during the supervised cutover, while all newly provisioned accounts already require username and ordinary staff email is no longer collected.
- [ ] 4.3 Implement the idempotent `--apply` migration through the Auth Admin API and private recovery RPC, checkpointed by user ID, preserving password hashes, refresh sessions, profiles, assignments, attendance, invites, active state, and Auth identities.
- [ ] 4.4 Add preflight, postflight, and rollback reports proving canonical unique aliases, every-and-only owner recovery contact, live pending-invite preview, ordinary-email removal, and safe reversal through the reviewed mapping before the rollback window closes.
- [ ] 4.5 Rehearse dry-run, interrupted resume, full cutover, existing-password sign-in, existing-session survival, pending-invite redemption, and rollback against a production-shaped local backup without committing or logging the sensitive mapping.
- [ ] 4.6 Remove transitional email sign-in and runtime migration compatibility after the invariant report passes; document secure destruction of the temporary mapping and make post-cutover repair forward-only.

## 5. Typed adapters and demo data

- [ ] 5.1 Replace account `email` fields/actions with `username` and narrowly authorized `recoveryEmail` across `AccountSummary`, `NewAccount`, errors, the Accounts adapter, and generated-schema-derived types.
- [ ] 5.2 Update the Supabase adapter to fetch privileged identifiers, provision without ordinary email, change another person's username, handle recovery-contact fields only for owner operations, and never surface the reserved Auth alias.
- [ ] 5.3 Update the mock adapter to enforce the same canonical namespace, username-change and invite-preview behavior, Super Admin-only recovery contact, and admin-reset flow without making any real-data or mail call.
- [ ] 5.4 Replace demo account email/placeholder fixtures with invented canonical usernames, retain internally consistent roles/outlets/invites, and add type-level fixture checks proving no ordinary account carries recovery email.

## 6. Sign-in, activation, recovery, and People UI

- [ ] 6.1 Replace ordinary email sign-in with a username form and uniform username/password error, using stable names, `autocomplete="username"` and `autocomplete="current-password"`, and rejecting `@` with actionable copy.
- [ ] 6.2 Rebuild activation/reset as one real form that previews “Your username is …”, requires typed username plus two matching new passwords, applies `username`/`new-password` autocomplete tokens, preserves the code on local or server username mismatch, signs in, and navigates away on success.
- [ ] 6.3 Add Super Admin-only recovery help: a public enumeration-safe email request and callback form that rechecks live owner state, shows the current username, updates matching new passwords, and continues the recovery session into the app.
- [ ] 6.4 Change People creation to require name, username, role and role-appropriate outlets; keep phone, title and joined date optional; show recovery email only for Super Admin; and remove every ordinary email/placeholder/“Needs an address” field and state.
- [ ] 6.5 Add authorized username correction and owner recovery-contact management to People while refusing self-username change and preserving any outstanding activation link.
- [ ] 6.6 Update sign-in help, account menu, activation handover, statuses, accessibility labels, loading/errors, and mobile keyboard hints so terminology consistently distinguishes username from private Super Admin recovery email.
- [ ] 6.7 Expand component tests for all field requirements, one/multi-outlet provisioning, collision/mismatch/refusal copy, password-manager metadata, navigation, staff admin-reset guidance, owner recovery, private contact visibility, and demo no-write behavior.

## 7. Real-backend and browser flows

- [ ] 7.1 Extend REST account-flow coverage through all four roles for username provisioning/sign-in, case collision, cross-outlet refusal with no residual account, username correction, invite preservation, staff reset, and Super Admin recovery-contact invariants.
- [ ] 7.2 Add hand-crafted security probes proving a staff session cannot read recovery contact, change its Auth alias, invoke owner recovery as a resolved account oracle, grant owner without contact, or obtain another outlet's identifiers.
- [ ] 7.3 Rewrite authenticated Playwright setup and four-role flows to use usernames, activate through the three-field form, preserve existing sessions through a username change, reset staff through an admin, and recover an owner through the test mail sink.
- [ ] 7.4 Update normal Playwright/demo walkthroughs so People creates username-only staff, no screen asks ordinary roles for email, every activation handover remains demo-safe, and all four role shells still walk.
- [ ] 7.5 Manually inspect Chrome with password saving enabled in a normal profile, record whether activation and sign-in offer save/fill behavior, and treat DOM semantics plus successful navigation—not browser-owned prompt UI—as the acceptance evidence.

## 8. Durable documentation and forward-looking cleanup

- [ ] 8.1 Update `AGENTS.md` and `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md` to the completed username and owner-recovery model.
- [ ] 8.2 Update deployment/runbook material for `ops.shawarmania.in` recovery redirects, Resend sender DNS, hook secrets/configuration, monitoring, owner lockout fallback, migration rehearsal, rollback window, and private-data handling.
- [ ] 8.3 Reconcile roadmap, todos, non-archived seeded/active proposals, fixtures, tests, code comments, and user-facing copy so no future or live behavior assumes ordinary staff email; leave every `openspec/changes/archive/**` file byte-for-byte untouched.
- [ ] 8.4 Run a scoped repository sweep that classifies every remaining non-archive `email` mention as required Super Admin recovery, provider plumbing, migration/history wording, or an error to remove; record the classification in verification evidence.

## 9. Verification and phase gate

- [ ] 9.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`; fix and rerun until green.
- [ ] 9.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth`; prove generated types are drift-free and rerun every affected Docker gate after fixes.
- [ ] 9.3 Inspect sign-in, activation, owner recovery, People create/edit, pending/deactivated/unassigned states, and demo mode on phone and tablet viewports in light and dark themes, including console/network state and email/alias leakage.
- [ ] 9.4 Validate the OpenSpec change, run `npm run roadmap:sync`, and confirm the previous #23 dependency plus every documentation and non-archive cleanup task is complete.
- [ ] 9.5 PHASE GATE — Wave D `username-sign-in-and-owner-recovery` (#24): an admin creates a person without an email; the person opens one activation link, types the username shown there and matching new passwords, Chrome-compatible semantics can save that username/password pair, and the person signs in with it; only a Super Admin carries recovery email and can recover without another admin; every existing account, assignment, password, session, invite, attendance row, and tenancy boundary survives the move.
