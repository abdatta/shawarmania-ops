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
