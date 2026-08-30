# Tasks

- [x] Export the refused diagnostics and their count from
      `src/features/billing/manager-sync-status.tsx`, over the predicate already
      there, and render the panel's list from the same function.
- [x] Carry the count on the Status tab in
      `src/features/billing/manager-billing-history.tsx`, only when non-zero.
- [x] Match the tab by prefix in the two existing status tests.
- [x] Gate: `npm run typecheck`, `npm run format:check`, and
      `src/features/billing/manager-billing-history.test.tsx` green, with the
      three new assertions proved to fail on the tree before the fix.
