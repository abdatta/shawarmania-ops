> **Model**: **GPT-5.6 Sol (high lead)** · **Wave**: D · **Depends on**: #10, #22, #24, #30 · **Delegation**: bounded subtasks may use GPT-5.6 Sol at medium or below or GPT-5.6 Terra up to xhigh; the lead retains security, authority, migration, transaction, session-lifecycle, and final integration decisions · **Gate**: an admin edits a person's facts and permitted outlet roles through one truthful workflow; promotion, transfer, reset, activation, username correction, deactivation, and invalid-session recovery each do exactly what their label says without accidentally ending access.

## Why

The People surface exposes implementation actions such as “New code”, “Assign to an outlet”, and “End an assignment”, while hiding the ordinary business task of changing where somebody works or promoting them. In production this ambiguity has already contributed to an Employee-to-Biller promotion deactivating an account, established users being labelled “Awaiting activation”, and a password-reset recipient reaching an authenticated-looking shell with a session the server would not accept.

These are one lifecycle problem: account credentials, active state, and outlet assignments are independent facts, but the product neither names their states truthfully nor provides safe transitions between them. The correction is needed before more staff and tablets are onboarded through the live flows.

## What Changes

- Replace the People row's assignment-oriented actions with a compact human-task menu: **Edit**, **Change username**, **Set up account** or **Reset password** according to lifecycle state, **Change sign-in email** where permitted, and **Deactivate** or **Reactivate**.
- Make **Edit** cover personal facts and the caller-authorized assignment set. A single-assignment person gets a simple outlet-and-role form; **Works at multiple outlets** progressively reveals an assignment-row editor, and an existing multi-outlet person opens expanded.
- Treat one live role per outlet as the supported shape. Biller includes Employee attendance capability, so Employee and Biller are alternatives at one outlet rather than stackable roles.
- Apply transfers, promotions, demotions, additions, and removals as one authorized, atomic assignment-set change. Ordinary editing never deactivates sign-in. Ending the final assignment is an explicit **Mark as left** path with a separate confirmation.
- Let a Franchise Admin switch Employee and Biller only at outlets they manage. They cannot grant, alter, or remove Franchise Admin or Super Admin assignments. A Super Admin may change any other person's assignments, including another Super Admin's, subject to the final-Super-Admin guard; granting Super Admin remains a guarded flow requiring a private sign-in email. Self-demotion is not offered.
- Preserve open sessions through username correction. The old username stops working for future sign-ins, the new username works with the same password, and outstanding one-time links remain attached to the account.
- Replace **New code** with state-aware **Set up account** / **Reset password** language. Reuse one concise QR/link handover component with purpose-specific headings and highlights, a prominent QR and copy action, the username, one-use/expiry facts, and only relevant warnings.
- Derive People status from actual credential history plus a live, unexpired one-time link. An established account with a reset link remains active and reads as **Password reset issued**, never **Awaiting activation**; expired links are not outstanding.
- Separate first activation from password reset so assignment changes replace only a pending first-activation link when necessary and do not silently replace an established user's password-reset link.
- Distinguish a server-confirmed invalid or revoked human session from a genuine authorization refusal and from an unanswered network request. An invalid session is cleared and returned to sign-in with a short explanation; a network failure never signs the person out.
- Ensure activation and reset establish and verify the replacement session before entering the app, so a password change cannot leave stale authenticated-looking UI behind.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-and-access`: Truthful account lifecycle states, safe assignment-set editing and role transitions, purpose-aware one-time links, username-session preservation, authority rules, and invalid-session recovery.
- `app-shell`: A confirmed invalid session leaves protected shells and reaches sign-in with its reason, while an unconfirmed session remains in retryable connection state.

## Impact

- People UI, responsive sheets/dialogs, semantic-token styling, demo fixtures, adapters, and their component/browser tests.
- Supabase Auth administration, account Edge Functions, shared caller/session error classification, account-invite representation, and transactional assignment functions.
- Postgres migration(s), generated database types, database/RLS/real-HTTP account tests, and real-backend auth E2E coverage.
- The existing assignment and account-invite contracts are refined without putting authority into tokens or exposing credentials, private emails, or service-role access to the browser.
- Archive requires updates to `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/TESTING.md`, plus reconciliation of the related todo notes and todo index.

## Non-goals

- Self-service password or username changes.
- Email-delivered password recovery or security notifications.
- Multiple simultaneous roles at one outlet; Biller remains Employee-capable.
- A general audit-log subsystem.
- Redesigning the counter tablet's eligibility/enumeration handshake.
- Changing historical attendance or operational rows when an assignment changes.
