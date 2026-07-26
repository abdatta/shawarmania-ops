# Proposal: auth-and-roles

> **Model**: Opus · **Wave**: B · **Depends on**: #2, #3 · **Gate**: all four roles sign in and land on their own shell; an admin provisions a staff account end-to-end with a one-time code; deactivating an account blocks access without waiting for token expiry.

## Why

The tenancy model from #2 is inert until real sessions carry real claims. This is the change that makes the four roles exist in practice rather than on paper, and it is the prerequisite for anything going live.

The dependency on #3 is real, not transitive tidiness: this change's own gate requires the role shells to land in, and the real session implements the session-provider interface #3 defines. Auth built before that interface exists would be auth built twice.

## Scope

- Phone number + password sign-in for Super Admin, Franchise Admin, and Employee.
- Admin provisioning through an Edge Function: create the auth user with a pre-confirmed phone, issue a single-use one-time code. **No SMS provider and no TRAI/DLT registration required** — see `docs/ROLES_AND_PERMISSIONS.md` for why that constraint shaped the design.
- First-run flow: sign in with a one-time code, set a password.
- The real session behind the same provider interface the demo session already implements, so the shell needs no changes.
- Immediate enforcement of `is_active` at the policy level, so deactivation does not wait for a token refresh.
- Session persistence tuned for field use; a delivery employee should not be re-authenticating weekly.

## Non-goals

- No counter device enrolment or PIN unlock — that is #9, and it is only needed once billing arrives.
- No self-service password reset. Admin-initiated only, deferred by design.
- No feature surfaces.

## Design questions to settle during `/opsx:propose`

- One-time code lifetime and single-use enforcement.
- What happens to an in-flight session when a user's role or outlet is reassigned.

## Docs to update before archiving

`docs/ROLES_AND_PERMISSIONS.md` — mark the authentication section as shipped and correct anything that differed in practice.
