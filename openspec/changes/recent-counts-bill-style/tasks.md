# Tasks

- [x] 1. Add focused component assertions proving each closed Recent counts row
      visibly labels Counted, Collected and Left, places the existing verdict
      chip with Counted, derives Left from the observation's own movement, and
      owns its own card below the standalone section heading.
- [x] 2. Update `ObservationRow` in
      `src/features/cash/cash-drawer-surface.tsx` to use the Billing-history
      summary hierarchy while preserving the disclosure, accessible name,
      detail and correction behavior.
- [x] 3. Reshape the drawer loading placeholder for the new recent-count row
      silhouette using existing loading primitives and semantic tokens.
- [x] 4. Update `docs/SCREENS.md` with the final Recent counts hierarchy.
- [x] 5. PHASE GATE: recent counts are scannable on phone and tablet viewports in
      light and dark themes, the focused drawer tests pass, and the applicable
      lint, format, typecheck, test, contrast, build and end-to-end checks are
      green.
- [x] 6. Apply the current-year date shortening rule to Recent Counts and cover
      current-year and older-year output in the shared date-format tests.
- [x] 7. Redesign the expanded card body as a compact contextual fact panel,
      add coverage for its non-repeating information hierarchy, and verify the
      expanded state in both themes and phone/tablet layouts.
- [x] 8. Add demo fixtures for an in-place fix and an anchored adjustment,
      show the adjustment's corrected amount in the expanded card without
      repeating the closed summary, and verify both paths.
