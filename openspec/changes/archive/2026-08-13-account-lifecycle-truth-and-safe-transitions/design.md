## Context

Three production reports expose the same missing boundary. Supratik reset a forgotten password, signed in, and then reached a counter approval action whose Edge Function could not verify the session; the client retained a ready shell and rendered the resulting `403` as a permission problem. Arpita was changed from Employee to Biller through separate “end assignment” and “assign” actions; the final-assignment sheet defaulted deactivation on, and the new one-time link then made her established account read as “Awaiting activation”. The People menu exposes each storage operation separately, so the safe business transition does not exist as one operation.

Current facts that constrain the correction:

- authority is always re-derived from live `assignments`; it is absent from access-token claims;
- one partial unique index permits one live assignment per person per outlet, while a person may hold assignments at several outlets and different roles across them;
- Biller already includes Employee attendance capabilities at that outlet;
- profile facts, assignment grant/end, active state, username, account email, and code issuance currently cross several write boundaries;
- `account_invites` does not distinguish first activation from password reset, and the live query does not exclude expired rows;
- the account Edge boundary collapses unverifiable caller, authority refusal, and some lookup failures too aggressively;
- username correction already preserves sessions and has a real-backend regression test;
- the change touches authentication, a privileged Edge boundary, transactional role authority, RLS-facing data, responsive UI, and the real-backend auth suite. It is not eligible for the quickfix lane.

The lead implementation model is GPT-5.6 Sol at high reasoning. Subagents are optional accelerators, not independent designers: Sol subagents are capped at medium reasoning, while Terra may use medium through xhigh according to the bounded task's complexity. Every delegated contract and file boundary is fixed by the lead first; higher Terra reasoning increases execution depth, not decision authority.

## Goals / Non-Goals

**Goals:**

- Make People describe recognizable tasks and truthful account states.
- Save a person's facts and intended assignment set without intermediate loss of access.
- Make promotion, demotion, transfer, multi-outlet placement, and departure explicit and authority-safe.
- Separate first activation from password reset while reusing one concise handover UI.
- Preserve sessions for username and assignment changes, while ending a server-confirmed invalid session with a useful reason.
- Preserve the existing tenancy, final-owner, private-email, history, and no-authority-in-token invariants.
- Give the apply agent an explicit delegation map that avoids overlapping writers and reserves consequential decisions for the Sol-high lead.

**Non-Goals:**

- Self-service credential settings or emailed recovery.
- More than one live role at the same outlet.
- Changing counter-tablet username enumeration or eligibility timing.
- Adding an audit-log subsystem.
- Deleting assignment or operational history.
- Letting a form or access token become an authority boundary.

## Decisions

### D1. Credential lifecycle is derived from Auth history plus a purpose-bearing live link

`account_invites` gains a non-null purpose with two values: `activation` and `password_reset`. Provisioning always issues `activation`. An authorized recovery action inspects the target through the service-side Auth boundary: a user with no successful sign-in history receives activation/setup semantics; a user with sign-in history receives password-reset semantics. The browser never queries `auth.users` and receives only the derived lifecycle facts it is permitted to display.

An invite is outstanding only while `consumed_at` and `superseded_at` are null **and** `expires_at > now()`. People combines `hasSignedIn`, active state, live assignments, and the live invite purpose:

| Account facts | People state | Credential action |
|---|---|---|
| Never signed in, live activation link | Set-up link issued | Replace set-up link |
| Never signed in, no live link | Needs setup | Set up account |
| Signed in before, live reset link | Active · password reset issued | Replace reset link |
| Signed in before, no live link | Active | Reset password |
| Deactivated | Deactivated | Reactivate; no link is issued while inactive |

A reset link does not imply that the existing password has stopped working: that happens only when the link is redeemed. Thus “Awaiting activation” is never shown merely because any invite row exists.

The migration adds the purpose with `activation` as the historical default, then classifies only currently live, unused invitations for Auth users with a non-null sign-in history as `password_reset`. Expired rows do not influence UI. Historical rows need no forensic purpose reconstruction because product behavior reads only live invitations.

**Rejected:** infer activation versus reset forever from the mere presence of an invite. That is the current lie. Also rejected: expose `auth.users.last_sign_in_at` directly to the browser; credential metadata stays behind the privileged account boundary.

### D2. One transactional command applies profile facts and the intended assignment set

The simple and expanded editors produce the same normalized command: editable profile facts plus a complete desired set of live `{outletId, role, startedOn}` assignments the caller is allowed to manage. One privileged Edge action re-verifies the caller, loads the target's complete current assignment set, validates the complete desired state, and calls one service-only database function. That transaction:

1. locks the target profile and relevant live assignment rows;
2. validates uniqueness, role/outlet shape, actor authority, final-Super-Admin and account-email invariants;
3. updates profile facts;
4. preserves unchanged assignment rows;
5. ends changed or removed rows instead of rewriting or deleting history;
6. inserts new rows for transfers, promotions, demotions, and added outlets;
7. conditionally replaces a live **activation** link after the final assignment set exists; and
8. returns the new assignment set and a replacement handover only when one was required.

Role changes at one outlet are end-plus-insert in the transaction. This preserves the history that the person was an Employee before becoming a Biller. The new assignment's start defaults to the effective transition date; an explicitly permitted `startedOn` is retained for new placements. Unchanged assignments keep their original ID and start date.

The ordinary editor refuses an empty desired set. Removing the last assignment is the separate **Mark as left** command, which atomically ends all live assignments and deactivates sign-in after confirmation. Editing, transferring, promoting, or demoting never changes `profiles.is_active`.

**Rejected:** have the client call update-profile, end-assignment, grant-assignment, and deactivate in sequence. That reproduces the partial state that locked Arpita out. Also rejected: update an assignment's role or outlet in place, because that rewrites historical authority.

### D3. Assignment authority is validated against both current and desired states

The server, not the offered controls, enforces this matrix:

| Caller | Target transition |
|---|---|
| Franchise Admin | May change only Employee ↔ Biller and outlet placement at outlets they currently manage, and only when the target's complete current and desired assignment sets contain no Franchise Admin or Super Admin role and no outlet outside the caller's scope |
| Super Admin | May change another person's assignments across all outlets and roles, including another Franchise Admin or Super Admin |

No admin uses this path on their own account. The UI already omits self-actions, and the privileged boundary also refuses a hand-crafted self-edit. A Super Admin granting Super Admin authority enters the guarded owner-access subflow inside Edit, supplies the required private sign-in email, and confirms the consequence. Removing a Super Admin assignment retains its private email. The database continues to refuse removal of the final live Super Admin regardless of UI or caller.

One live role is allowed per outlet. The advanced editor therefore adds outlet rows, not arbitrary role chips. Biller and Employee are mutually exclusive at one outlet because Biller already confers Employee attendance capability.

**Rejected:** allow an FA to alter another FA at a shared outlet or demote an SA. Managing staff at an outlet does not grant authority over administrative peers or owners. Also rejected: stack Employee and Biller rows at one outlet; the schema and capability contract deliberately model Biller as Employee-capable.

### D4. Progressive disclosure keeps the common edit simple

The People row menu becomes task-based. **Edit** contains full name, phone, job title, and assignment editing. For exactly one ordinary outlet assignment, it initially shows one Outlet and one Access role control. **Works at multiple outlets** expands to one row per outlet with role and start date plus Add/Remove controls. Zero-assignment, multi-assignment, and mixed-role accounts open expanded because collapsing them would hide material state.

Owner access is not presented as an ordinary role option. For an authorized Super Admin editing another person, a separate guarded control inside Edit opens the owner-access confirmation. An FA never sees Franchise Admin or Super Admin controls. Assignments outside the caller's authority are never silently omitted and then deleted: the Edge action validates the complete current state before accepting the desired set.

The destructive **Mark as left** control lives separately at the bottom of Edit. It is not a role value, not the consequence of deleting the final row, and not checked by default anywhere.

**Rejected:** retain separate “Assign to an outlet” and “End an assignment” menu entries. They expose persistence primitives and make promotion unsafe. Also rejected: label the disclosure “multiple roles”; the supported shape is one role per outlet.

### D5. Activation and reset share one handover component but not one meaning

One reusable handover component accepts a purpose-specific presentation model rather than conditionally composing prose throughout the account surface. Both variants show a large QR, a primary Copy link action, the person's name and highlighted username, and a compact one-use/expiry treatment. The activation variant says **Set up account**; the established-account variant says **Reset password** and briefly states that using it replaces the password and ends other personal sessions. Deactivated accounts must be reactivated before link issuance.

The component uses semantic design tokens only, is usable at phone and desktop sizes in light and dark themes, and keeps explanatory text subordinate to visual hierarchy. Replacing an existing link gets one concise warning; irrelevant warnings are absent.

After successful redemption, the client clears any superseded local human session, signs in through the ordinary username/password path, verifies the newly returned session against the Auth server, refreshes the shared session holder, and navigates only when that holder reflects the new session. If post-redemption sign-in fails, the password has still changed and the screen directs the person to ordinary sign-in without pretending the old shell is valid.

**Rejected:** duplicate activation and reset panels. They would drift in security facts and accessibility. Also rejected: navigate as soon as password update succeeds; that is the race that can expose stale shell state.

### D6. Authentication failure, authorization refusal, and transport uncertainty remain distinct

Shared Edge caller resolution returns a typed result rather than `Caller | null`. Missing, malformed, expired, or Auth-rejected bearer credentials produce `401 session_invalid`. A verified caller who lacks authority produces `403 forbidden`. A caller/profile lookup that fails because the backend did not answer produces a server/transport failure, not `401` or `403`.

The real session holder and real adapters share one invalid-session signal. A server-confirmed `401 session_invalid`, or an Auth validation response that definitively rejects the stored session, clears local credentials, resets cached resolved state, and reaches sign-in with “Your session ended. Sign in again.” Deactivation retains its more specific explanation. A timeout, fetch failure, offline state, or indeterminate profile lookup preserves the stored session and displays the existing retryable connection state.

This behavior applies to human sessions only. Counter tablet device sessions retain their own removal and recovery semantics.

**Rejected:** sign out on any failed request. That turns dead internet into credential loss. Also rejected: translate every failed caller lookup to `403`; it tells a person their authority is wrong when the server cannot verify who they are.

### D7. The Sol-high lead owns decisions and integrates non-overlapping subagent work

The apply turn begins with the lead reading the apply skill and all artifacts. The lead creates a task/file ownership map before spawning agents and does not allow two agents to edit the same file group concurrently.

The lead also creates an agent roster once and reuses it for the lifetime of the change. One persistent agent owns each delegated workstream; later corrections, test failures, reviews, and documentation follow-ups return to that same agent through follow-up tasks instead of spawning a replacement with the same brief. A completed or idle agent is resumed rather than recreated. This preserves its local context and avoids paying repeatedly to rediscover the contract and files.

Recommended execution split:

| Owner | Reasoning | Bounded ownership | Must not decide or edit |
|---|---|---|---|
| Main GPT-5.6 Sol | high | Migration shape, SQL transaction and guards, failure taxonomy, reset-session sequence, adapter contract, integration, adversarial review, final verification/fixes | Nothing material is delegated without a frozen contract |
| Sol subagent | medium | Edge action plumbing and real-HTTP tests against the lead-defined request/response and SQL contract | No authority, invite-purpose, status, or error-semantics changes; no migration edits unless the lead explicitly transfers the whole migration workstream |
| Terra subagent | high or xhigh | Progressive People editor, responsive interaction design, accessibility, and focused component/browser tests against finalized adapter types/mocks | No Supabase, RLS, Auth, Edge, migration, or authority code |
| Terra subagent | high | Reusable activation/reset handover component and visual/accessibility tests in its own files | No redemption/session logic and no account-state derivation |
| Terra subagent | medium | Demo fixtures, prose docs, and mechanical test expectation updates after behavior is stable | No normative decisions; discrepancies return to the lead |

Critical subwork may go to a Sol-medium agent only after the Sol-high lead has written the exact invariants and acceptance tests into its task message. Terra-high/xhigh is appropriate for broad UI state, responsive layout, accessibility, and test completeness, but does not authorize Terra to reinterpret account states or authority rules. The lead personally reviews every security-sensitive diff and runs integration tests. Agents report findings rather than silently widening scope. If file boundaries cannot be kept disjoint, the lead performs that work sequentially instead of delegating it.

A new agent after the roster is established requires one recorded reason: it owns a genuinely new non-overlapping workstream; an intentionally independent review must not inherit the implementor's assumptions; the former agent is unavailable; or the former agent's accumulated irrelevant context makes a concise fresh brief materially more token-efficient. “Start another pass” and “the first attempt failed” are not reasons—the existing owner receives a follow-up. The lead checks the live agent roster before every spawn and never recreates an agent merely because it is idle or has completed its previous turn.

## Risks / Trade-offs

- **[Whole-set editing could delete an assignment the caller never saw]** → The Edge action loads the complete current set, requires authority over both current and desired states, and rejects stale or partial commands rather than interpreting omission as permission.
- **[Two admins race on the same person]** → Lock target rows and optionally include a current-state fingerprint/version in the command; the second stale edit is refused and must reload.
- **[Purpose backfill mislabels historical invitations]** → Only live unconsumed invitations affect behavior; classify those from privileged Auth history and leave inert history at the safe default.
- **[Password reset invalidates the session currently rendering the app]** → Redemption always establishes and server-verifies a fresh session before navigation; any protected `401` clears stale state.
- **[A network outage looks like an invalid session]** → Only definitive Auth/gateway rejection triggers sign-out; transport and server faults remain retryable.
- **[A broad editor weakens FA tenancy]** → Validate current and desired complete sets at the privileged boundary and retain database/RLS tests for cross-outlet, FA-on-FA, FA-on-SA, and hand-crafted requests.
- **[UI work drifts from server capability]** → Freeze adapter types and command/result fixtures before delegating the editor; UI agents never import Supabase.
- **[Concurrent subagents create merge-like conflicts in the shared worktree]** → Assign exclusive file groups and sequence any work touching the account surface entry file through the lead.
- **[Repeatedly recreating the same subagent wastes context and tokens]** → Keep a named workstream roster, resume agents with follow-up tasks, and require the lead to record the exception before any replacement or duplicate spawn.

No money arithmetic, billing integrity, or offline counter-write semantics change. No new outlet-scoped table is introduced; existing assignment policies remain the isolation boundary, and their coverage expands for the new command.

## Migration Plan

1. Add invite purpose and the transactional person/assignment commands in a forward migration; backfill only behaviorally live invitations from Auth sign-in history and update generated types.
2. Expand database and RLS tests before exposing the new Edge action, including rollback of failed whole-set changes and final-owner/email guards.
3. Deploy the Edge behavior that understands both purpose and the new command; keep old adapter actions until the frontend cutover so the deployed backend is forward-compatible.
4. Publish the frontend cutover: new lifecycle states, editor, handover component, reset-session sequence, and centralized invalid-session handling.
5. Remove obsolete client actions only after all call sites and demo adapters use the new contract.
6. Run the complete local verification suite, including Docker-backed database/RLS/auth E2E, generated-type parity, and phone/desktop light/dark visual checks, before production deployment.

Rollback of the frontend and Edge Function is possible while the additive purpose column and RPCs remain. The migration is not rolled back in production; a corrective forward migration is required if its schema or data classification is wrong. For that reason migration, guards, backfill, and database proof remain lead-owned and gate publication.

## Open Questions

None. Product decisions on Mark as left, guarded owner changes, private email, and authority have been resolved in this proposal.
