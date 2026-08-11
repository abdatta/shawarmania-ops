## Context

`openspec/specs/README.md` is the entry point to the living contract, but it
currently links twelve of twenty-three capability directories. Eleven delivered
capabilities are absent, while its unlinked "Expected capabilities" line names
several contracts that have already landed under their final names.

The behaviour backlog already solved the same class of problem with a
bidirectional, read-only coverage checker. The living-spec variant differs in
what it indexes: one directory containing `spec.md` is one capability, and the
summary beside its link remains authored judgment.

## Goals / Non-Goals

**Goals:**

- Make the living-spec index a complete map of current capabilities.
- Fail both missing-directory links and links to directories that no longer
  exist.
- Run the invariant for application/tooling commits and prose-only archives.
- Keep capability descriptions authored and readable.

**Non-Goals:**

- Generate summaries, rewrite markdown, or edit living specifications.
- Preserve change-history grouping in a present-tense index.
- Duplicate roadmap forecasting or alter archive/sync behavior.
- Touch application runtime, database, RLS, money, offline behavior, gates, or
  demo mode.

## Decisions

### Use one alphabetical current-capability list

The reconciled index will list capabilities alphabetically, each with a direct
`<capability>/spec.md` link and a hand-authored one-line description. Historical
landing groups will be removed because archive folders own history and grouping
by old changes makes insertion ambiguous.

The rejected alternative is preserving or expanding historical groups. It reads
well only while the index is small and makes a present capability harder to find
without knowing when it landed.

### Check coverage in both directions without checking prose

A dedicated script will compare direct child directories containing `spec.md`
with capability links in the README. It reports:

- directories absent from the index;
- index links whose capability directory or `spec.md` is absent.

The checker will not compare wording or alphabetical order. Those are editorial
choices, while link coverage is mechanically knowable.

The rejected alternative is generating the whole index. A filename cannot yield
an accurate behavioral summary, and generated prose would either be empty or
silently misleading.

### Keep a separate checker with the same tested shape as the todo index

The new script may mirror the pure-function/CLI structure of
`check-todos-index.mjs`, but it will remain a separate command because its file
model and diagnostics differ. Prematurely generalizing both into a framework
would make two small invariants harder to read.

### Gate prose-only archives explicitly

`npm run lint` will include `lint:specs`, and `.github/workflows/docs.yml` will
run it beside formatting and the backlog check. This second wiring is essential:
an archive that adds a living spec and updates only markdown otherwise takes the
prose tier and would never execute full lint.

The rejected alternative is relying only on normal lint. It would disarm the
checker on the exact prose-only commit most likely to create the drift.

### Remove the future-capability forecast

The "Expected capabilities" section will be deleted. `ROADMAP.md` is already the
reconciled source for future work, while this README describes only what the
living specs require now.

## Risks / Trade-offs

- **A non-capability helper directory is mistaken for a capability** → count
  only direct child directories containing `spec.md`.
- **A prose link elsewhere in the README is mistaken for an index entry** →
  recognize only relative links whose target is `<name>/spec.md`.
- **A future archive adds executable OpenSpec tooling** → existing workflow path
  tier tests continue to keep executable files on the full suite; this change
  alters only the prose-tier commands.
- **Concurrent changes both modify `project-scaffold`** → keep this delta scoped
  to its new requirement plus the complete CI requirement, then use intelligent
  spec sync at archive.

## Migration Plan

Add the checker and its failing coverage tests first, reconcile the README until
the real-repository check passes, wire both verification tiers, and update their
documentation together. There is no deployment or data migration. Rollback
removes the checker/wiring and restores the previous README; no runtime state is
affected.

## Open Questions

None. `billing-live` is intentionally not listed before archive; once its new
`billing-delivery` living spec exists, this checker will require the same archive
to add it.
