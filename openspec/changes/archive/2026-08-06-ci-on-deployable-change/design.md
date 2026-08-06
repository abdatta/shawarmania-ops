# Design: Tiering CI By What A Commit Can Affect

## The decision that matters: deny, not allow

Two ways to express "deployable", and they fail in opposite directions.

An **allowlist** (`paths: ['src/**', 'supabase/**', …]`) names what runs the
suite. Forget an entry and a real change to the app ships with no verification at
all. The failure is silent and it is the bad kind.

A **denylist** (`paths-ignore: ['docs/**', …]`) names what does not. Forget an
entry and a prose commit runs the full suite needlessly. The failure is visible,
costs four minutes, and is exactly the state the repo is in today.

**Denylist.** A filter guarding a publish should err toward running, and the cost
of being wrong should be minutes rather than an unverified deploy. This is the
same reasoning `check-no-hex.mjs` uses when it scans everything under `src/` and
exempts one file, rather than listing the files worth scanning.

## Why `openspec/` is not one thing

`openspec/tools/sync-roadmap-status.mjs` is JavaScript, eslint covers it, and it
rewrites the roadmap. It is code that happens to live beside prose. So the
denylist names the three prose directories individually — `changes/`, `specs/`,
`todos/` — rather than `openspec/**`.

Anything else that appears under `openspec/` later, including `config.yaml`, falls
through to the full suite. That is the denylist erring toward running, on purpose.

## Two workflows, not a change-detection job

The alternative was one workflow with a first job that diffs the commit and sets
an output every later job keys off. It concentrates the logic in one readable
place, and it costs a runner boot before anything starts, plus an `if:` on every
job and a third-party action or a hand-rolled diff.

Native trigger filters need neither. The cost is that the two filters are
complements maintained in two files, which is a real risk and the reason the
coverage property below is asserted rather than trusted.

A commit touching both prose and app code matches both filters and runs both
tiers, and **that is the most common commit in this repo: 43 of the last 80.**
The prose tier's two checks are also inside the full suite, so each of those pays
about forty redundant runner-seconds. Wall clock is untouched, because the tier is
a separate job running beside a four-minute suite.

Accepted, and the arithmetic is why: 27 prose-only commits stop spending roughly
six runner-minutes each, against 43 mixed commits gaining forty seconds each. The
alternative is expressing "prose only, and nothing else" in a trigger filter,
which GitHub cannot do — `paths` and `paths-ignore` are mutually exclusive for one
event — or gating the tier's steps behind a diff, which buys back twenty seconds
by adding the change-detection logic this design just rejected.

## The property that makes it safe

Let **P** be the prose set. `ci.yml` and `deploy.yml` run when any file is
**not** in P. `docs.yml` runs when any file **is** in P.

- Every file in P → `docs.yml` runs, full suite skipped.
- Any file outside P → full suite runs.

**Coverage is a property of (event × path), not of paths alone**, and the first
draft of this change got that wrong. `ci.yml` triggers on `pull_request` and
`deploy.yml` on a push to `main`; `docs.yml` initially triggered only on
`pull_request`, which left a prose-only **push** to `main` matching no workflow at
all. This repo pushes to `main` directly, so that was not a corner case, it was
the common path. The prose tier therefore declares both events, and because
GitHub supports no YAML anchors its path list is written out once per event.

With both events covered, every commit matches at least one tier. **No commit can reach `main` with no
checks.** The two lists must stay complements for this to hold, and nothing in
GitHub will say otherwise if they drift: the three trigger blocks are evaluated
independently, so a half-finished edit produces no error, it just quietly stops
checking something. Hence two separate proofs rather than an argument.

The first replays the last 80 commits through the lists as actually written in the
workflows: **27 take the prose tier alone, 10 the full suite alone, 43 both, and 0
neither**, with no commit touching `src/`, `supabase/`, `scripts/`, `e2e/`,
`shared/`, `openspec/tools/` or `.github/` landing in the prose-only set. The
second is a standing test that reads the three workflow files and fails when the
lists stop being complements — proved by deleting one entry, which it caught by
name, and which would otherwise have left a commit touching only
`openspec/todos/` with no checks at all.

One commit separates the crude estimate from the measured figure, and it is the
carve-out working: a commit under `openspec/` that a naive `openspec/**` rule
would have called prose takes the full suite, because what it touched was not.

## What the prose tier actually gates

Not a token gesture. Two checks genuinely apply to a prose commit:

- **`format:check`** — prettier formats markdown, and a badly formatted table is
  a real failure the full suite currently catches.
- **`lint:todos`** — the backlog index check added the same day as this change.
  This one is load bearing: **adding a backlog note is itself a prose-only
  commit**, so putting the drift check behind the full-suite filter would have
  disarmed it for exactly the commits it exists to police. The check and this
  filter were nearly a bug in each other.

eslint, typecheck, the build and every test suite are omitted because no file a
prose commit can touch is an input to them, with `openspec/tools/` carved out
above precisely because it is.

## The build stamp, and why the lag is an improvement

`vite.config.ts` bakes the short commit SHA into the bundle and the shell
displays it. Today a prose-only push republishes a byte-identical bundle under a
new SHA. After this change it is not republished, so `Build <sha>` reads the last
commit that changed the app.

This is the more honest reading: the number now names the commit whose code is
running, not the commit that happened to be at the tip when Pages last ran. It
does change one habit, though, and the habit is written down: `AGENTS.md` tells a
quickfix to confirm the deployed build carries the commit. That check stays
correct for app changes and becomes wrong for prose ones, so it gets the
qualification rather than being left to surprise somebody.

Deliberate republication is unchanged: `workflow_dispatch` is never path-filtered.
