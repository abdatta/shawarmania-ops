# Proposal: food-first-e2e-race

> **Model**: Opus · **Kind**: test-only fix, not a roadmap change · **Gate**: `npx playwright test e2e/counter.spec.ts:216 --repeat-each 8` passes 16 of 16, and the full `npm run test:e2e` is green.

## Why

The e2e test *the counter › saves and records a food-first order from the
persistent rail* asserted on the order's unsent card while the demo was free to
deliver it. Delivery changes the card's identity — `open-order-local-*` becomes
`open-order-<number>` — so on a slower machine the later assertions found
nothing. It failed 8 of 16 runs at `e6bc1ff`, before #60, and 9 of 16 after it,
on the same machine: a race in the test, not a fault in the counter.

## What Changes

- The test drops the demo network before tapping Order, so every assertion
  about the unsent card, and ticking Prepared, runs while delivery is held.
- It then brings the network back and asserts the card is delivered and
  numbered, with its total and the preparation recorded offline, before paying
  on the numbered card. That last step is new coverage: the old test never
  asserted that the number arrived.

## Non-goals

- No change to the counter, the mock adapter or its delivery latency.
- No spec delta: no requirement changes.
