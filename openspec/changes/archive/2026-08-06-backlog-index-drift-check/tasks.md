## 1. Catch the drift

- [x] 1.1 Add `scripts/check-todos-index.mjs`: a pure `findIndexDrift({ files, indexMarkdown })` returning both drift directions, plus the CLI entry guard the other check scripts use, with the reason the check exists recorded in the header.
- [x] 1.2 Prove it against the tree before anything is filed: it must exit non-zero naming `page-headers-reserve-their-own-space.md` and nothing else, so the 20 listed notes and the graduated links are confirmed as not false positives.
- [x] 1.3 Wire it into `npm run lint` as `lint:todos`, following the `lint:tokens` pattern, so CI gates it through the Lint step that already exists.

## 2. Pin it

- [x] 2.1 Add `scripts/check-todos-index.test.mjs` covering an unlisted note, a dangling row, an index in sync, and a note reached only from the "Graduated / Absorbed" table. Two cases added beyond the plan while writing them: a link carrying an `#anchor` alongside links out to `../../docs/` and `../changes/`, which the real index contains and a looser pattern would have read as notes; and a non-`.md` file in the folder.
- [x] 2.2 Prove the test fails without the rule by reverting it, not by reasoning about it. With the comparison replaced by an empty result, both drift cases failed and the CLI reported the tree "in sync" while the orphan was still unlisted.
- [x] 2.3 Unplanned, found by the first test run: the script resolved its directory at module load, which the test runner cannot import — it rewrites `import.meta.url` to something `fileURLToPath` rejects. Path resolution moved inside the CLI entry, which is where it belonged anyway.

## 3. File the note the drift hid

- [x] 3.1 Add the `page-headers-reserve-their-own-space.md` row to the Items table with its Type, Status, Area and a trigger to promote.

## 4. Record the rule

- [x] 4.1 `docs/TESTING.md`: `npm run lint` gates the backlog index, why an unlisted note is lost rather than deferred, and the module-load rule 2.3 turned up for check scripts under `scripts/`.

## 5. PHASE GATE

- [x] 5.1 **Gate**: `npm run lint` fails, naming the file, on a tree where a note is absent from the index; fails equally when a row points at a note that is gone; and passes on the tree with the one unlisted note filed. Ran `npm run lint` (0 errors; the 2 remaining warnings are pre-existing `react-refresh` ones in `src/features/`), `npm run typecheck`, `npx vitest run scripts/check-todos-index.test.mjs` (6 passed), `npm run format:check`. The two failing directions were proved by reverting the rule rather than by argument.
