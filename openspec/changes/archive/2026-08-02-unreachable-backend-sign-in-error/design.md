## Context

`src/data-access/auth.ts` currently collapses every Supabase Auth failure into
`invalid_credentials`. That protects account enumeration but also mislabels a
request that received no HTTP response. Daily billing-device authentication
raises the operational cost of that ambiguity.

## Goals / Non-Goals

**Goals:**

- Preserve one credential refusal for unknown identifiers and wrong passwords.
- Classify genuine transport failure without inspecting provider message text.
- Give sign-in and activation consistent, actionable connection copy.

**Non-Goals:**

- Cached or offline authentication.
- Distinguishing individual credential failure causes.
- Changing Supabase sessions, aliases, or server bridges.

## Decisions

### Classify by response shape, never message text

The adapter will recognize provider retryable-fetch/network errors and absent or
zero HTTP status as `unreachable`. All provider responses that reached Auth but
refused authentication remain `invalid_credentials` unless an existing explicit
rate-limit/activation category applies.

Message matching was rejected because provider copy is unstable and localized.
Treating every retryable server response as unreachable was rejected because a
received 5xx is still a backend response and may need existing availability handling.

### Keep classification in the adapter contract

`SignInError` gains an `unreachable` code and activation's existing unavailable
path is allowed through instead of being swallowed. Screens render copy from the
typed result and never inspect Supabase error classes directly.

Putting Supabase-specific checks in components was rejected because it breaks
the adapter seam and would duplicate behavior between username, email, and activation.

### Do not automatically retry credential submissions

The screen explains that the server could not be reached and leaves the entered
identifier available for manual retry while password handling follows the
existing form policy. Automatic retries were rejected because they can amplify
rate limits and make a person wait without control.

## Risks / Trade-offs

- **Provider error shapes change** → cover representative error objects and an
  unreachable-host integration path; default unknown responses to the safer
  existing refusal unless there is positive transport evidence.
- **Connection copy becomes an account oracle** → the classification depends
  only on whether any HTTP response exists, never on identifier-specific content.
- **Billing still cannot authenticate offline** → this is deliberate; counter
  grants require an online check at open and cutoff.

## Migration Plan

Ship the typed error and mappings atomically with the UI copy. No data migration
or rollback procedure is required; rollback restores the former generic refusal.

## Open Questions

None.
