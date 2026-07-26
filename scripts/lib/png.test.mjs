// @vitest-environment node
//
// Both the encoder and the decoder are hand-rolled, and both are easy to get
// quietly wrong in ways that surface only as a corrupted icon on a home screen.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canvas, decodePng, drawOnto, encodePng, flatten, pixelAt, resize } from './png.mjs'

const MASTER = fileURLToPath(
  new URL('../../assets/brand/shawarmania-mark-512.png', import.meta.url),
)

/** A small image with known pixels, including partial and full transparency. */
function fixture() {
  const data = new Uint8Array(4 * 4 * 4)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4
      data[i] = x * 60
      data[i + 1] = y * 60
      data[i + 2] = 128
      data[i + 3] = x === 0 ? 0 : 255
    }
  }
  return { width: 4, height: 4, data }
}

describe('encode/decode round-trip', () => {
  it('preserves every pixel exactly', () => {
    const original = fixture()
    const decoded = decodePng(encodePng(original))

    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect(Array.from(decoded.data)).toEqual(Array.from(original.data))
  })

  it('survives a second round-trip', () => {
    const once = decodePng(encodePng(fixture()))
    const twice = decodePng(encodePng(once))
    expect(Array.from(twice.data)).toEqual(Array.from(once.data))
  })
})

describe('decodePng', () => {
  it('reads the committed brand master', () => {
    const master = decodePng(readFileSync(MASTER))
    expect(master.width).toBe(512)
    expect(master.height).toBe(512)
    expect(master.data.length).toBe(512 * 512 * 4)
  })

  it('rejects a non-PNG', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/Not a PNG/)
  })
})

describe('resize', () => {
  it('produces the requested dimensions', () => {
    const small = resize(decodePng(readFileSync(MASTER)), 64, 64)
    expect(small.width).toBe(64)
    expect(small.height).toBe(64)
    expect(small.data.length).toBe(64 * 64 * 4)
  })

  it('keeps a solid colour solid rather than smearing it', () => {
    const solid = canvas(8, [200, 100, 50])
    const shrunk = resize(solid, 4, 4)
    for (let i = 0; i < shrunk.data.length; i += 4) {
      expect([shrunk.data[i], shrunk.data[i + 1], shrunk.data[i + 2]]).toEqual([200, 100, 50])
    }
  })

  it('does not pull transparent pixels into opaque edges', () => {
    // Left column fully transparent but coloured; averaging straight RGBA
    // would drag that colour into the neighbouring opaque pixels.
    const shrunk = resize(fixture(), 2, 2)
    const [, , , alpha] = pixelAt(shrunk, 0, 0)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(255)
  })
})

describe('flatten and drawOnto', () => {
  it('composites transparency onto the background', () => {
    const flat = flatten(fixture(), [0, 0, 0])
    // The fully transparent column becomes the background exactly.
    expect(pixelAt(flat, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(flat, 1, 0)[3]).toBe(255)
  })

  it('draws a source into the middle of a canvas', () => {
    const target = canvas(8, [0, 0, 0])
    const source = canvas(4, [255, 255, 255])
    drawOnto(target, source, 2, 2)

    expect(pixelAt(target, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(target, 4, 4)).toEqual([255, 255, 255, 255])
    expect(pixelAt(target, 7, 7)).toEqual([0, 0, 0, 255])
  })
})
