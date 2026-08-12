## 1. Database transition clock

- [x] 1.1 Add a forward migration that pins both atomic account-transition functions to Asia/Kolkata per invocation without changing bodies, signatures, grants, locks, or authority guards.
- [x] 1.2 Add deterministic pgTAP coverage for assignment-set editing and Mark as left during the Kolkata/UTC date gap, including valid history dates and atomic account state.

## 2. Durable documentation

- [x] 2.1 Update `docs/DATA_MODEL.md` and `docs/ROLES_AND_PERMISSIONS.md` to state that assignment transition dates use the Kolkata calendar.
- [x] 2.2 Reconcile the roadmap and strictly validate the OpenSpec change.

## 3. Verification and deployment gate

- [x] 3.1 Run the complete non-Docker suite: lint, format check, typecheck, unit/component tests, contrast, build, and browser E2E.
- [x] 3.2 Start and reset the local stack; run database, RLS/REST, and real-backend auth E2E suites; regenerate database types and prove no type drift.
- [x] 3.3 Prove the regression fails without the transition-clock fix and passes with it.
- [ ] 3.4 **PHASE GATE — account-transitions-use-business-time**: Both account transitions succeed in the Kolkata/UTC calendar gap, all assignment dates remain valid, authority and history invariants remain intact, every local CI gate is green, and production Deploy completes successfully.
