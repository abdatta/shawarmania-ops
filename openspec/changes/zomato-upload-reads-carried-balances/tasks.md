# Tasks: zomato-upload-reads-carried-balances

## 1. The parser (`supabase/functions/_shared/statement-parser-core.ts`)

- [x] 1.1 Fixture rows in `statement-parser.test.ts` for a section D carried balance, as measured on the 26 Oct – 01 Nov 2026 workbook (status `NA`, Total = Adjusted, nothing outstanding), counted inside `Total Deductions`
- [x] 1.2 Tests: a carried balance settles the week as an `other_adjustment` of the adjusted amount, negated, keyed as the sync keys it; one with an amount outstanding is refused by name (both fail today)
- [x] 1.3 `parseZomatoAdjustments` reads section D per design D1-D3, replacing the old refusal

## 2. Gate

- [x] 2.1 The new tests fail with 1.3 reverted and pass with it
  _(12 November: before 1.3 both new tests failed; after it, 33 of 33 pass.)_
- [x] 2.2 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` green; pushed to `stage`, Staging green
  _(12 November: 3,377 unit tests, lint, both typechecks and the build green locally; Staging run 43184358794 green on `f632cc42`.)_
- [ ] 2.3 After the owner's Promote, a real 26 Oct – 01 Nov 2026 workbook upload reports the week already settled and agreeing (the sync settled it first)
