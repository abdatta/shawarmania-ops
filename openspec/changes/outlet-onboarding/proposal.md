# Proposal: outlet-onboarding

> **Model**: Opus · **Wave**: F · **Depends on**: #13 · **Gate**: a third outlet is created, staffed, tablet-enrolled and verified isolated **entirely through the UI, with zero code changes**; the runbook in `docs/OPERATIONS.md` matches what actually happened.

## Why

**This is the change that proves the franchise thesis.** Everything in this system was designed on the assumption that outlet number seven is a data operation rather than a code change. This change tests that assumption against reality.

Its gate is deliberately harsh, because if it cannot be met, the multi-outlet design has a defect that is far cheaper to find now than when a real franchisee is waiting to open.

## Scope

- A guided outlet-onboarding flow following the runbook in `docs/OPERATIONS.md`.
- Menu seeding from a standard set, with per-outlet price adjustment.
- **The isolation verification step, made a real blocking part of the flow** rather than a checklist item someone can skip: sign in as the new Franchise Admin and confirm no other outlet is reachable anywhere.
- Whatever hardcoded assumptions the walkthrough exposes, removed.

## Non-goals

- No franchise contract or commercial workflow.
- No self-service onboarding by the franchisee. The Super Admin drives it.

## How to run the gate

End to end on staging with a genuinely new third outlet, not a fixture. **Any step requiring a code change is a defect to fix in this change**, not a note for later — that is the entire point of the exercise.

## User-only gate steps

- 🧍 Walk the whole flow personally, as if opening a real franchise.
- 🧍 Confirm isolation from the new Franchise Admin's own login before declaring it passed.

## Docs to update before archiving

`docs/OPERATIONS.md` — correct the runbook to match what actually happened, including anything that turned out to be missing.
