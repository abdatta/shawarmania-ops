# Tasks: auth-and-roles

## 1. Database — invitations

- [x] 1.1 Migration creating `public.account_invites` (profile, outlet, code hash, issuer, issued/expires, attempts, consumed, superseded) with RLS enabled, indexes on `profile_id` and `outlet_id`, and the partial uniqueness that keeps at most one live invite per profile (design D3).
- [x] 1.2 Read policy: Super Admin all, Franchise Admin own outlet, everyone else nothing — gated on `app_account_active()` and `app_device_ok()` like every other policy. Revoke `insert`/`update`/`delete` from `authenticated` and `anon` entirely (design D3).
- [x] 1.3 Column-level `select` grants listing every column **except** `code_hash`, so the hash is unreadable over REST even by the Super Admin.
- [x] 1.4 Isolation coverage: classify `account_invites` in the pgTAP schema-coverage suite and add its case to the isolation matrix — the standing rule that a new outlet-scoped table ships its isolation test in the same change.
- [x] 1.5 REST probes for the new table: another outlet's invites invisible to a Franchise Admin, `code_hash` refused for every role, direct writes refused.
- [x] 1.6 Regenerate `src/data-access/database.types.ts` (`npm run db:types`) so the new table is typed and the committed types do not drift.
- [x] 1.7 Record in `supabase/config.toml` why no inactivity timeout is set on refresh tokens (design D10), so a future reader does not "tighten" it and lock field staff out weekly.

## 2. Edge Functions

- [x] 2.1 `supabase/functions/_shared/`: CORS/JSON helpers, the service-role client factory, caller-authority derivation (verify the caller's token, read their profile, return role + outlet), and the Crockford-base32 code generator + hasher (design D4, D5).
- [x] 2.2 `admin-accounts` — `provision`: validate the authority matrix, create the auth user with the email pre-confirmed, insert the profile, issue the invite, return the plaintext code exactly once.
- [x] 2.3 `admin-accounts` — `reissue`: supersede outstanding invites for the profile and issue a new code (this is the whole password-reset story).
- [x] 2.4 `admin-accounts` — `set-active`: flip `profiles.is_active`, refusing self-deactivation and any target outside the caller's authority.
- [x] 2.5 `redeem-invite`: unauthenticated; normalise the code, enforce the minimum password length before consuming anything, consume atomically (`where consumed_at is null and superseded_at is null and expires_at > now() and attempts < 5`), increment attempts on failure, set the password via the admin API, return 204 and **no session**. Every failure mode returns one identical response (design D5).
- [x] 2.6 Integration suite against the running stack (`supabase/tests/rest/`): the full provisioning → code → activation → sign-in walk, plus every negative cell of the authority matrix, expiry, replay, attempt exhaustion, supersession, self-deactivation, and failure-response uniformity.

## 3. The real session in the client

- [x] 3.1 `AccountsAdapter` interface in `src/data-access/adapters.ts` (list accounts, provision, reissue, set-active) plus the profile read the session needs, added to the `DataAdapters` bag.
- [x] 3.2 `SupabaseAccountsAdapter` over the typed client and the two Edge Functions; explicit column selection so the withheld `code_hash` is never requested.
- [x] 3.3 `MockAccountsAdapter` + fixtures typed from the schema types, so People and Access work in demo mode once promoted (design D8).
- [x] 3.4 `RealSessionProvider`: read the Supabase session, load own profile, construct the `real` session, and expose sign-out. No shell changes (design D2).
- [x] 3.5 Account watch: revalidate the profile on mount, on tab visibility, and every five minutes; an empty own-profile read means deactivated → sign out with the deactivation message (design D6).
- [x] 3.6 Claim-mismatch handling: compare profile role/outlet to the decoded token claims, refresh once, sign out with the role-changed message if it persists (design D7).
- [x] 3.7 Unit tests for the provider: deactivation detected, mismatch refreshed then signed out, sign-out clears the session, no session renders nothing.

## 4. Routes and screens

- [x] 4.1 `/sign-in`: email + password, one error message for both wrong-email and wrong-password, and a link to activation. Redirect to the originally requested surface after success.
- [x] 4.2 `/activate`: email + one-time code + new password, minimum-length validation client-side as well, then sign in with the password just set and land on the role home.
- [x] 4.3 `RequireSession` guard + `RealRoot` provider stack; real role routes `/owner`, `/admin`, `/counter`, `/staff`; a role path that is not the session's own redirects to the session's own home (design D2).
- [x] 4.4 Landing: redirect a signed-in visitor to their role home; keep the demo link for everyone else.
- [x] 4.5 Account menu component + the shell `accountMenu` slot in `PhoneShell` and `CounterShell`; name, role, outlet, sign out. Demo tree leaves the slot unfilled (design D9).
- [x] 4.6 People (Super Admin, all outlets) and Access (Franchise Admin, own outlet): list accounts, provision, re-issue, deactivate/reactivate, with the one-time code shown exactly once after issue.
- [x] 4.7 Gate registry: promote `owner-dashboard`, `admin-dashboard`, `counter-home`, `staff-home`, `owner-people` to `live`; add `admin-people` ("Access") as `live` (design D8).
- [x] 4.8 Component tests for sign-in, activation, and the admin surfaces — including that a Franchise Admin's form offers no role or outlet outside their authority.

## 5. End-to-end verification

- [x] 5.1 Playwright: all four roles sign in against the local stack and land on their own shell; a wrong password is refused; a role path belonging to another role redirects.
- [x] 5.2 Playwright: an admin provisions an account, the code is shown once, a fresh context redeems it and signs in — the gate's provisioning clause walked literally.
- [x] 5.3 Playwright: deactivate an account with its app open and assert the session ends without waiting for token expiry.
- [x] 5.4 Playwright: the existing demo suite still passes with six surfaces now `live` — banner present, no request leaves the app origin, no sign-out control in demo chrome.

## 6. Gates, docs, and hygiene

- [x] 6.1 Full local gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run contrast`, `npm run test:db`, `npm run test:rls`, `npm run test:e2e` all green.
- [x] 6.2 Update `docs/ROLES_AND_PERMISSIONS.md` (authentication shipped), `docs/SCREENS.md` (sign-in, activation, People, Access; role homes real), `docs/SECURITY_AND_PRIVACY.md` (code handling), `docs/OPERATIONS.md` (provisioning/reset/deactivation runbook), `docs/LIMITATIONS.md` (interim Biller email sign-in), `AGENTS.md` (status + auth section).
- [x] 6.3 Record the deferred signed-in password change in `openspec/todos/`.
- [x] 6.4 Run `npm run roadmap:sync` and confirm the board reflects the change's state.

## 7. PHASE GATE — roadmap checkpoint #4

- [x] 7.1 **All four roles sign in and land on their own shell** — demonstrated against the local stack, not asserted.
- [x] 7.2 **An admin provisions a staff account end-to-end with a one-time code** — created, code handed over, redeemed, signed in.
- [x] 7.3 **Deactivating an account blocks access without waiting for token expiry** — proven at the database (still-valid token reads nothing) and in the open client (session ends).
