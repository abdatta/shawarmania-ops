# Tasks

- [x] 1. Ask `useOutletScope` for the single-select mode in
  `src/features/counter/devices-surface.tsx`, keeping `openOn` so
  `devices/:outletId` still opens on the outlet its card named.
- [x] 2. Replace the 2026-08-09 decision comment above that call with the
  reasoning for the reversal, attributed and dated the same way.
- [x] 3. Remove the `<h2>` outlet name above an outlet's tablets, and update the
  grouping comment beneath it to say why the loop stays a loop. Leave the empty
  state's outlet name alone.
- [x] 4. Update `devices-surface.test.tsx`: the picker helper now chooses rather
  than adds, the removal helper goes, and the tests that stacked two outlets are
  rewritten to assert the same intent on one outlet — the outlet with no tablet
  names itself, a moved tablet leaves the list, and a late read of an earlier
  scope cannot publish over a newer one.
- [x] 5. Add tests for what this change decides: only the chosen outlet's tablets
  are listed, the outlet name is not printed as a heading, tapping the other
  outlet replaces rather than adds, and the outlet being read cannot be cleared.
- [x] 6. Check no other test, e2e spec or fixture depends on Tablets being
  multi-select.
- [x] 7. Update `docs/SCREENS.md`: the Tablets description and the outlet-switcher
  paragraph that names which screens read several outlets at once.
- [x] 8. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [x] 9. Run `npm run test:e2e` against the production build.
- [x] 10. Verify in the browser as the owner with two outlets, on a phone and a
  tablet viewport, in light and dark: the list, the absent heading, the replacing
  tap, the unclearable chip, the moved tablet leaving, and a two-outlet
  Attendance selection surviving a visit. Zero console errors.
- [x] 11. GATE — the proposal's Gate line is proved literally, clause by clause,
  naming what proved each. This change carries no ROADMAP.md row on purpose; do
  not run `roadmap:sync` expecting one, and do not archive automatically — report
  to the owner first.
