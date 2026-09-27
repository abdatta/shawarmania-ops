# Proposal: text-stays-clean-utf-8

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change ·
> **Gate**: the Team form's username hint reads *3 to 30* with a real en dash
> again; no tracked text file carries a byte-order mark or mojibake; and
> `npm run lint` and the prose-tier workflow both fail on either, proved by the
> check failing on the tree before the fix and passing after.

## Why

The Add person form on Team shows its username hint with three characters of
noise where an en dash belongs. It is the second time this kind of fault has
reached a screen: `duplicate-row-mojibake` fixed the delivery row's middle dot on
2026-08-31, and AGENTS.md has stated the rule (UTF-8, no BOM) ever since. A rule
nothing checks came back, and a scan of every tracked file found it in five
places, each where a commit had rewritten a file through a tool that read its
UTF-8 as Windows-1252:

| Where | Seen as | Introduced by |
|---|---|---|
| `src/features/accounts/accounts-surface.tsx`, the username hint (on screen) | en dash | `f7cbf90`, 2026-08-13 |
| `src/features/aggregator-sync/sync-event-row.tsx`, a comment | em dash | `258644d`, 2026-08-24 |
| `src/outbox/drain.ts`, a comment | em dash | `9bb64c6`, 2026-08-11 |
| `openspec/specs/menu-management/spec.md`, five lines | em dash | `4988c51`, 2026-08-12 |
| `openspec/specs/aggregator-settlement-sync/spec.md`, two lines | em dash | `2b9b799`, 2026-08-24 |

## What changes

- Each broken sequence is restored to the character it was, decoded back through
  Windows-1252. The hint reads *3–30* again, as it did before `f7cbf90`.
- **`npm run lint:encoding`** (`scripts/check-encoding.mjs`) fails when any
  tracked text file starts with a BOM or carries a mojibake sequence. It runs in
  `npm run lint`, so it gates every release, and in the prose-tier workflow,
  because two of the five faults were in markdown that never reaches the full
  suite.
- Dated archives are history and are not scanned; five archived evidence files
  do carry a BOM, and they stay as they were. A line that shows the fault on
  purpose (AGENTS.md's rule, the Zomato row's regression test) says so with
  `encoding-check: allow`.
- The check and its test are plain ASCII and build the characters they look for
  from their codes: writing this change, an agent tool rewrote `\u` escapes into
  the characters they named, and the check tripped on its own source.

## Non-goals

- No change to any requirement. No living spec states the rule; AGENTS.md does,
  and it now says the check enforces it.
- The archived files carrying a BOM are not rewritten.
- No editor configuration. The check is what holds regardless of which tool
  wrote the file.
