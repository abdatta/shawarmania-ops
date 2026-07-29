## 1. Transactional assignment and invite contract

- [x] 1.1 Add a migration exposing service-role-only assignment grant/end RPCs that serialize per person, preserve the reassignment trigger, and conditionally issue a replacement invite in the same transaction.
- [x] 1.2 Add pgTAP coverage for RPC execute privileges, grant/end replacement behavior, no unsolicited code without an outstanding invite, and rollback when replacement issuance fails.
- [x] 1.3 Regenerate the Supabase TypeScript declarations and prove they match a freshly reset local database.

## 2. Privileged account flow

- [x] 2.1 Generalize `mayProvision` and the `provision` Edge action to validate a distinct `outletIds` set from the caller's verified assignments before creating anything.
- [x] 2.2 Insert every requested assignment before issuing one activation code, retaining auth-user cleanup for profile, assignment, or invite failure.
- [x] 2.3 Route assignment grant/end through the transactional RPC and return an optional one-time code only when an outstanding invite was replaced.
- [x] 2.4 Extend REST/RLS account-flow coverage for real two-outlet creation and activation, hand-crafted cross-outlet refusal with no residual account, visible grant/end reissue, and the no-pending-invite path.

## 3. Adapter seam and demo behavior

- [x] 3.1 Change `NewAccount` to one role plus `outletIds`, and make assignment grant/end return `IssuedCode | null` across the typed adapter seam.
- [x] 3.2 Update the Supabase adapter request/response mapping for multi-outlet provision and optional assignment-change codes.
- [x] 3.3 Update the mock adapter to create every assignment before one code and to replace pending invites after grant/end with the same return shape as production.

## 4. People surface

- [x] 4.1 Derive provisionable outlets from the caller's live management authority and add the accessible phone-sized checkbox group for callers with more than one option.
- [x] 4.2 Preserve the preselected singular disabled outlet control for a Franchise Admin managing exactly one outlet, reject an empty scoped selection, and submit an empty outlet set only for Super Admin.
- [x] 4.3 Show the existing issued-code panel after a grant or end that replaces a pending invite, correct lifecycle copy, and warn when the account was also deactivated.
- [x] 4.4 Expand People component tests for multi-outlet creation, unchanged one-outlet management, authority-filtered options, all demo assignments, and visible grant/end replacement codes.

## 5. Browser flows and durable documentation

- [x] 5.1 Extend authenticated Playwright coverage so an owner creates a two-outlet person in one action, hands over one code, and that person activates; retain the hand-crafted manager authority proof.
- [x] 5.2 Update the four-role demo walkthrough assertions for the multi-outlet control and confirm demo mode performs no real-data write.
- [x] 5.3 Update `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OPERATIONS.md`, and any applicable limitation text to describe the completed onboarding and replacement-code behavior.

## 6. Verification and phase gate

- [x] 6.1 Run lint, format check, typecheck, unit/component tests, contrast, build, normal Playwright, fresh database reset, pgTAP, RLS/REST, authenticated Playwright, and generated-types diff; fix and rerun until green.
- [x] 6.2 Inspect the People flow on phone and tablet viewports in light and dark themes, including console/network state, the one-outlet manager form, the two-outlet owner form, assignment-code replacement, and permanent demo behavior.
- [x] 6.3 Run `npm run roadmap:sync` and prove the PHASE GATE from ROADMAP #23: one two-outlet hire, one working code issued after all assignments; visible grant/end reissue; unchanged one-outlet Franchise Admin form; hand-crafted out-of-authority refusal; and the four-role demo walkthrough still walks.
