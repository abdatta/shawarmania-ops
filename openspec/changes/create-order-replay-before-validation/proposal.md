# Create-order replay precedes stateful validation

> **Model**: GPT-5.6 Sol · **Kind**: production billing bug fix, not a roadmap change · **Gate**: **after the server commits a create-order command and its response is lost, retrying the identical envelope returns `replay`, creates no second order or line, consumes no second order number, and never becomes `arithmetic_invalid` or needs attention**.

## Why

On 2026-08-31 Kanchrapara order 8 committed while its acknowledgement was lost. The exact retry revalidated the now-existing line identities before consulting the command receipt, misclassified the accepted command as `arithmetic_invalid`, and left the tablet asking an operator to discard work that had already succeeded.

## What Changes

- Resolve an existing command receipt before create-order validation that depends on mutable database state.
- Preserve the current identity-conflict result when a UUID is reused with a different type, version, or canonical payload hash.
- Add a database regression that loses the first create-order response, retries the identical envelope, and proves one order, one set of lines, one number allocation, and the original replay result.
- Exercise the counter outbox against the regression so a replay resolves locally rather than becoming needs attention.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This restores the existing exact-replay requirements in `billing-command-contract` and `billing-delivery`; it does not change their contract. The change therefore opts out of delta specs with `skip_specs: true`.

## Impact

- A forward Supabase migration will replace the create-order command function or its receipt preflight helper without changing tables, policies, payloads, or accepted-response shapes.
- Database billing-contract tests and the durable-delivery regression cover the production failure.
- `docs/OFFLINE_AND_SYNC.md` will state that replay lookup precedes validation whose answer can change after the first commit; `docs/TESTING.md` will name the lost-acknowledgement create-order regression.

## Non-goals

- No automatic content-based deduplication of two distinct order UUIDs; separate operator submissions remain separate orders.
- No repair or deletion of historical orders, bills, diagnostics, or tablet tombstones.
- No UI, outbox schema, feature-gate, RLS, numbering, or payment-flow redesign.
