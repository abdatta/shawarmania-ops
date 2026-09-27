import { describe, expect, it } from 'vitest'

import { findEncodingFaults } from './check-encoding.mjs'

/**
 * Plain ASCII, every sample built from escapes, so this file stays clean text
 * itself however a tool rewrites it (see the note in check-encoding.mjs).
 * `mangle` is exactly the round trip that produced the faults this check exists
 * for: UTF-8 bytes read back one byte per character as Windows-1252.
 */
const CP1252 = new TextDecoder('windows-1252')
const mangle = (text) => CP1252.decode(new TextEncoder().encode(text))
const file = (text) => Buffer.from(text, 'utf8')

describe('source text encoding', () => {
  it('accepts clean UTF-8, dashes, the rupee sign and the middle dot included', () => {
    expect(findEncodingFaults(file('3\u201330 \u2014 \u20b93,750 \u00b7 15 Aug\n'))).toEqual([])
  })

  it('names the line of a mangled en dash: the Team username hint', () => {
    const faults = findEncodingFaults(file(`first\n${mangle('3\u201330 lowercase letters')}\n`))
    expect(faults).toEqual([{ line: 2, reason: expect.stringMatching(/mojibake/) }])
  })

  it('catches a mangled em dash, middle dot, and accented letter alike', () => {
    for (const intended of ['undone \u2014 it', '15 Aug \u00b7 Hyperpure', 'caf\u00e9']) {
      expect(findEncodingFaults(file(mangle(intended))), intended).toHaveLength(1)
    }
  })

  it('refuses a byte-order mark', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), file('import x\n')])
    expect(findEncodingFaults(bytes)).toEqual([
      { line: 1, reason: 'starts with a byte-order mark' },
    ])
  })

  it('lets a line that documents the fault say so', () => {
    const line = `turning \u00b7 into ${mangle('\u00b7')} (encoding-check: allow)`
    expect(findEncodingFaults(file(line))).toEqual([])
  })

  it('skips binary files', () => {
    expect(findEncodingFaults(Buffer.from([0x89, 0x50, 0x00, 0xc3, 0xa9]))).toEqual([])
  })
})
