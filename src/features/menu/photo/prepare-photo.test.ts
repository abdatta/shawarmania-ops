import { describe, expect, it } from 'vitest'

import {
  drawScaled,
  isSmallCrop,
  largeSize,
  prepareOriginal,
  renderPhoto,
  type ImageToolkit,
  type PhotoCanvas,
  type Raster,
} from './prepare-photo'

/**
 * The image preparation module (a-dish-can-show-its-photo, task 2.2), against a
 * pretend canvas that records what was drawn and how it was encoded. A "photo"
 * here is a blob naming its own size, which is all the decoder needs to read.
 */

interface Draw {
  from: Raster
  source: [number, number, number, number]
  to: [number, number]
  quality: ImageSmoothingQuality
}

function fakeToolkit({ webp = true } = {}) {
  const draws: Draw[] = []
  const encodes: { type: string; quality: number; width: number; height: number }[] = []
  const toolkit: ImageToolkit = {
    async decode(blob) {
      const { width, height } = JSON.parse(await blob.text()) as Raster
      return { width, height }
    },
    createCanvas(width, height) {
      const canvas: PhotoCanvas = {
        width,
        height,
        getContext: () => {
          const ctx = {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low' as ImageSmoothingQuality,
            drawImage(
              from: Raster,
              sx: number,
              sy: number,
              sw: number,
              sh: number,
              _dx: number,
              _dy: number,
              dw: number,
              dh: number,
            ) {
              draws.push({
                from,
                source: [sx, sy, sw, sh],
                to: [dw, dh],
                quality: ctx.imageSmoothingQuality,
              })
            },
          }
          return ctx
        },
        toBlob(callback, type, quality) {
          const actual = type === 'image/webp' && !webp ? 'image/png' : type
          encodes.push({ type: actual, quality, width, height })
          callback(new Blob([`${actual}:${width}x${height}:${quality}`], { type: actual }))
        },
      }
      return canvas
    },
    sha256: (bytes) => crypto.subtle.digest('SHA-256', bytes),
  }
  return { toolkit, draws, encodes }
}

const photo = (width: number, height: number) => new Blob([JSON.stringify({ width, height })])

describe('preparing a dish photo', () => {
  it('keeps a portrait camera photo at 2560 px on its long side, upright, as WebP 0.92', async () => {
    const { toolkit, encodes } = fakeToolkit()
    const original = await prepareOriginal(photo(3024, 4032), toolkit)
    expect([original.width, original.height]).toEqual([1920, 2560])
    expect(original.format).toBe('webp')
    expect(encodes.at(-1)).toMatchObject({ type: 'image/webp', quality: 0.92 })
    expect(original.key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps a landscape photo at 2560 px wide', async () => {
    const { toolkit } = fakeToolkit()
    const original = await prepareOriginal(photo(4000, 3000), toolkit)
    expect([original.width, original.height]).toEqual([2560, 1920])
  })

  it('never scales a small photo up', async () => {
    const { toolkit } = fakeToolkit()
    const original = await prepareOriginal(photo(640, 480), toolkit)
    expect([original.width, original.height]).toEqual([640, 480])
  })

  it('falls back to JPEG at the same quality where the canvas cannot encode WebP', async () => {
    const { toolkit, encodes } = fakeToolkit({ webp: false })
    const original = await prepareOriginal(photo(2000, 2000), toolkit)
    expect(original.format).toBe('jpeg')
    expect(original.blob.type).toBe('image/jpeg')
    expect(encodes.at(-1)).toMatchObject({ type: 'image/jpeg', quality: 0.92 })

    const rendered = await renderPhoto(
      photo(2000, 2000),
      '1:1',
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
      toolkit,
    )
    expect(rendered.large.format).toBe('jpeg')
    expect(rendered.thumb.format).toBe('jpeg')
  })

  it.each([
    ['4:3', [2560, 1920], [1600, 1200]],
    ['1:1', [2560, 2560], [1600, 1600]],
    ['4:5', [2048, 2560], [1280, 1600]],
  ] as const)(
    'cuts the large photo in %s at 1600 px, quality 0.92',
    async (aspect, [width, height], size) => {
      const { toolkit, encodes } = fakeToolkit()
      const rendered = await renderPhoto(
        photo(width, height),
        aspect,
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        toolkit,
      )
      expect([rendered.large.width, rendered.large.height]).toEqual(size)
      expect(encodes.find((e) => e.width === size[0] && e.height === size[1])).toMatchObject({
        type: 'image/webp',
        quality: 0.92,
      })
    },
  )

  it('cuts the thumbnail at 400 × 400, quality 0.90, from its own framing', async () => {
    const { toolkit, draws, encodes } = fakeToolkit()
    const rendered = await renderPhoto(
      photo(2560, 1920),
      '4:3',
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.5, y: 0.25, w: 0.375, h: 0.5 },
      toolkit,
    )
    expect([rendered.thumb.width, rendered.thumb.height]).toEqual([400, 400])
    expect(encodes.at(-1)).toMatchObject({ width: 400, height: 400, quality: 0.9 })
    // The first draw of the thumbnail reads exactly its framing from the original.
    const thumbFirst = draws.find((d) => d.source[0] === 1280)
    expect(thumbFirst?.source).toEqual([1280, 480, 960, 960])
  })

  it('cuts a framing at the photo’s edges exactly', async () => {
    const { toolkit, draws } = fakeToolkit()
    await renderPhoto(
      photo(2000, 1000),
      '1:1',
      { x: 0.5, y: 0, w: 0.5, h: 1 },
      { x: 0, y: 0, w: 0.5, h: 1 },
      toolkit,
    )
    const fromOriginal = draws.filter((d) => d.from.width === 2000)
    expect(fromOriginal.map((d) => d.source)).toEqual([
      [1000, 0, 1000, 1000],
      [0, 0, 1000, 1000],
    ])
  })

  it('never scales a small framing up', async () => {
    const { toolkit } = fakeToolkit()
    const rendered = await renderPhoto(
      photo(600, 450),
      '4:3',
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 0.5, h: 0.6667 },
      toolkit,
    )
    expect([rendered.large.width, rendered.large.height]).toEqual([600, 450])
    expect(rendered.thumb.width).toBe(300)
  })

  it('names the pair by the large photo and the thumbnail together', async () => {
    const { toolkit } = fakeToolkit()
    const render = (thumbX: number) =>
      renderPhoto(
        photo(2560, 1920),
        '4:3',
        { x: 0, y: 0, w: 1, h: 1 },
        { x: thumbX, y: 0, w: 0.25, h: 1 / 3 },
        toolkit,
      )
    const a = await render(0)
    const same = await render(0)
    // A thumbnail of another size gives other bytes, and so another key.
    const other = await renderPhoto(
      photo(2560, 1920),
      '4:3',
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 0.1, h: 0.1333 },
      toolkit,
    )
    expect(a.key).toBe(same.key)
    expect(a.key).not.toBe(other.key)
    expect(a.key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('halves in steps when shrinking by more than half, drawing at high quality', () => {
    const { toolkit, draws } = fakeToolkit()
    drawScaled(toolkit, { width: 2560, height: 2560 }, { x: 0, y: 0, w: 2560, h: 2560 }, 400, 400)
    expect(draws.map((d) => d.to)).toEqual([
      [1280, 1280],
      [640, 640],
      [400, 400],
    ])
    expect(draws.every((d) => d.quality === 'high')).toBe(true)
  })

  it('draws once when shrinking by half or less', () => {
    const { toolkit, draws } = fakeToolkit()
    drawScaled(toolkit, { width: 3200, height: 2400 }, { x: 0, y: 0, w: 3200, h: 2400 }, 1600, 1200)
    expect(draws).toHaveLength(1)
  })

  it('warns when the large framing is under 800 px on its long side', () => {
    expect(isSmallCrop({ x: 0, y: 0, w: 0.3, h: 0.3 }, { width: 2560, height: 1920 })).toBe(true)
    expect(isSmallCrop({ x: 0, y: 0, w: 0.32, h: 0.32 }, { width: 2560, height: 1920 })).toBe(false)
  })

  it('sizes a crop smaller than 1600 at its own pixels, keeping the shape', () => {
    expect(largeSize(1000, 1250, '4:5')).toEqual({ width: 1000, height: 1250 })
    expect(largeSize(640, 480, '4:3')).toEqual({ width: 640, height: 480 })
    expect(largeSize(4000, 3000, '4:3')).toEqual({ width: 1600, height: 1200 })
  })
})
