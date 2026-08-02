## 1. Production release ordering

- [x] 1.1 Add a production migration job after shared verification.
- [x] 1.2 Make Pages publication depend on migration success.
- [x] 1.3 Keep manual frontend rollback from reversing migration history.
- [x] 1.4 Scope the database credential to a production environment secret.

## 2. Durable contract and operations

- [x] 2.1 Update the deployment capability contract.
- [x] 2.2 Update operations, testing and agent verification guidance.
- [x] 2.3 Exclude tool-managed nested worktrees from local verification scans.

## 3. Verification

- [x] 3.1 Validate workflow syntax, formatting and OpenSpec artifacts.
- [x] 3.2 Prove the exact CI credential sees the current production schema as a no-op.
