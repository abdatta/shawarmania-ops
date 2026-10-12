# Delta: project-scaffold

The tooling that makes every later change reversible: a migration lint, a switch
registry lint, browser suites in both switch states, a request budget, and agent
workflows that ask for the switch first. Design D4, D8, D10–D12.

## ADDED Requirements

### Requirement: Migrations only add to what a published build uses

Lint SHALL read every migration after the baseline `20261017000000` and SHALL exit
non-zero, naming file, line and rule, when an ordinary migration:

- drops, renames or retypes a table or column, changes a column's default or
  nullability, or adds a constraint to an existing table;
- replaces, alters, overloads, drops or revokes a function or view that an earlier
  migration created, unless that earlier migration and this one declare the same
  `-- release-switch:` key;
- creates a trigger on an existing table whose function does not check
  `app_release_switch` for the key the migration declares;
- drops or replaces a policy on an existing table, or adds one that does not check
  `app_release_switch`;
- revokes a privilege on an existing object, drops an index, removes a table from
  the Realtime publication, or unschedules or reschedules a cron job;
- updates or deletes existing rows at migration time.

Comments and function bodies SHALL be stripped before matching, so a migration
describing a rule in prose is not reported as breaking it. Files at or before the
baseline SHALL be read only to learn which objects exist.

A migration declaring `-- release: contract <key>` SHALL be exempt only when that
key is listed as retired in the code's switch registry. A migration declaring
`-- release: emergency <reason>` SHALL be exempt and SHALL be reported on every run.
A single statement MAY be excepted by the line
`-- release-lint: allow <rule> — <reason>` before it, with a reason of at least
twenty characters, and every exception SHALL be printed on every run.

#### Scenario: Rewriting a published function fails lint

- **WHEN** a new migration runs `create or replace function
  public.counter_kitchen_marks` without a matching `release-switch` declaration on
  the migration that created it
- **THEN** lint fails, naming the file and line and saying to create
  `counter_kitchen_marks_v2` and call it only from the switched-on path

#### Scenario: Adding passes

- **WHEN** a new migration creates a table with its policy, adds a nullable column,
  creates a new function and inserts its switch row
- **THEN** the check passes

#### Scenario: Prose is not a violation

- **WHEN** a migration's comment explains that it drops nothing
- **THEN** the check passes

#### Scenario: A contract migration needs a retired switch

- **WHEN** a migration declares `-- release: contract dish-workflow` while
  `dish-workflow` is still declared live in code
- **THEN** lint fails, saying the switch must be retired in code and released
  before its contract migration

### Requirement: Release switches agree between code and database

Lint SHALL exit non-zero when a switch declared in `src/release/switches.ts` is
inserted by no migration; when a switch inserted by a migration is neither declared
nor listed as retired; when a retired key is declared; when a declaration's kind
disagrees with its migration row; when more than five `release`-kind switches
are declared; when a declared switch has no unit test calling
`describeSwitch('<key>'`, no browser test tagged `@switch-on:<key>`, or — unless its
declaration says why with `none:` — no browser test tagged
`@switch-round-trip:<key>`.

Every declaration SHALL carry a `retireBy` date. Lint SHALL warn from that date and
SHALL fail fourteen days after it.

#### Scenario: An expired switch fails the build

- **WHEN** a declared switch's `retireBy` passed more than fourteen days ago
- **THEN** lint fails, naming the switch and the retirement workflow

#### Scenario: A sixth release switch is refused

- **WHEN** a sixth `release`-kind switch is declared
- **THEN** lint fails, saying a switch must be retired before another is added

### Requirement: Every change says how it is released

Lint SHALL exit non-zero when an active change folder whose `.openspec.yaml`
records a creation date on or after 2026-10-13 has a `proposal.md` with no
`## Release` section. The section SHALL either name a declared switch or begin
`No switch:` followed by a reason. Lint SHALL NOT judge the reason. The check SHALL
run in the documentation tier as well as the full suite, so that a commit adding
only a proposal meets it.

#### Scenario: A proposal without a Release section fails

- **WHEN** a new change folder's proposal has no `## Release` section
- **THEN** lint fails, naming the folder and saying what the section must contain

#### Scenario: A proposal-only commit is checked

- **WHEN** a commit adds only a change folder whose proposal has no `## Release`
  section, and takes the documentation tier
- **THEN** that tier fails

### Requirement: Browser suites run with every release off and with every release on

The demo and auth browser suites SHALL each run in two states selected by
`RELEASE_SWITCHES`: `off`, in which every switch is off as on a device that has
never been turned; and `on`, in which every declared switch is on.
A test tagged `@switch-on:<key>` SHALL run only in `on`, one tagged
`@switch-off:<key>` only in `off`, one tagged `@switch-round-trip:<key>` in `off`,
and an untagged test in both. In `on`, the auth suite SHALL turn every declared
switch on through the service role before any test runs.

Continuous integration SHALL run the `on` state of both suites as parallel jobs
beside the existing ones, in the shared verification definition, so the deployment
gate and pull requests run both. Those jobs SHALL complete without running a test
when no release switch is declared.

#### Scenario: Old behaviour survives the new schema

- **WHEN** a change adds a switch and its migration, and the suites run in `off`
- **THEN** every pre-existing test not tagged `@switch-off` runs against the new
  schema and passes unchanged

#### Scenario: The deployment gate runs both

- **WHEN** a commit with a declared switch is pushed to `main`
- **THEN** publication waits for the `on` jobs as well as the `off` ones

### Requirement: An idle counter and kitchen stay inside a request budget

A browser test against the local stack SHALL sign in a counter and a kitchen at an
outlet with a realistic open rail, leave them idle, and fail when the requests each
makes to the backend in a measured minute exceed its budget; and SHALL fail when
ticking dishes or taking a payment costs more requests per action than its budget.
The budgets SHALL be recorded in the test with the date and build they were measured
on, and SHALL be asserted in both switch states.

#### Scenario: The incident build fails the budget

- **WHEN** the budget test runs against the counter #74 shipped
- **THEN** it fails, the counter making many times its idle budget

### Requirement: Lint failures say what to write instead

Every failure reported by the migration and switch lints SHALL state what is wrong
at `file:line`, why the rule exists in one sentence, what to write instead in
concrete terms, and the `docs/RELEASES.md` section that explains it.

#### Scenario: An agent can act on the message alone

- **WHEN** an agent's migration drops a column and lint runs
- **THEN** the message says to stop writing the column on the switched-on path,
  leave it in place, and drop it in the retirement's contract migration

### Requirement: The release workflows exist in both agent trees

Lint SHALL exit non-zero when the `release` or `retire-switch` workflow exists under
`.claude/skills/` and not under `.agents/skills/`, or the reverse.

#### Scenario: A one-sided release workflow fails lint

- **WHEN** `.claude/skills/release/SKILL.md` exists and `.agents/skills/release/`
  does not
- **THEN** lint fails, naming the missing side
