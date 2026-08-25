## 1. Repair the two boundaries

- [x] 1.1 Read enabled restaurant mappings through their `state` column so the
  shared statement parser accepts both scheduled and manual Hyperpure files and
  the Swiggy Read now guard can dispatch a configured outlet.
- [x] 1.2 Add a Hyperpure-only, outlet-allowlisted run-record action to the
  secret-scoped reader bridge; retain the existing settlement-channel refusal.
- [x] 1.3 Route the private reader's Hyperpure outcomes to the new action.

## 2. Verify and hand off

- [x] 2.1 Add a regression test for every mapping query and for the private
  reader's health endpoint/action contract.
- [x] 2.2 Run focused Ops and sync tests, then the relevant type/format checks.
- [x] 2.3 Close the resolved GitHub failure reports, leaving any undeployed
  repair open until production evidence exists.

## 3. Prevent restaurant-mapping schema drift

- [x] 3.1 Record the `state` / `enabled` mapping contract in the living spec and
  data-model documentation.
- [x] 3.2 Route every Edge Function restaurant-mapping query through one typed
  shared helper and pin the no-bypass rule with a source-contract test.
- [x] 3.3 Add a Deno generated-schema check for that helper to the verify
  workflow and the documented local suite.
- [x] 3.4 Run the full relevant suite and record the evidence.
