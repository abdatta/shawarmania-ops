import { describe, expect, it } from 'vitest'

import { activationLink } from './activation-link'

/**
 * The link is the whole change: get the base wrong and every activation sent
 * that day 404s on somebody's phone, with no way for them to tell why.
 */
describe('activationLink', () => {
  it('carries the code under a sub-path deployment', () => {
    expect(activationLink('ABCDE-FGHJK', 'https://x.github.io', '/shawarmania-ops/')).toBe(
      'https://x.github.io/shawarmania-ops/activate?code=ABCDE-FGHJK',
    )
  })

  it('carries it at the root of a custom domain, with no doubled slash', () => {
    expect(activationLink('ABCDE-FGHJK', 'https://ops.example', '/')).toBe(
      'https://ops.example/activate?code=ABCDE-FGHJK',
    )
  })

  it('survives a base written without its trailing slash', () => {
    expect(activationLink('ABCDE-FGHJK', 'https://x.test', '/ops')).toBe(
      'https://x.test/ops/activate?code=ABCDE-FGHJK',
    )
  })

  it('escapes the code rather than trusting its alphabet', () => {
    // Crockford base32 needs no escaping today. Depending on that is how a URL
    // builder breaks the day somebody widens the alphabet.
    expect(activationLink('A B&C', 'https://x.test', '/')).toBe(
      'https://x.test/activate?code=A%20B%26C',
    )
  })

  it('never carries identity data', () => {
    expect(activationLink('ABCDE-FGHJK', 'https://x.test', '/')).not.toContain('@')
  })
})
