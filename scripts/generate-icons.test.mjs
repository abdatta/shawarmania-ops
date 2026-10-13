// @vitest-environment node
//
// Staging installs under its own icon set (a-release-can-be-switched-off, D19):
// the same mark recoloured, derived the same way. These pin that the two sets
// stay twins in everything but colour, so replacing the production master
// without recolouring the staging one fails here rather than on a home screen.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decodePng } from './lib/png.mjs'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))
const png = (relative) => decodePng(readFileSync(path(relative)))
const PRODUCTION = '../public/icons/'
const STAGING = '../public/icons/staging/'
const pngs = (dir) =>
  readdirSync(path(dir))
    .filter((name) => name.endsWith('.png'))
    .sort()

describe('the staging icon set', () => {
  const production = png('../assets/brand/shawarmania-mark-512.png')
  const staging = png('../assets/brand/shawarmania-mark-staging-512.png')

  it('has a master with exactly the production master’s silhouette', () => {
    expect([staging.width, staging.height]).toEqual([production.width, production.height])
    let differing = 0
    for (let i = 3; i < production.data.length; i += 4) {
      if (production.data[i] !== staging.data[i]) differing++
    }
    expect(differing).toBe(0)
  })

  it('recolours the mark, so the two masters do not match', () => {
    let changed = 0
    for (let i = 0; i < production.data.length; i += 4) {
      if (
        production.data[i] !== staging.data[i] ||
        production.data[i + 1] !== staging.data[i + 1] ||
        production.data[i + 2] !== staging.data[i + 2]
      ) {
        changed++
      }
    }
    // The mark covers roughly a third of the canvas; the field is untouched.
    expect(changed).toBeGreaterThan(production.width * production.height * 0.15)
    expect(changed).toBeLessThan(production.width * production.height * 0.5)
  })

  it('derives every production icon, at the same size, for staging', () => {
    expect(pngs(STAGING)).toEqual(pngs(PRODUCTION))
    for (const name of pngs(PRODUCTION)) {
      const a = png(PRODUCTION + name)
      const b = png(STAGING + name)
      expect([b.width, b.height], name).toEqual([a.width, a.height])
      expect(Buffer.from(b.data).equals(Buffer.from(a.data)), name).toBe(false)
    }
  })
})
