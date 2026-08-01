## 1. Error contract

- [x] 1.1 Add the enumeration-safe `unreachable` sign-in result and preserve activation's unavailable result through the auth adapter.
- [x] 1.2 Classify only positive no-response/network evidence as unreachable; keep all reached credential refusals uniform.
- [x] 1.3 Unit-test username, email-bridge, activation, wrong-password, rate-limit, and representative transport failures.

## 2. Surfaces and documentation

- [x] 2.1 Render actionable connection copy on sign-in and activation without exposing provider details or account existence.
- [x] 2.2 Add browser coverage for unreachable sign-in and confirm ordinary credential refusal copy is unchanged.
- [x] 2.3 Update `docs/ROLES_AND_PERMISSIONS.md`, `docs/LIMITATIONS.md`, and `docs/TESTING.md`.

## 3. Verification

- [x] 3.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [x] 3.2 Run `npm run db:start && npm run db:reset` followed by `npm run test:e2e:auth` because the sign-in path changes.
- [x] 3.3 PHASE GATE: an unreachable Auth host names the connection problem, while unknown username and wrong password remain indistinguishable.
