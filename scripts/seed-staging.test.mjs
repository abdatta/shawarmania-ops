import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PRODUCTION_REF, seedScript, seedTarget } from './seed-staging.mjs'

/**
 * The staging seed never touches production (a-release-can-be-switched-off,
 * D19), and its password never lives in the repository.
 */

const PASSWORD = 'a-long-test-password'
const STAGING =
  'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

describe('where the seed may run', () => {
  it('refuses production’s project however the URL spells it', () => {
    for (const url of [
      `postgresql://postgres.${PRODUCTION_REF}:pw@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
      `postgres://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
      `postgresql://postgres.${PRODUCTION_REF.toUpperCase()}:pw@host/postgres`,
    ]) {
      expect(() => seedTarget({ url, password: PASSWORD })).toThrow(/production/)
    }
  })

  it('accepts a staging URL, or the local stack when asked', () => {
    expect(seedTarget({ url: STAGING, password: PASSWORD })).toMatchObject({
      local: false,
      url: STAGING,
    })
    expect(seedTarget({ local: true, password: PASSWORD })).toMatchObject({ local: true })
  })

  it('refuses no URL, a URL that is not Postgres, and a missing or short password', () => {
    expect(() => seedTarget({ password: PASSWORD })).toThrow(/STAGING_SUPABASE_DB_URL/)
    expect(() => seedTarget({ url: 'https://abc.supabase.co', password: PASSWORD })).toThrow(
      /Postgres/,
    )
    expect(() => seedTarget({ url: STAGING })).toThrow(/STAGING_TEST_PASSWORD/)
    expect(() => seedTarget({ url: STAGING, password: 'short' })).toThrow(/12 characters/)
  })

  it('refuses a history it cannot spread a bill a day over', () => {
    expect(() => seedTarget({ url: STAGING, password: PASSWORD, days: 90, bills: 10 })).toThrow()
    expect(() => seedTarget({ url: STAGING, password: PASSWORD, days: Number.NaN })).toThrow()
  })
})

describe('what the seed sends', () => {
  it('writes the password as an escaped literal, the counts as integers, and if-empty', () => {
    const seed =
      'x := {{seed.password}}; y := {{seed.days}}; z := {{seed.bills}}; e := {{seed.if_empty}};'
    expect(seedScript({ password: "it's-a-password", days: 90, bills: 3009 }, seed)).toBe(
      "x := 'it''s-a-password'; y := 90; z := 3009; e := false;",
    )
    expect(
      seedScript({ password: 'a-long-password', days: 90, bills: 3009, ifEmpty: true }, seed),
    ).toContain('e := true;')
  })

  it('refuses a seed missing a place for any value', () => {
    expect(() =>
      seedScript({ password: PASSWORD, days: 90, bills: 3009 }, '{{seed.days}}'),
    ).toThrow(/seed\.password/)
  })

  it('keeps every password out of the seed file itself', () => {
    const seed = readFileSync(resolve(process.cwd(), 'supabase/staging/seed.sql'), 'utf8')
    expect(seed).not.toMatch(/shawarmania-local/)
    expect(seed).toContain('{{seed.password}}')
    expect(seed).toContain('{{seed.if_empty}}')
    expect(seed).toMatch(/create_billing_order\(/)
    expect(seed).toMatch(/pay_billing_order\(/)
  })
})
