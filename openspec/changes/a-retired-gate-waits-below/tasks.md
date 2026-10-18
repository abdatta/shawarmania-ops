# Tasks: a-retired-gate-waits-below

No gate (proposal, *Change gate*), no migration.

## 1. The page

- [x] 1.1 `ChangeGatesSurface` splits the loaded gates by `RETIRED_CHANGE_GATES`:
  gates in use on top, as today; the retired ones under a **Retired · waiting for
  cleanup** heading and nothing more (owner, 2026-10-18: no subtitle), each
  section in dependency order, absent when empty.
- [x] 1.2 `GateTable` draws a retired row muted, as plain text with no link and an
  invisible chevron; Status and the chevron column take `DataTable`'s new optional
  `shrink`, so the two tables line up (design D4).
- [x] 1.3 `ChangeGatePage` for a retired key shows **Retired · waiting for cleanup**
  under its state in place of the switch, mounts no confirmation, and draws its
  dependency rows as rows that do not open.

## 2. Tests

- [x] 2.1 `change-gates-surface.test.tsx`: with an overview that includes retired
  rows, they sit in the retired section after every gate in use, with no link and
  their state; with none, the section is absent; a retired gate's page has no
  switch and reads the retired line. The two new cases fail against the page
  before this change.

## 3. Docs

- [x] 3.1 `docs/SCREENS.md`, the Change gates and gate page entries.
- [x] 3.2 `docs/RELEASES.md`, what the owner sees between the two halves of a
  retirement.

## 4. PHASE GATE

- [x] 4.1 No roadmap checkpoint (owner-screen correction, no row). The quick
  gates are green (`format`, `lint`, `format:check`, `typecheck`,
  `functions:typecheck`, `test`, `contrast`, `build`). The page was checked against
  the local backend, whose rows match production (DT, KR, OT, IS live and on), on
  phone and tablet, in light and dark. The browser suites run on the `stage` push.
