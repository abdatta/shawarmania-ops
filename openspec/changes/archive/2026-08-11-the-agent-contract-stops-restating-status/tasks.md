# Tasks: The Agent Contract Stops Restating Status

## 1. Establish what is actually true

- [x] 1.1 Read the live/demo/hidden state of every surface from `src/gates/registry.ts`, which is the authority, rather than inferring it from change names.
- [x] 1.2 Confirm against the archive which changes have landed, and confirm `docs/LIMITATIONS.md` no longer carries the Biller-password caveat `AGENTS.md` cites.

## 2. Correct the two stale sentences

- [x] 2.1 Rewrite the status paragraph so it makes no per-surface claim, keeping the delivery model and pointing at `ROADMAP.md` and the gate registry.
- [x] 2.2 Drop "Not built" and the dangling Limitations reference from the counter tablet entry, leaving its rules intact.
- [x] 2.3 Drop the "**Built.**" annotation from the personal-accounts entry, since it carries the same drift.
- [x] 2.4 Verify no other sentence in the file claims build status.

## 3. Close the backlog note

- [x] 3.1 Delete `openspec/todos/agent-contract-describes-built-features-as-unbuilt.md`.
- [x] 3.2 Remove its row from `openspec/todos/README.md`, which `lint:todos` requires in the same commit.

## 4. Verification

- [x] 4.1 `npm run lint` and `npm run format:check` clean, with `lint:todos` proving the index and the directory agree.
- [x] 4.2 Re-read the file end to end and confirm every durable rule survives: tenancy, money as paise, the two device contexts, the three authentication rules, the quickfix lane.
- [x] 4.3 Confirm no link in the file is dangling.
