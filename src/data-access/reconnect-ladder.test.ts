import { describe, expect, it } from 'vitest'

import { decideRung, type ProbeLike } from '../../supabase/functions/_shared/reconnect-ladder'

/**
 * Every rung of the repair ladder, decided from nothing but the two probes.
 *
 * The rule the tests protect: a full sign-in is the LAST rung, never the
 * default — it is the only one that can cost the owner a one-time code — and
 * "could not tell" never guesses. The wiring around this function changes;
 * these answers must not.
 */

const alive: ProbeLike = { alive: true }
const dead: ProbeLike = { alive: false }
const unknown: ProbeLike = { alive: null }

describe('decideRung', () => {
  it('answers still_signed_in and dispatches nothing when both channels are warm', () => {
    expect(decideRung(alive, alive)).toBe('still_signed_in')
  })

  it('takes the silent capture-only rung for a cold child under a warm parent', () => {
    // Today's production shape, and the common repair: no sign-in step, no
    // code request, no runner beyond the capture itself.
    expect(decideRung(alive, dead)).toBe('capture_only')
  })

  it('runs the full login only when the Zomato parent itself is cold', () => {
    // The child's state is irrelevant here: Model A means one sign-in restores
    // both channels, so a cold parent always means the login.
    expect(decideRung(dead, dead)).toBe('full_login')
    expect(decideRung(dead, alive)).toBe('full_login')
  })

  it('refuses rather than guesses when a probe could not tell', () => {
    // A network hiccup answered with a full-login dispatch would spend the
    // owner's code on nothing, so an unknown refuses the whole reconnect.
    expect(decideRung(unknown, alive)).toBe('probe_failed')
    expect(decideRung(unknown, dead)).toBe('probe_failed')
    expect(decideRung(alive, unknown)).toBe('probe_failed')
    expect(decideRung(dead, unknown)).toBe('probe_failed')
    expect(decideRung(unknown, unknown)).toBe('probe_failed')
  })
})
