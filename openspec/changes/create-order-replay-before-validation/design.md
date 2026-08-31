# Design: Create-order replay precedes stateful validation

## Context

See `proposal.md` for the production incident. `create_billing_order` currently validates line identities against `order_items` and the live menu before it calls `billing_begin_command`. That validation is correct for a first submission, but it is necessarily false after the same command has already inserted those line identities: create validation receives no owning order id, so an existing line id is treated as a collision. The compact `billing_commands` receipt already holds every fact needed to distinguish exact replay from identity conflict without retaining customer or line payloads.

The fix is on the offline money path. It must preserve integer-paise arithmetic, historical shift/outlet authority, command identity, order numbering, receipt privacy, and the rule that a new invalid command leaves no order or consumed number. It changes no RLS policy.

## Goals / Non-Goals

**Goals:**

- Return the stored result as `replay` before any validation whose answer changed because the original command committed.
- Preserve the full identity comparison: UUID, type, schema version, canonical hash, creation time, outlet, device, shift, and actor.
- Keep the existing insert-side claim as the concurrency boundary when two first submissions race.
- Prove the response-loss path at the database boundary and through the durable outbox.

**Non-Goals:**

- Do not make two distinct UUIDs with identical order contents the same command.
- Do not relax first-submission menu, line, total, business-date, or authority validation.
- Do not add a table, policy, outbox state, or payload-retention mechanism.

## Decisions

### D1 — Read an existing receipt after scope resolution and before content validation

`create_billing_order` will perform the existing envelope-shape/hash check and historical device-context resolution first. It will then read `billing_commands` by command UUID. If a row exists, it will compare the same identity fields as `billing_begin_command`; a mismatch returns `identity_conflict`, an accepted match returns the stored result with status `replay`, and any other completed match returns its stored result.

This lookup precedes total and line validation. Exact replay must be decided from the immutable receipt, not from menu or line state produced by the accepted command. A changed payload with a newly correct canonical hash must likewise reach `identity_conflict` before its different arithmetic can mask the UUID reuse.

The historical device-context check remains before replay, preserving the existing authority and removed-tablet behaviour rather than turning a receipt into a public lookup.

**Rejected:** pass the existing order id to `billing_validate_lines`. That would make this one replay pass, but it would still validate against mutable state before proving identity and could return a different refusal after later menu/schema changes.

**Rejected:** move `billing_begin_command` before validation. A new invalid command would then create a receipt before its content was accepted, widening the change and conflicting with the atomic-validation contract.

### D2 — Keep `billing_begin_command` after validation for the not-yet-seen path

The early read is an optimization/correctness path for an existing UUID, not the concurrency claim. A command absent during the early read still runs all existing validation and then calls `billing_begin_command`. If another request commits between those points, that function's unique insert and identity comparison returns replay or conflict exactly as today.

**Rejected:** replace `billing_begin_command` globally with a new helper. The defect is confined to create-order's pre-claim stateful validation; changing every billing command would increase migration and regression risk without helping this incident.

### D3 — Pin the exact production topology

The database test will submit one valid create command, capture its accepted order and number, then submit the identical envelope again after its line rows exist. It will require `replay`, the original identifiers, one order, the original line count, and no increment beyond the one allocated number. A distinct subsequent command will receive the immediate next number, proving the replay burned none.

The delivery test will retain an envelope after simulating a lost accepted response, execute the identical retry against the fixed database contract, and require the local envelope to resolve rather than enter needs attention. This is the offline guarantee the user experienced, not merely a direct function assertion.

## Risks / Trade-offs

- **[Receipt lookup and initial submission race]** → `billing_begin_command` remains the authoritative unique claim after validation and rechecks identity.
- **[Replay could expose a receipt outside its scope]** → the existing historical device-context resolution runs first and the receipt comparison includes outlet, device, shift, and actor.
- **[Changed UUID payload could bypass validation]** → canonical hash and every envelope identity field must match before replay; otherwise the function returns `identity_conflict` without reading customer or line contents from the receipt.
- **[Forward migration cannot be rolled back safely after production advances]** → the migration only `create or replace`s one function; rollback is a subsequent forward migration restoring the prior body, while retained receipts and order data remain schema-compatible.

## Migration Plan

1. Add the failing pgTAP replay regression against the current function.
2. Add one forward migration replacing `create_billing_order` with the receipt preflight while retaining its signature and accepted/refused result vocabulary.
3. Reset the local database, run billing, RLS, authenticated E2E, generated-type parity, and the full repository suite.
4. Deploy through the normal gated migration path. Existing accepted receipts need no backfill; their next exact retry immediately benefits.

Rollback, if required, is another forward `create or replace` migration. No table or data rollback is involved.
