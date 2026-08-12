## ADDED Requirements

### Requirement: Protected shells leave only for a confirmed invalid human session

The real shell SHALL consume one shared human-session lifecycle signal across session resolution and protected adapters. A server-confirmed invalid or revoked human session SHALL clear the resolved shell state and navigate to sign-in with its reason. A verified authorization refusal SHALL remain on the requesting surface, and a request that receives no answer SHALL preserve the shell/session and offer retry.

This signal SHALL NOT merge human account sessions with counter-tablet device sessions, whose removal and recovery continue to follow the counter-device contract. Demo mode SHALL neither emit nor consume real-session invalidation.

#### Scenario: A protected action discovers an invalid session

- **WHEN** any real human adapter receives the canonical server-confirmed session-invalid response
- **THEN** every protected shell stops rendering from the stale session and sign-in states that the session ended

#### Scenario: A permission refusal stays a permission refusal

- **WHEN** a verified human session receives a forbidden response
- **THEN** the requesting surface explains the refused action and the shell does not sign out

#### Scenario: A connection failure preserves the shell

- **WHEN** a protected request has no response because the backend is unreachable
- **THEN** the app preserves session state, presents retryable connection guidance, and does not navigate to sign-in

#### Scenario: Demo does not touch real authentication

- **WHEN** the same People surface is walked in demo mode
- **THEN** no real-session validation, invalidation, or sign-out operation occurs
