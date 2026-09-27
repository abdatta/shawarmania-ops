# Tasks: people-is-called-team

## 1. Pin it

- [x] 1.1 Tests that fail today: the owner's and a Franchise Admin's Setup entry
  reads Team and points at `team` (`registry.test.ts`); the e2e walks open
  `/owner/team` and `/admin/team` and find the Team heading.

## 2. The app (design D1, D2)

- [x] 2.1 `gates/registry.ts`: `owner-team` and `admin-team`, `path: 'team'`,
  label Team; comments that name the screen.
- [x] 2.2 `routes/surfaces.tsx`: the surface at `team`; no `people` route (design D1).
- [x] 2.3 `accounts-surface.tsx`: title Team, subtitle and loading copy that
  name the screen; `outlet-attendance.tsx` empty states.
- [x] 2.4 Comments and test names across `src/` that name the screen; tests and
  e2e paths from `people` to `team`.

## 3. Docs and specs

- [x] 3.1 Every `docs/` page in the proposal, occurrence by occurrence.
- [x] 3.2 Open todos and active changes that name the screen
  (`navigation-outgrows-a-flat-list`, `self-service-account-settings`,
  `a-gold-member-is-a-label`).

## 4. Gate

- [x] 4.1 `format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`,
  `test:e2e:auth`.
  *Done:* unit 1936/1936; `test:e2e` 283/284 with the tablet counter spec
  waiting on a sync badge — 70/70 on rerun, untouched by this change;
  `test:e2e:auth` 31/31.
- [x] 4.2 Browser: demo owner and manager, the new address, the nav entry, phone
  and desktop.
  *Done at phone width:* owner and manager both titled Team, the Setup tab reads
  Team, no "People" anywhere on either page; `/demo/owner/people` shows the
  ordinary not-found. A redirect was built, e2e-tested and removed on the
  owner's word (design D1).
- [x] 4.3 Final search for `\bPeople\b` outside archives: only the kept uses —
  ordinary English (`mock/attendance.ts` "People are accounts", `adapters.ts`
  "People the caller may see", `11_outlet_deletion.sql`), the expenses adapter's
  internal `People` type, history (`ROADMAP.md` rows, `todos/README.md`, the
  quoted old navigation in `navigation-outgrows-a-flat-list`), the
  `people-shows-names-first` folder, and this folder.
  *Done:* exactly those, plus the outlets screen's deletion refusal counting
  "people — N" (ordinary English), and the living specs, which this folder's
  delta renames when it archives.
- [x] 4.4 GATE — the Gate line clause by clause. Archive
  `people-shows-names-first` before this change. Commit locally; the owner picks
  the push.
  *Proved on production 2026-09-27* (8293a0c): `/owner/team` titled Team with
  the Setup tab reading Team, in the owner's browser. The first load after the
  deploy served the cached previous build, which answered `/team` with
  not-found; its own update adoption replaced it on the next load. Archive
  after `people-shows-names-first`.
