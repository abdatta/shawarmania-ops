# Proposal: Keep The Living-Spec Index In Sync

> **Kind**: OpenSpec process correction and tooling, not a roadmap change · **Gate**: `openspec/specs/README.md` links every and only current capability directory, names no delivered capability as future work, and both full lint and the prose-only workflow fail with the exact missing or dangling capability when the index drifts.

## Why

The living-spec index lists only twelve of twenty-three current capabilities and
still presents several delivered contracts as future work. Because the index is
maintained by hand and no check compares it with the directory, every archive
can silently make the repository's main contract map less trustworthy.

## What Changes

- Reconcile the living-spec index with every current capability and replace its
  historical landing groups with a stable, readable current-capability list.
- Remove the duplicated "Expected capabilities" forecast; the reconciled
  roadmap already owns future sequencing.
- Add a read-only bidirectional checker: a capability directory without an index
  link and an index link without a capability directory both fail with the exact
  name.
- Wire the checker into normal lint and the prose-only workflow, because adding
  or removing a living spec can be a prose-only archive change.
- Keep summaries hand-authored and test the checker independently; tooling
  verifies coverage but does not invent, reorder, or rewrite descriptions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: require the living-spec index to cover every and only
  current capability, enforced in both full lint and the prose-only verification
  tier.

## Impact

- `openspec/specs/README.md`, a new checker and unit test under `scripts/`, npm
  lint scripts, and `.github/workflows/docs.yml` change.
- `docs/TESTING.md` and `AGENTS.md` gain the fourth repository-invariant check so
  the documented suite continues to mirror CI.
- Future archives that add or remove a capability must update the index in the
  same change, including `billing-live` when it creates `billing-delivery`.
- No roadmap row, application code, build output, schema, policy, runtime data,
  feature gate, or demo seam changes.

## Non-goals

- Generating capability summaries or changing the content of any living spec.
- Keeping historical grouping in the current index; archive folders already own
  change history.
- Replacing the roadmap with a second forecast inside the specs index.
- Automatically modifying markdown during lint or archive.

## Docs to update before archiving

- `docs/TESTING.md` — document the living-spec index invariant and its coverage
  in both verification tiers.
