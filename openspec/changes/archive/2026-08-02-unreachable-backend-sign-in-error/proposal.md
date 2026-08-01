# Proposal: Unreachable Backend Sign-In Error

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #24 · **Gate**: an unreachable Auth host produces connection guidance while an unknown username and wrong password remain indistinguishable.

## Why

Online sign-in opens every billing day. A dropped connection must not accuse an
operator of entering the wrong password and send them into an unnecessary reset flow.

## What Changes

- Distinguish a request that received no backend response from an authentication refusal.
- Show connection-specific guidance for unreachable sign-in and activation requests.
- Preserve the identical response for unknown usernames and wrong passwords.
- Cover classification at the adapter, UI, and end-to-end boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-and-access`: Authentication transport failures become a distinct,
  enumeration-safe user-visible outcome.

## Impact

Authentication error types, Supabase Auth error mapping, sign-in and activation
copy, and their tests change. No schema, role, token, or credential rule changes.

## Non-goals

- Offline authentication or cached-password validation.
- Different messages for an unknown username and an incorrect password.
- Automated retry beyond allowing another submission.

## Docs to update before archive

`docs/ROLES_AND_PERMISSIONS.md`, `docs/LIMITATIONS.md`, and `docs/TESTING.md`.
