---
name: openspec-sync-specs
description: Intelligently merge an active OpenSpec change's delta specifications into the repository's main capability specs without archiving the change. Use when the user asks to sync, merge, or apply delta specs to main specs, or when the archive workflow requests a spec sync.
---

# Sync OpenSpec Delta Specs

Merge delta intent into main specifications while preserving all unaffected
requirements and scenarios. Make the operation idempotent.

## Select and Resolve

Use the supplied change name. If it is missing or ambiguous:

1. Run `openspec list --json`.
2. Show only active changes with delta specs.
3. Ask the user one concise selection question.

Run:

```bash
openspec status --change "<name>" --json
```

If `actionContext.mode` is `workspace-planning`, stop. Do not fall back to
guessed repo paths or edit linked repositories.

Use `artifactPaths.specs.existingOutputPaths` as the delta list. If it is
empty, report that and stop.

## Merge Each Capability

For every delta:

1. Read the entire delta.
2. Resolve its capability and read
   `openspec/specs/<capability>/spec.md` when it exists.
3. Apply sections intelligently:
   - `ADDED`: add a missing requirement; if already present, reconcile it as
     an implicit modification.
   - `MODIFIED`: change only the described requirement text or scenarios and
     preserve unmentioned content.
   - `REMOVED`: remove the complete named requirement block.
   - `RENAMED`: rename the exact `FROM` requirement to `TO`.
4. If the main capability does not exist, create it with a concise Purpose and
   Requirements section containing the added requirements.
5. Re-read the result against the delta and confirm no unrelated specification
   content changed.

Never replace an entire main requirement merely because a delta adds one
scenario. The delta expresses intent, not wholesale replacement.

## Finish

Report each capability and every requirement added, modified, removed, or
renamed. State that the change remains active and recommend
`$openspec-archive-change <name>` only when implementation and verification are
complete.

## Guardrails

- Read both delta and main spec before editing.
- Preserve all content the delta does not address.
- Ask when intent is genuinely ambiguous.
- Keep repeated runs idempotent.
- Do not archive as part of this skill.
