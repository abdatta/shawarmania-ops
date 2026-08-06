# Proposal: The Suite Runs When The Commit Can Change What Ships

> **Model**: Opus · **Kind**: delivery tooling — no roadmap row · **Gate**: **a commit confined to prose runs the prose tier and publishes nothing**, a commit touching anything that can change what is built, served or migrated runs the whole suite and publishes exactly as it does today, a commit touching both runs the whole suite, and **no commit reaches `main` with no checks at all**.

## Why

`verify.yml` is the right shape and runs too often. It is one definition of "this
commit is good", called by `ci.yml` on a pull request and by `deploy.yml` in
front of the publish, and it spends about four minutes on three parallel jobs,
one of which brings up a Docker Postgres stack, applies every migration and
drives four real roles through a browser.

**27 of the last 80 commits could not have changed the answer.** They touched
only `docs/`, `openspec/changes/`, `openspec/specs/`, `openspec/todos/` or a
root `*.md`. This is a spec-driven repo, so that traffic is not incidental: it is
what the workflow produces. A proposal, a spec delta, a roadmap reconcile and an
archive are each a commit that cannot change a bundle, a schema or a policy, and
each one currently starts a database.

The cost is not only minutes. A suite that runs when it cannot fail teaches
people to stop reading it.

## What Changes

- A commit that can change what is built, served or migrated runs the whole
  suite, exactly as now. Nothing about `verify.yml` changes.
- A commit confined to prose runs a **prose tier**: `format:check` and
  `lint:todos`, the two gates that genuinely apply to prose, and nothing else.
- A commit confined to prose **publishes nothing**, because there is nothing in
  it to publish.
- The two filters are complements, so **every commit lands in exactly one tier or
  in both, and never in neither.** That property is the point of the design and
  is asserted rather than assumed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: continuous integration stops being described as "every
  push and pull request" and becomes tiered by what the commit can affect, with
  the prose tier and the total-coverage property both stated so that neither can
  be optimised away later by someone reading only the workflow files.

## Impact

`ci.yml` and `deploy.yml` each gain a `paths-ignore` list; one new
`.github/workflows/docs.yml` carries the prose tier. `verify.yml` is untouched,
which matters: the definition of a good commit is not being weakened, only the
question of which commits need asking.

One operational consequence, documented rather than designed around: the
deployed bundle stamps its own commit into the UI, so after a prose-only push
`Build <sha>` reads the last commit that changed the app rather than the tip of
`main`. That is more truthful than the current behaviour, which republishes an
identical bundle under a new number, but it changes what "the deploy carries my
commit" means when verifying a push.

## Non-goals

- **Weakening the publish gate.** A publish still runs the whole suite. A commit
  that skips the suite also skips the publish; the two are the same decision.
- **Filtering inside `verify.yml`.** Skipping the database job on a
  frontend-only change is a much finer judgement about which suites cover which
  code, and it would put that judgement in the file whose whole value is being
  one unconditional definition.
- **Ignoring `openspec/tools/`.** It is eslint-linted JavaScript that reconciles
  the roadmap, so it stays on the full-suite side despite living under
  `openspec/`.
- **A third-party path-filter action.** Native trigger filters do this without
  adding an action to the supply chain of every run.

## Docs to update before archive

`docs/TESTING.md` (the two tiers and what each one gates), `docs/OPERATIONS.md`
(the build stamp after a prose-only push, and how to republish deliberately),
and `AGENTS.md` (the quickfix push check reads the deployed SHA, which now lags
on a prose-only push).
