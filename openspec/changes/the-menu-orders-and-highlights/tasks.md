# Tasks: the-menu-orders-and-highlights

## 1. UI against the mock only

- [x] 1.1 Add the typed presentation adapter and per-outlet demo configuration; implement deterministic category item reorder and validated highlight writes in the mock only. Add mock tests, including read-only refusals, duplicates, wrong-outlet items, tied positions and removed selections.
- [x] 1.2 Build item Move up/down actions, the top highlights card, Edit highlights sheet (name, search, grouped choices, independent ordering, remove, Save/Cancel). Use the existing Share action for the public menu. Keep live controls absent with a demo part gate; reshape shimmer and clear state on outlet changes.
- [x] 1.3 Add component and browser checks for ordering, title/selection edits, Cancel, empty selection, availability, removal and switching outlets. Update the demo walkthrough.
- [x] 1.4 SECTION GATE: format before verification; lint, format:check, typecheck, functions:typecheck, unit tests, contrast, build, demo e2e; inspect phone and tablet in both themes and confirm no real requests. Evidence: `verification.md`.

## 2. Owner checkpoint — approved 2026-10-07

- [x] 2.1 Present the working demo and complete the owner's requested UI iterations, including compact highlights and settings.
- [x] 2.2 Record the owner's explicit 2026-10-07 approval (“amazing all lgtm”) and settled choices in design; reconcile proposal, deltas, main capability specs and verification before live work continues. Approval authorises the next stage without completing it.
- [x] 2.3 Complete item symbols, opaque unavailable actions and compact editor/card copy; move presets into Orders as inline Bill discount shortcuts. One through four shortcuts fill one equal-width row; sibling cards have independent plain Save/Cancel and matching saved glow respecting reduced motion. Preserve existing preset behavior/scoping, verify both surfaces and leave the category discount redesign deferred. Evidence: `verification.md`.

## 3. Persistence and live integration — implemented and verified 2026-10-07

- [x] 3.1 Add failing database and REST tests for atomic reorder (including ties and stale membership), highlights persistence and validation, and isolation/read-only refusal for every new outlet-scoped table and command.
- [x] 3.2 Implement migrations, same-outlet validation and RLS, then regenerate schema types from a fresh reset; inspect generated parity and type the fixtures from the actual schema.
- [x] 3.3 Implement the live presentation adapter and promote the part gate only after round-trip evidence. Keep the settled UI and demo behavior.
- [x] 3.4 Prepend highlights in public_menu without changing its public JSON field allowlist or service-role-only privilege. Prove removed/empty omission, unavailable flags, exact field projection and item order, including the actual website Worker renderer with duplicate section names.
- [x] 3.5 Update SCREENS, DATA_MODEL, OPERATIONS and TESTING; rerun full local gates including db:start, db:reset, test:db, test:rls, test:e2e:auth and generated types parity, with phone/tablet and both themes.
- [x] 3.6 PHASE GATE (#68, Wave F): authorised managers round-trip order and highlights; another outlet is refused; the public menu shows highlights first and category item order within a minute without a website deploy; demo still walks. Report any external verification honestly. Do not archive or publish without the owner's request.
