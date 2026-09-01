import { describe, expect, it } from 'vitest'

import {
  decideRunOutcome,
  declaredDegradation,
  isAggregatorOutcome,
  reachedNoData,
} from '../../supabase/functions/_shared/run-outcome'

/**
 * The rule that cost eighteen hours of Swiggy figures on 2026-08-31.
 *
 * `ingest-aggregator-cycle` returned as soon as a caller declared a non-`ok`
 * outcome, without looking at the cycles in the same request. So a runner had two
 * sentences available to it — "I wrote this" or "I failed" — and a run that read
 * six settled weeks and could not read the open one had to pick one and lie with
 * it. Picking success hides a break; picking failure discards six real weeks.
 *
 * Tested here rather than through the function body because the function body
 * imports the Supabase client, which cannot resolve under `deno check` in this
 * repository and is excluded from the app's `tsc` project. The decision is the
 * part worth covering, so the decision is what was extracted.
 */
describe('what one aggregator run records', () => {
  describe('a declared degradation', () => {
    it('is null when nothing was declared', () => {
      expect(declaredDegradation(undefined)).toBe(null)
      expect(declaredDegradation(null)).toBe(null)
      expect(declaredDegradation('')).toBe(null)
    })

    it('treats a declared success as no claim at all', () => {
      // A caller must not be able to assert that a run succeeded over what its
      // own writes did. `ok` alongside cycles means the same as saying nothing.
      expect(declaredDegradation('ok')).toBe(null)
    })

    it('ignores a word the constraint does not permit', () => {
      // A sixth word here without a migration is a run that fails to record
      // itself, so an unknown word is not passed through as a degradation.
      expect(declaredDegradation('partial')).toBe(null)
      expect(declaredDegradation('broken')).toBe(null)
      expect(isAggregatorOutcome('partial')).toBe(false)
    })

    it('keeps every word that names a real fault', () => {
      expect(declaredDegradation('shape_changed')).toBe('shape_changed')
      expect(declaredDegradation('session_lapsed')).toBe('session_lapsed')
      expect(declaredDegradation('reconciliation_failed')).toBe('reconciliation_failed')
      expect(declaredDegradation('awaiting_one_time_password')).toBe('awaiting_one_time_password')
    })
  })

  describe('whether the run reached no data', () => {
    it('is true for a declared failure carrying nothing', () => {
      // The original meaning, and its behaviour is unchanged: report the
      // failure, write nothing for those dates, and never a zero.
      expect(reachedNoData('shape_changed', 0)).toBe(true)
    })

    it('is FALSE for a declared failure carrying cycles', () => {
      // The regression this whole change exists to prevent. Before 2026-09-01
      // this case returned early and the cycles were never looked at.
      expect(reachedNoData('shape_changed', 6)).toBe(false)
      expect(reachedNoData('session_lapsed', 1)).toBe(false)
    })

    it('is false when no failure was declared', () => {
      expect(reachedNoData(undefined, 0)).toBe(false)
      expect(reachedNoData('ok', 0)).toBe(false)
    })
  })

  describe('the word a finished run records', () => {
    const nothingDeclared = { degradation: null, degradationDetail: null } as const

    it('is ok when nothing went wrong', () => {
      expect(decideRunOutcome({ ...nothingDeclared, unreconciled: 0 })).toEqual({
        outcome: 'ok',
        detail: null,
      })
    })

    it('is the declared fault when only the read fell short', () => {
      expect(
        decideRunOutcome({
          degradation: 'shape_changed',
          degradationDetail: 'getOrderLevelPayoutsV2 was rejected',
          unreconciled: 0,
        }),
      ).toEqual({ outcome: 'shape_changed', detail: 'getOrderLevelPayoutsV2 was rejected' })
    })

    it('is the reconciliation failure when only the writes fell short', () => {
      const decided = decideRunOutcome({ ...nothingDeclared, unreconciled: 2 })
      expect(decided.outcome).toBe('reconciliation_failed')
      expect(decided.detail).toMatch(/2 cycle\(s\) did not reconcile/)
    })

    it('lets money that does not add up outrank a short read, without losing it', () => {
      // The precedence from design.md D2. A reconciliation failure is a question
      // about money and goes to whoever answers those; a short read is a changed
      // portal and goes to a maintainer. The narrower fault takes the word — and
      // the declared reason has to survive in the detail, or the run stops saying
      // one of the two true things about itself.
      const decided = decideRunOutcome({
        degradation: 'shape_changed',
        degradationDetail: 'the open cycle could not be read',
        unreconciled: 1,
      })
      expect(decided.outcome).toBe('reconciliation_failed')
      expect(decided.detail).toMatch(/did not reconcile/)
      expect(decided.detail).toMatch(/the open cycle could not be read/)
    })

    it('never lets a declared success overwrite what the writes found', () => {
      // Belt and braces against the one direction that must not be possible: a
      // caller claiming ok cannot bury its own cycles' reconciliation failure.
      expect(
        decideRunOutcome({
          degradation: declaredDegradation('ok'),
          degradationDetail: 'all good',
          unreconciled: 3,
        }).outcome,
      ).toBe('reconciliation_failed')
    })

    it('says nothing about a shortfall it was given no words for', () => {
      const decided = decideRunOutcome({
        degradation: 'shape_changed',
        degradationDetail: null,
        unreconciled: 1,
      })
      expect(decided.detail).toMatch(/did not reconcile/)
      expect(decided.detail).not.toMatch(/fell short/)
    })
  })
})
