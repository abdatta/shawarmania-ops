# Proposal: auth-and-roles

> **Model**: Opus · **Wave**: B · **Depends on**: #2, #3 · **Gate**: all four roles sign in and land on their own shell; an admin provisions a staff account end-to-end with a one-time code; deactivating an account blocks access without waiting for token expiry.

## Why

The tenancy model from #2 is inert until real sessions carry real claims. This is the change that makes the four roles exist in practice rather than on paper, and it is the prerequisite for anything going live.

The dependency on #3 is real, not transitive tidiness: this change's own gate requires the role shells to land in, and the real session implements the session-provider interface #3 defines. Auth built before that interface exists would be auth built twice.

## Scope

- **Email + password** sign-in for Super Admin, Franchise Admin, and Employee. *(This seed originally said phone + password; the owner replaced that with email on 2026-07-26 — see `docs/ROLES_AND_PERMISSIONS.md` for why. The schema, seeds and `supabase/config.toml` already assume email.)*
- Billers sign in the same way for now. Device enrolment and PIN unlock are #9's job; until then a Biller account is an ordinary email login that lands on the counter shell.
- Admin provisioning through an Edge Function: create the auth user with a pre-confirmed email, issue a single-use one-time code. **No SMS provider and no confirmation mail** — nothing external is ever sent; the admin passes the code on by hand.
- First-run flow: redeem the one-time code, set a password, sign in.
- The real session behind the same provider interface the demo session already implements, so the shell needs no changes.
- Immediate enforcement of `is_active` — at the policy level (already true since #2) *and* in the client, so a deactivated user's open app stops working rather than lingering until a token refresh.
- Session persistence tuned for field use; a delivery employee should not be re-authenticating weekly.
- The admin surfaces that make provisioning real: **People** for the Super Admin (all outlets), **Access** for the Franchise Admin (own outlet only).

## Non-goals

- No counter device enrolment or PIN unlock — that is #9, and it is only needed once billing arrives.
- No self-service password reset. Admin-initiated only, deferred by design.
- No signed-in "change my own password" screen — noted to `openspec/todos/`, not built here.
- No feature surfaces. The role homes shipped in #3 become real; nothing new is designed.
- No HR roster management (`admin-employees`). Issuing app access is an identity concern and ships here; the roster stays with the operations surfaces.

## Design questions to settle during `/opsx:propose`

- One-time code lifetime and single-use enforcement. → **Settled in design D4**: 10 Crockford-base32 characters, 7-day expiry, five attempts, hash-at-rest, atomic single consumption, superseded by re-issue.
- What happens to an in-flight session when a user's role or outlet is reassigned. → **Settled in design D7**: the client detects the claims/profile mismatch, refreshes once, and signs out with an explanation if it persists.

## Docs to update before archiving

`docs/ROLES_AND_PERMISSIONS.md` — mark the authentication section as shipped and correct anything that differed in practice.
`docs/SCREENS.md` — sign-in, activation, People and Access exist; the four role homes are real.
`docs/SECURITY_AND_PRIVACY.md` — the one-time code's handling, lifetime, and why the hash never reaches a client.
`docs/OPERATIONS.md` — the runbook for provisioning, re-issuing a code, and deactivating an account.
`AGENTS.md` — the status line and the authentication section, once sign-in exists.
