import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { declaredFunctions, findFunctionConfigDrift } from './check-edge-functions.mjs'

/**
 * The rule is pure, so most of this drives it with literals. The last block
 * runs it against the real tree, which is what would have failed on 2026-08-09
 * had a function been added without its configuration.
 */

const CONFIG = `
[edge_runtime]
enabled = true

[functions.admin-accounts]
verify_jwt = true

# Deliberately open: someone who has never set a password has no token.
[functions.redeem-invite]
verify_jwt = false
`

describe('reading declarations out of the configuration', () => {
  it('reads every function table header', () => {
    expect(declaredFunctions(CONFIG)).toEqual(new Set(['admin-accounts', 'redeem-invite']))
  })

  it('does not count a commented-out block as a declaration', () => {
    // The case worth getting right: commenting a block out is how a function
    // loses its configuration without anybody deleting anything.
    expect(declaredFunctions('# [functions.counter-setup]\n# verify_jwt = false\n')).toEqual(
      new Set(),
    )
  })

  it('does not confuse another table for a function', () => {
    expect(declaredFunctions('[analytics]\nenabled = false\n[auth.email]\n')).toEqual(new Set())
  })

  it('reads a hyphenated name whole', () => {
    expect(declaredFunctions('[functions.counter-devices]\n')).toEqual(new Set(['counter-devices']))
  })
})

describe('the drift rule', () => {
  const toml = CONFIG

  it('passes when every function is declared', () => {
    expect(
      findFunctionConfigDrift({ entries: ['admin-accounts', 'redeem-invite', '_shared'], toml }),
    ).toEqual({ undeclared: [], orphaned: [] })
  })

  it('fails and names a function with no configuration block', () => {
    // The 2026-08-09 shape: a change adds a directory and nothing else.
    expect(
      findFunctionConfigDrift({
        entries: ['admin-accounts', 'redeem-invite', 'counter-setup'],
        toml,
      }).undeclared,
    ).toEqual(['counter-setup'])
  })

  it('never treats _shared as a function', () => {
    // It is bundled into each function and has no endpoint, so it must never
    // be asked for a gateway declaration. Checked against a configuration that
    // declares nothing, so a passing result cannot come from a stray block.
    expect(findFunctionConfigDrift({ entries: ['_shared'], toml: '' })).toEqual({
      undeclared: [],
      orphaned: [],
    })
  })

  it('reports a block whose function is gone', () => {
    expect(findFunctionConfigDrift({ entries: ['admin-accounts'], toml }).orphaned).toEqual([
      'redeem-invite',
    ])
  })

  it('names every offender rather than the first', () => {
    expect(
      findFunctionConfigDrift({ entries: ['counter-setup', 'counter-devices'], toml }).undeclared,
    ).toEqual(['counter-devices', 'counter-setup'])
  })
})

describe('the repository as it stands', () => {
  const entries = readdirSync(resolve(process.cwd(), 'supabase/functions'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const toml = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8')

  it('declares every function it ships', () => {
    expect(findFunctionConfigDrift({ entries, toml })).toEqual({ undeclared: [], orphaned: [] })
  })

  it('has functions to check, so the suite above is not vacuously green', () => {
    // Without this, deleting supabase/functions/ would make the check pass.
    expect(entries.filter((name) => name !== '_shared').length).toBeGreaterThan(1)
  })

  it('still declares the two functions this change was written about', () => {
    const declared = declaredFunctions(toml)
    for (const name of ['counter-devices', 'counter-setup']) {
      expect(declared.has(name), `${name} lost its configuration`).toBe(true)
    }
  })
})
