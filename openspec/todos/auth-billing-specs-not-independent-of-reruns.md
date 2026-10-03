# Two offline billing specs are not independent of a previous run

**Type**: Verification gap · **Status**: Open, found 2026-10-02 · **Area**: Testing

## What happens

Run `e2e-auth/billing-offline.spec.ts` or `e2e-auth/billing-two-tablets.spec.ts`
a second time without a `db reset`, and each fails, though nothing is broken.

- **The offline spec numbers its new customers from a fixed range.** A rerun
  types a phone number an earlier run already saved. The online till finds that
  customer and rings the bill under the earlier run's name, so a count of bills
  under this run's name reads 0 although exactly one was written.
- **The two-tablet spec pays two customers with fixed names.** A rerun counts
  every earlier run's bills under those names too: six instead of two after
  three runs.

## Why it matters

CI never hits it, because every run starts from a fresh stack. Locally, a
developer chasing one failure reruns a single spec, and the second failure looks
like a regression in whatever they just changed.
`e2e-auth/billing-served.spec.ts` already solved both shapes: phone digits
derived from the clock, names carrying a per-run suffix, and offline work found
among the till's own unsent cards (`served-spec-reruns-under-load`).

## What a fix could look like

Give both specs per-run phone digits and per-run names, as `billing-served`
does, and count bills by this run's names only.

## Trigger to promote

A rerun of either spec costs somebody a misdiagnosis, or a change is already
editing one of them.
