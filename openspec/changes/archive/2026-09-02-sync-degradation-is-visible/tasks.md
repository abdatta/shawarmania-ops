# Tasks: A Degraded Sync Is Visible

## 1. A run may report cycles and a degradation together

- [x] 1.1 In `ingest-aggregator-cycle`, stop returning early on a declared
      non-`ok` outcome when the request carries cycles. Keep today's behaviour
      exactly when it carries none.
- [x] 1.2 Record one run for such a request, with the declared outcome and detail
      and the summary the writes produced (`design.md` D1).
- [x] 1.3 Apply the precedence in `design.md` D2: a refused cycle wins, then a
      reconciliation failure with the declared reason appended to its detail,
      then the declared degradation. A declared `ok` is treated as no declaration.
- [x] 1.4 Correct the comment on `finish` that says a declared outcome means the
      run reached no data. It no longer does.
- [~] 1.5 **Done differently, and the difference matters.** The plan was a REST
      call against the local stack. Instead the decision was extracted to
      `_shared/run-outcome.ts` and unit-tested (13 cases, in `npm test`), because
      the function body cannot be reached by any gate this repo has: `tsc`
      excludes `supabase/functions`, and `deno check` cannot resolve the Supabase
      client import. So the branch was not merely untested, it was
      **untypechecked** — and the extraction fixes both, following the precedent
      `reconnect-ladder.ts` set. `run-outcome.ts` was also added to
      `functions:typecheck` so CI holds it.
      **What is still not covered:** no test drives the real HTTP endpoint with
      cycles plus a degradation. The handler is now a thin caller of a covered
      decision, but "the cycles are actually written" rests on reading it.

## 2. A channel that has stopped reads as stopped

- [x] 2.1 Add `hasGoneQuiet(lastRunAt, readsPerDay, now)` to `when.ts`, at one and
      a half cadence intervals (`design.md` D3).
- [x] 2.2 Use it in `HealthLine`: a channel whose last run succeeded but is past
      due reads `Overdue`, in the fault colour, with a note saying a read was due.
- [x] 2.3 Use it in `HyperpureHealthLine`, which picks its word separately.
- [x] 2.4 Never fire it over a more specific state: under way, never run, not
      switched on, or a recorded failure all win (`design.md` D3).
- [x] 2.5 Confirm `Read now` is offered when overdue — the lockout keys off a
      recent success, so it should already be, and the owner needs the action.

## 3. The runner posts its degradation with its figures

- [x] 3.1 In `shawarmania-sync`, let `postCycles` carry an optional outcome and
      detail.
- [x] 3.2 Have the Swiggy reader use it when `readPayouts` degraded but still
      produced candidates, so a partial run is one row rather than a success
      followed by a contradiction.

## 4. Tests

- [x] 4.1 A test that fails without task 1: cycles posted alongside a declared
      degradation are written, not discarded.
- [x] 4.2 A test for each precedence branch in D2.
- [x] 4.3 `hasGoneQuiet` boundary tests: inside, outside, null cadence, null last
      run.
- [x] 4.4 A surface test that a stale `ok` channel renders as a fault, and that a
      fresh one does not.
- [x] 4.5 A surface test that a recorded failure still wins over overdue.

## 5. Spec and docs

- [x] 5.1 Spec delta on `aggregator-settlement-sync`: the surface states when a
      channel has stopped, and a run may carry figures and a degradation.
- [x] 5.2 Update the `docs/` page describing the sync surface's health line, if it
      states the old two-outcome rule.

## 6. Verification

- [x] 6.1 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
      `npm test`, `contrast`, `build`.
- [x] 6.2 Docker job: `db:start`, `db:reset`, `test:db`, `test:rls`,
      `test:e2e:auth`, `db:types`, clean type diff.
- [x] 6.3 `npm run test:e2e`.
- [x] 6.4 The surface in both themes, at desktop and phone widths. Tablet was
      NOT photographed separately: it falls between the two that were, on a
      `flex-wrap` card whose two children fit side by side at the narrower one.
- [x] 6.5 The four-role demo walkthrough still walks.

## Notes from verification

**Every gate in `AGENTS.md` was run and is green**, including the Docker job
(`test:db` 2008 tests, `test:rls` 239, `test:e2e:auth` 21, clean `db:types`
diff), `npm test` (1468), `test:e2e` (246), lint, both typechecks, contrast and
build. The overdue line was photographed in both themes at desktop and phone widths
(tablet was not, see 6.4), and the demo walkthrough still reads `All quiet` with
its lockout intact.

**Two failures on the way there were environmental, and both were confirmed as
such rather than assumed.** Running `test:rls` more than once produced
`expected 429 to be 204` across `account-flows.test.ts` — the GoTrue rate limit
`AGENTS.md` documents. That residue then failed one `test:e2e:auth` test, whose
own error context showed the cause: *"39 failed activation attempts in the last
fifteen minutes"*. Both suites pass on a fresh `db:reset`, run once, in the CI
order. **Run `test:rls` once per reset**; a second run poisons the auth suite
after it, and the symptom names neither the cause nor the change in front of you.
