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
- [x] 5. Apply the shared current-year date shortening rule to Recent Counts,
      Billing history, My shift and the existing operational timestamp callers;
      update both capability contracts and screen documentation, and cover the
      rule in shared and representative Billing tests.
- [x] 6. Redesign the expanded card body as a compact contextual fact panel,
      add coverage for its non-repeating information hierarchy, and verify the
      expanded state in both themes and phone/tablet layouts.
- [x] 7. Add demo fixtures for an in-place fix and an anchored adjustment,
      show the adjustment's corrected amount in the expanded card without
      repeating the closed summary, mirror the live `corrected_by` invariant,
      and verify both paths.
- [x] 8. Add the product-visible correction to the roadmap as #49, Wave E,
      dependent on the live cash drawer delivered by #11.
- [x] 9. PHASE GATE: recent counts are scannable in closed and expanded states
      on phone and tablet viewports in light and dark themes, the focused drawer
      and Billing date tests pass, and the applicable lint, format, typecheck,
      test, contrast, build and end-to-end checks are green.
