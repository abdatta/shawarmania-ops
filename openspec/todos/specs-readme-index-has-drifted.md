# The Specs README Index Has Drifted

**Type**: Documentation gap · **Status**: Open · **Area**: Process

## Expectation

`openspec/specs/README.md` lists every capability that exists, so a reader arriving at the living
specs can see the whole contract surface from one page.

## Current behaviour

Its "Current capabilities" index lists twelve capabilities. Eighteen directories exist. Six are
missing entirely:

`app-shell` · `attention-badges` · `demo-mode` · `identity-and-access` · `menu-management` ·
`outlet-expenses`

The "Expected capabilities" line below it is stale in the other direction: it still names
`staff-authentication`, `counter-device-trust`, `menu-catalogue`, `offline-settlement` and
`expense-tracking` as future work, when several of those appear to have landed under different
names (`identity-and-access`, `menu-management`, `outlet-expenses`).

Noticed while archiving `global-customer-identity` (#32), which added its own entry correctly. The
six omissions were left alone deliberately: writing an accurate one-line summary of a capability
means reading its contract, and guessing at six of them in a change about customers would be
worse than leaving the gap visible.

## Why it happens

The index is hand-authored prose grouped by the change that landed each capability, while the
directories are created by `/opsx:archive`. Nothing reconciles the two, so an archive that forgets
the README leaves no trace. Every other derived board in this repo has a reconciler
(`npm run roadmap:sync`); this one does not.

## Open questions

- **Fix by hand, or derive it?** A small script could enumerate `openspec/specs/*/spec.md` and
  check each appears in the README, failing CI if not. That is the same shape as
  `sync-roadmap-status.mjs` and would stop this recurring. The one-line summaries would still be
  hand-written, since they are judgment rather than data.
- Should the grouping by originating change survive? It reads well historically, but it is also
  what makes the list awkward to append to, and history already lives in `openspec/changes/archive/`.
- Does the "Expected capabilities" line earn its place now that `ROADMAP.md` covers the same ground
  and is reconciled automatically?

## Trigger to promote

The next change that archives a capability, or any change touching openspec tooling. Cheap either
way, and cheaper than it looks if the answer is a checker rather than prose.

**Dependencies when seeded**: none.
