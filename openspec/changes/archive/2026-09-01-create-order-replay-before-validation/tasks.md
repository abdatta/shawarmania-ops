## 1. Reproduce the lost acknowledgement

- [x] 1.1 Add a pgTAP regression that submits one create-order envelope twice after the first commit and verify it fails on the current function with `arithmetic_invalid` instead of `replay`.
- [x] 1.2 Extend the regression to assert one order, one original line set, one consumed order number, the original identifiers, and the immediate next number for a distinct command.

## 2. Restore exact replay

- [x] 2.1 Add a forward migration that checks an existing create-order receipt after historical scope resolution and before content validation, and verify exact identity returns replay while changed identity returns conflict.
- [x] 2.2 Preserve the original first-submission validation, receipt privacy, transaction claim, RLS, integer-paise arithmetic, and number allocation paths; verify the complete billing database contract passes after reset.
- [x] 2.3 Prove a durable create-order envelope retained after a lost response resolves on replay without entering needs attention, using the outbox delivery test path.

## 3. Durable explanation

- [x] 3.1 Update `docs/OFFLINE_AND_SYNC.md` with the receipt-before-stateful-validation invariant and verify the prose describes exact replay without payload retention.
- [x] 3.2 Update `docs/TESTING.md` with the create-order lost-acknowledgement regression and verify the documented gate matches CI.
- [x] 3.3 Run `npm run roadmap:sync` and verify the generated roadmap status is reconciled rather than hand-edited.

## 4. Verification

- [x] 4.1 Reset the local database and pass `test:db`, `test:rls`, `test:e2e:auth`, regenerated-type parity, and a direct create-order response-loss replay proof.
- [x] 4.2 Pass `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [x] 4.3 **PHASE GATE — production replay repair:** prove an accepted create-order response can be lost and retried with the identical envelope, yielding `replay`, one order and line set, no second number, and no `arithmetic_invalid` or needs-attention state.
