> **Apply lead**: GPT-5.6 Sol at high reasoning. The lead owns tasks marked **LEAD** and final integration. Optional subagents use only the named bounded workstreams: **SOL-MEDIUM** for complex but contract-frozen server/test work, **TERRA-HIGH/XHIGH** for broad UI/UX, responsive behavior, accessibility, and its tests, **TERRA-HIGH** for bounded component work, and **TERRA-MEDIUM** for mechanical fixtures/docs. Terra is never assigned below medium. One writer owns a file group at a time; the lead reviews every security-sensitive diff. Create each workstream agent once and reuse it with follow-up tasks; before any later spawn, inspect the live roster and record why a genuinely new or intentionally independent agent is more appropriate or more token-efficient.

## 1. Lead pre-flight and contract freeze

- [ ] 1.1 **LEAD** Read the apply skill, all four change artifacts, `AGENTS.md`, the existing identity/app-shell specs, related archived auth designs, current todos, and the current dirty-worktree diff; record an exclusive file-ownership map and persistent agent roster before delegating anything.
- [ ] 1.2 **LEAD** Create at most one agent for each initial delegated workstream, retain its identifier after completion, and use follow-up tasks for fixes, test failures, review responses, and later phases; inspect the live roster before every spawn and record the new-workstream, independence, availability, or token-efficiency reason for any additional agent.
- [ ] 1.3 **LEAD** Freeze typed contracts for lifecycle state, invite purpose, assignment-set command/result, stale-edit refusal, and canonical `session_invalid` versus `forbidden` failures; identify exact existing adapters/actions that remain temporarily compatible during cutover.
- [ ] 1.4 **LEAD** Write the security acceptance matrix before implementation: SA/FA/self authority across current and desired sets; final SA and account-email invariants; activation/reset replacement rules; invalid/offline/deactivated session outcomes.
- [ ] 1.5 **LEAD** Establish failing reproductions for the three production paths and expired-link defect: post-reset stale session reaches protected action, established reset reads Awaiting activation, Employee-to-Biller path can deactivate, and an expired unused invite remains outstanding.

## 2. Database lifecycle and atomic assignment transitions

- [ ] 2.1 **LEAD** Add a forward migration for a constrained non-null activation/password-reset invite purpose and live-invite expiry semantics; backfill behaviorally live invitations from privileged Auth sign-in history without exposing Auth metadata to client roles.
- [ ] 2.2 **LEAD** Add one service-only transactional person/assignment-set function that locks current state, validates a stale-state fingerprint/version, updates permitted profile facts, preserves unchanged rows, ends replaced/removed rows, inserts new placements, and rolls back completely on every failure.
- [ ] 2.3 **LEAD** Enforce in the transaction: one role per outlet, Employee/Biller alternative, no self-edit, FA only Employee/Biller within every managed current/desired outlet, SA changes to other accounts, required email for Super Admin, retained email on demotion, and final-Super-Admin protection.
- [ ] 2.4 **LEAD** Add an explicit service-only Mark as left transaction that ends all live assignments and deactivates the account atomically, with no history deletion and no reuse by ordinary Edit.
- [ ] 2.5 **LEAD** Make assignment edits replace only a live activation invitation after the final assignment set exists, preserve a live password-reset invitation, and create no unsolicited invitation.
- [ ] 2.6 **LEAD** Extend pgTAP/database tests for success, rollback, races/stale edits, promotion history, transfer, multi-outlet role sets, final owner, private email, reset preservation, activation replacement, expiry, and Mark as left; prove each privilege boundary with hand-crafted database calls.
- [ ] 2.7 **LEAD** Reset the local database, regenerate `src/data-access/database.types.ts`, inspect the migration diff, and confirm a second reset produces no generated-type drift.

## 3. Privileged account and session boundaries

- [ ] 3.1 **LEAD** Refactor shared caller resolution to return typed authenticated, invalid-session, and backend-failure outcomes; make every affected human Edge action return canonical `401 session_invalid`, `403 forbidden`, or server/transport failure without changing counter-device semantics.
- [ ] 3.2 **LEAD** Extend the privileged identifiers/lifecycle read to return only caller-authorized username, private email, successful-sign-in fact, and live purpose/expiry; never expose provider aliases or raw Auth metadata.
- [ ] 3.3 **SOL-MEDIUM** Implement the lead-defined account Edge request/response plumbing for assignment-set edit, Mark as left, purpose-aware setup/reset issuance, and state reads; do not change the authority matrix, transaction, purpose derivation, or failure taxonomy.
- [ ] 3.4 **LEAD** Review and adversarially test the Edge diff, including forged current state, omitted out-of-scope assignments, FA-on-FA, FA-on-SA, self-edit, final-SA removal, inactive issuance, and expired/replaced links.
- [ ] 3.5 **SOL-MEDIUM** Extend real-HTTP account-flow tests against the frozen contract for atomic edit, promotion/transfer, purpose-aware issuance, username session preservation, invalid versus forbidden responses, and complete refusal rollback.
- [ ] 3.6 **LEAD** Independently inspect and run the server tests, add any missing negative cases, and verify no access token contains authority and no service-role credential reaches browser code.

## 4. Adapter seam, mocks, and shared human-session lifecycle

- [ ] 4.1 **LEAD** Update typed account adapters and error models for derived lifecycle state, intended assignment-set editing, Mark as left, and purpose-aware handover while preserving the real/demo seam and removing obsolete public actions only after all call sites migrate.
- [ ] 4.2 **LEAD** Implement one shared human invalid-session signal consumed by real session resolution and real adapters: definitive `session_invalid` clears local credentials/resolved state and carries a sign-in reason; forbidden stays local; offline/timeout/server uncertainty preserves session and offers retry.
- [ ] 4.3 **LEAD** Repair activation/reset completion so it clears superseded local human state, signs in ordinarily, verifies the new session, refreshes the shared holder, and navigates only when that holder reflects it; post-redemption sign-in failure must direct to ordinary sign-in without stale shell UI.
- [ ] 4.4 **LEAD** Add focused unit/integration tests proving invalid protected actions sign out, forbidden actions do not, offline does not, deactivation keeps its reason, demo does not touch real Auth, and counter-device sessions retain their own lifecycle.
- [ ] 4.5 **TERRA-MEDIUM** Update typed demo fixtures and mock adapter behavior to the finalized lifecycle and assignment-set contracts without inventing states or changing production semantics; return discrepancies to the lead.

## 5. People task menu and progressive editor

- [ ] 5.1 **TERRA-HIGH/XHIGH** Against the finalized adapter contract, replace the People row menu with Edit, Change username, state-aware Set up account/Reset password, owner-only Change sign-in email where applicable, and Deactivate/Reactivate; remove New code and standalone assignment persistence actions.
- [ ] 5.2 **TERRA-HIGH/XHIGH** Build the responsive Edit form for personal facts plus one outlet/role in the common case, with a clearly labelled Works at multiple outlets disclosure and expanded outlet rows for zero, multiple, or mixed-role assignments.
- [ ] 5.3 **TERRA-HIGH/XHIGH** Offer exactly one role per outlet, exclude already-selected outlets, expose only caller-permitted choices, preserve assignment start dates, and keep owner access behind the separate lead-defined guarded subflow rather than an ordinary role selector.
- [ ] 5.4 **TERRA-HIGH/XHIGH** Add the separate destructive Mark as left control and confirmation inside Edit; prevent ordinary Save from submitting an empty assignment set or changing active state.
- [ ] 5.5 **TERRA-HIGH/XHIGH** Add focused component/browser tests for single versus expanded form, existing multi-outlet opening expanded, Staff ↔ Biller promotion, transfer, stale-edit refusal, FA choices, owner guarded flow, no default departure, phone/desktop layout, keyboard/accessibility behavior, and both themes.
- [ ] 5.6 **LEAD** Review the People UI against the authority/status matrix and integrate its entry-file changes; probe hand-crafted requests rather than treating hidden options as enforcement.

## 6. Purpose-aware handover and truthful status

- [ ] 6.1 **TERRA-HIGH** Extract one reusable handover component with purpose-specific presentation input, prominent semantic-token QR/copy hierarchy, highlighted username, compact one-use/expiry facts, relevant replacement/inactive warnings only, and accessible phone/desktop layouts in light and dark.
- [ ] 6.2 **TERRA-HIGH** Render truthful People states for Needs setup, Set-up link issued, Active, Active · password reset issued, Deactivated, and Not assigned using the adapter's derived lifecycle rather than invitation-row presence.
- [ ] 6.3 **TERRA-HIGH** Add component tests for activation versus reset wording, replacement wording, expired-link disappearance, active reset state, copy feedback, QR title, inactive behavior, text hierarchy, and no raw hex or contrast regression.
- [ ] 6.4 **LEAD** Integrate link issuance with the component, verify established reset links survive assignment edits while activation links replace, and personally review every security statement shown to the admin.

## 7. End-to-end proof and regression hardening

- [ ] 7.1 **LEAD** Add real-backend auth E2E scenarios for first activation, established password reset from an existing session, verified replacement session, invalid-session redirect, offline preservation, username correction with an open session, safe promotion, multi-outlet edit, guarded SA demotion, and Mark as left.
- [ ] 7.2 **LEAD** Prove the original regressions fail without their corresponding fixes and pass with them: revert each targeted fix in isolation and rerun its pinning test rather than relying on reasoning.
- [ ] 7.3 **LEAD** Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`; fix and rerun every failure.
- [ ] 7.4 **LEAD** Run `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`, `npm run db:types`, and the generated-type diff check; fix and rerun every failure.
- [ ] 7.5 **LEAD** Walk the People and activation/reset flows on phone and desktop/tablet viewports in light and dark, including narrow QR layout, long names/usernames, several assignment rows, keyboard operation, loading/error states, and demo mode.
- [ ] 7.6 **LEAD** Conduct a final adversarial review of tenancy, privilege escalation, final-owner safety, stale/racing edits, partial rollback, invite reuse/expiry, session invalidation, and transport uncertainty; implement and reverify every finding.

## 8. Durable documentation and backlog reconciliation

- [ ] 8.1 **TERRA-MEDIUM** Draft behavior-aligned updates to `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_AND_PRIVACY.md`, and `docs/TESTING.md`; make no new normative decision and return contradictions to the lead.
- [ ] 8.2 **LEAD** Review and finalize the docs so they state the authority matrix, atomic assignment editing, lifecycle/status meanings, reset/session behavior, and verification boundary in present tense.
- [ ] 8.3 **LEAD** Resolve the “Awaiting Activation Label Lies” and “Promoting a Staff Member Can Accidentally Lock Them Out” todo notes and index entries; retain unrelated counter-eligibility, self-service settings, email recovery, audit, and test-harness todos.
- [ ] 8.4 **LEAD** Run the living-spec and backlog-index checks plus `openspec validate account-lifecycle-truth-and-safe-transitions --strict`; confirm the change artifacts and implementation agree.

## 9. Phase gate

- [ ] 9.1 **PHASE GATE — account lifecycle truth and safe transitions**: Through the live UI, an authorized admin edits one person's facts and permitted outlet roles in one save; Employee ↔ Biller promotion, outlet transfer, multi-outlet editing, guarded administrator changes, and Mark as left preserve every authority and history invariant; first activation and established reset show truthful reusable handovers; username correction preserves open sessions; a reset enters with a verified replacement session; a confirmed invalid session returns to sign-in while offline uncertainty does not; FA/SA/self/final-owner hand-crafted requests are refused exactly at the server/database boundary; demo still walks; and the full local verification suite is green.
