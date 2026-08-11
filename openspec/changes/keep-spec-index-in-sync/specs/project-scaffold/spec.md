## ADDED Requirements

### Requirement: The living-spec index lists every current capability

Lint SHALL compare direct capability directories containing `spec.md` under
`openspec/specs/` with capability links in `openspec/specs/README.md`. It SHALL
exit non-zero and name every directory the index omits and every capability link
whose directory or spec no longer exists.

The index SHALL describe current capabilities only. Its summaries SHALL remain
hand-authored, and the checker SHALL NOT generate, reorder, or rewrite them.
Future sequencing SHALL remain in the roadmap rather than an expected-capability
forecast in the living-spec index.

#### Scenario: A capability added without an index entry fails

- **WHEN** an archive creates a capability directory containing `spec.md` and the
  living-spec index has no link to it
- **THEN** the checker exits non-zero and names the missing capability

#### Scenario: A removed capability leaves a dangling link

- **WHEN** the living-spec index links a capability whose directory or `spec.md`
  no longer exists
- **THEN** the checker exits non-zero and names the dangling capability link

#### Scenario: A complete current index passes

- **WHEN** every current capability is linked exactly as a current capability and
  every capability link resolves
- **THEN** the checker passes without changing the authored summaries

## MODIFIED Requirements

### Requirement: Continuous integration on every push and pull request

A CI workflow SHALL run install, lint, format check, typecheck, unit tests, the
contrast validator, the production build, and the end-to-end suite on every push
and pull request **that can change what is built, served or migrated**. A failure
in any step SHALL fail the workflow.

A push or pull request confined to prose — the documentation tree, the change,
spec and backlog directories, and root-level markdown — SHALL instead run a
documentation tier that gates formatting, the behaviour backlog's index, and the
living-spec capability index, and SHALL publish nothing, there being nothing in
such a commit to publish. Executable files under those directories are not prose
and SHALL take the full suite.

The two filters SHALL be complements **for every event either tier runs on**:
every commit SHALL match at least one tier on both a pull request and a push to
the default branch, so that no commit can reach the default branch with no checks
at all. Coverage is a property of event and path together; a tier covering only
one event leaves the other unguarded. The publication gate SHALL NOT be weakened
by this split — a commit that runs the full suite publishes only if the full suite
passes, exactly as before.

#### Scenario: A failing check blocks the pipeline

- **WHEN** a commit that fails any of those steps is pushed
- **THEN** the CI workflow reports failure

#### Scenario: A commit that cannot change the app skips the suite

- **WHEN** a push or pull request touches only the documentation tree, the
  change, spec and backlog directories, or root-level markdown
- **THEN** the full suite does not run, the documentation tier runs the format
  check plus both index checks, and nothing is published

#### Scenario: A tool living beside prose still takes the full suite

- **WHEN** a push changes an executable file under the change-management tree,
  such as the roadmap reconciler
- **THEN** the full suite runs

#### Scenario: A mixed commit takes the full suite

- **WHEN** a push changes both prose and application code
- **THEN** the full suite runs and gates the publish

#### Scenario: No commit goes unchecked

- **WHEN** any commit is pushed to the default branch, or raised as a pull request
- **THEN** it matches the full suite, the documentation tier, or both, and never
  neither

#### Scenario: A prose commit pushed straight to the default branch is still checked

- **WHEN** a commit confined to prose is pushed directly to the default branch
  rather than through a pull request
- **THEN** the documentation tier runs, and the commit is not left unchecked
  because the full suite declined it
