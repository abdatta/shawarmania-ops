---
name: quickfix
description: Land a small bug fix or minor change end to end, fast, without the roadmap-change ceremony — reproduce, fix, pin with one test proved to fail before it, push and let CI gate. Use when the user reports a bug, says "quick fix", "small change", "just fix", or when a change is a correction to shipped behaviour rather than new capability. Refuses itself for migrations, RLS/policy, money arithmetic, offline/outbox, the gate registry and the demo seam, which go through /propose-apply-verify.
---

# Quickfix

Take ONE bug or small correction from report to deployed, in roughly the time the
diagnosis deserves and no longer. Announce: "Quickfix: `<short name>` — reproduce
→ fix → pin → push."

This exists because `/propose-apply-verify` is built for roadmap changes and
behaves accordingly: four planning artifacts and the full local gate set, for a
correction that may amount to two expressions. The contract this skill
implements, and the reasons behind it, are in [`AGENTS.md`](../../../AGENTS.md)
under "The quickfix lane". Read that if any step here looks like a corner being
cut; it explains which corners are load bearing.

## Phase 0 — Refuse the lane if it does not apply

**Stop and use `/propose-apply-verify` instead if the fix touches:** a
migration, an RLS policy or grant, money arithmetic, offline or outbox
semantics, the gate registry, or the demo seam.

The reason is not that these are likelier to fail a test. It is that **a green
suite does not describe how they fail.** A forward-only migration that passes
every test and is still wrong is not undone by a follow-up push; silent
over-permission passes every functional test in the repo.

Say which one applies and hand off. Do not negotiate the lane down.

If the change adds capability rather than correcting shipped behaviour, that is
also not a quickfix, however small it looks.

## Phase 1 — Reproduce before touching anything

Make it fail on demand. Read the code path first, then prove the failure at the
lowest layer that shows it: a rolled-back query against the real database, a
node script, a failing assertion. **A fix built on a theory of the bug is a
guess**, and the reproduction is also what tells you, in Phase 4, whether an
existing test should have caught it.

State the root cause in one or two sentences before writing the fix. If you
cannot, keep reading.

## Phase 2 — The change folder, kept to what the rule requires

The spec-driven rule is literal: no code change without a change folder. It does
not demand four artifacts.

```bash
npx openspec new change "<name>"
```

Write two files and no more:

- **`proposal.md`** — the banner (`**Model**: … · **Kind**: production bug fix,
  not a roadmap change · **Gate**: …`), a Why of two or three sentences, What
  Changes, and Non-goals. No Wave, no dependency numbers, **no ROADMAP.md row**:
  a fix has no place in a board that sequences planned capability.
- **`tasks.md`** — checkboxes, ending in a gate task.

**Skip `design.md`** unless the fix chooses between real alternatives that a
later reader would otherwise have to reconstruct.

**Skip the spec delta when the fix restores behaviour an existing requirement
already demands.** Check `openspec/specs/<capability>/spec.md` first and say what
you found. If the spec already required the behaviour, this was never a contract
change; the archive flow handles a change with no delta. Write a delta only when
the fix genuinely changes or adds a requirement.

Then `npm run roadmap:sync`, which never inserts rows and so needs no undoing.

## Phase 3 — Fix, and make the shape unwritable

Fix the cause, not the symptom, and where the defect is a *pattern* rather than a
typo, remove the pattern: a named helper, a narrowed type, a lint rule. Two
call sites with the same bug means the next one will have it too.

## Phase 4 — Pin it, and only as deep as the bug is

- **One test that fails before the fix and passes after.** At the lowest layer
  that can see the bug. **Prove it**: revert the fix, run the test, watch it
  fail, restore. About a minute, and it is the whole difference between a fix and
  a hope.
- **If the fix is about the shape of a request, prove the far end accepts the new
  one.** A payload assertion proves what left the process and nothing about what
  the database does with it. One rolled-back call is enough; convincing yourself
  by reading the function body is inference, and inference is what shipped the
  bug.
- **If the reproduction shows an existing test could not have caught this,
  tighten that test now.** Assert by error code rather than "it rejected";
  assert what the test claims to prove rather than what happens to pass. A test
  that has been green for the wrong reason will stay green when the bug returns.
- Do **not** add a second and third layer of coverage because it feels
  thorough. Say in the report what you did not cover.

## Phase 5 — Check locally only what CI cannot do faster

Run `npm run typecheck` and the specific test files the change touches. That is
the list.

Skip the full suite. CI runs it across three parallel jobs, it gates the
migration and the publish, and a red gate leaves the build already on the counter
untouched — so running it yourself in series buys a faster red, not a safer
deploy.

Two exceptions worth the minute: run `npm run format:check` if you wrote more
than a few lines, since it is the gate most often forgotten, and `npm run lint`
if you added a file.

## Phase 6 — One docs line where the fix implies a rule

If the bug came from a rule nobody had written down, write the rule, in one or
two sentences, in the page that owns it. The essay can wait; the rule cannot,
because the rule is what stops the recurrence.

## Phase 7 — Push, then watch the gate

Commit in the repo's voice, describing what was wrong and why the fix is shaped
as it is. Push only when the user has asked for it, and treat reaching
production as the outward-facing act it is.

Then `gh run watch <id> --exit-status`, and check the deployed build actually
carries the commit (`build-version` on the shell reads `Build <sha>`). If CI goes
red, fix forward: nothing published.

**Say that the service worker does not claim an open page**, so whoever hit the
bug must close the app and reopen it before the fix reaches them. On a bug
somebody is waiting on, this is the difference between "fixed" and "still
broken" from their side.

## Phase 8 — Report

Short, and in this order: the root cause; the fix; the test that pins it and the
proof it fails without it; what you ran; **what you deliberately did not cover**;
and anything left for the user, prefixed 🧍.

Then offer `/opsx:archive <name>`.
