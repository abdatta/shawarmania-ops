import { describe, expect, it } from 'vitest'

import {
  ASPECT_RATIO,
  centredCrop,
  clampCrop,
  defaultAspect,
  fromFractions,
  maxZoom,
  MIN_CROP_LONG_SIDE,
  panCrop,
  reshapeCrop,
  squareWithin,
  toFractions,
  zoomCrop,
  zoomOf,
  type CropRect,
  type ImageSize,
} from './crop-geometry'

const landscape: ImageSize = { width: 2560, height: 1920 }
const portrait: ImageSize = { width: 1440, height: 2560 }
const small: ImageSize = { width: 360, height: 300 }

/** Every rule a framing must keep, checked together. */
function expectValid(rect: CropRect, image: ImageSize, ratio: number) {
  expect(rect.w / rect.h).toBeCloseTo(ratio, 6)
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9)
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9)
  expect(rect.x + rect.w).toBeLessThanOrEqual(image.width + 1e-9)
  expect(rect.y + rect.h).toBeLessThanOrEqual(image.height + 1e-9)
}

describe('crop geometry', () => {
  it('starts a portrait photo in 4:5 and anything else in 4:3', () => {
    expect(defaultAspect(portrait)).toBe('4:5')
    expect(defaultAspect(landscape)).toBe('4:3')
    expect(defaultAspect({ width: 1000, height: 1000 })).toBe('4:3')
  })

  it.each(Object.entries(ASPECT_RATIO))(
    'covers the frame at zoom 1 in %s, on any photo',
    (_, ratio) => {
      for (const image of [landscape, portrait, small]) {
        const rect = centredCrop(image, ratio)
        expectValid(rect, image, ratio)
        // Zoom 1 touches two opposite edges of the photo.
        expect(
          Math.abs(rect.w - image.width) < 1e-6 || Math.abs(rect.h - image.height) < 1e-6,
        ).toBe(true)
      }
    },
  )

  it('cannot be dragged off the photo, however far it is dragged', () => {
    const ratio = ASPECT_RATIO['4:3']
    const start = centredCrop(landscape, ratio, 2)
    for (const [dx, dy] of [
      [-99999, -99999],
      [99999, 99999],
      [99999, -99999],
    ] as const) {
      expectValid(panCrop(start, dx, dy, landscape, ratio), landscape, ratio)
    }
    const corner = panCrop(start, 99999, 99999, landscape, ratio)
    expect(corner.x + corner.w).toBeCloseTo(landscape.width)
    expect(corner.y + corner.h).toBeCloseTo(landscape.height)
  })

  it('cannot be zoomed out past covering the frame', () => {
    const ratio = ASPECT_RATIO['4:5']
    const rect = zoomCrop(centredCrop(landscape, ratio, 3), 0.2, landscape, ratio)
    expect(zoomOf(rect, landscape, ratio)).toBeCloseTo(1)
    expectValid(rect, landscape, ratio)
  })

  it('stops zooming where the framing would be under 400 px on its long side', () => {
    for (const [aspect, ratio] of Object.entries(ASPECT_RATIO)) {
      const rect = zoomCrop(centredCrop(portrait, ratio), 1000, portrait, ratio)
      expect(Math.max(rect.w, rect.h), aspect).toBeCloseTo(MIN_CROP_LONG_SIDE)
      expect(zoomOf(rect, portrait, ratio)).toBeCloseTo(maxZoom(portrait, ratio))
    }
  })

  it('does not zoom a photo already smaller than the stop', () => {
    expect(maxZoom(small, 1)).toBe(1)
    const rect = zoomCrop(centredCrop(small, 1), 4, small, 1)
    expect(rect).toEqual(centredCrop(small, 1))
  })

  it('keeps the point under the fingers still while zooming', () => {
    const ratio = ASPECT_RATIO['4:3']
    const start = centredCrop(landscape, ratio, 1.5)
    const anchor = { x: 0.25, y: 0.75 }
    const before = { x: start.x + anchor.x * start.w, y: start.y + anchor.y * start.h }
    const after = zoomCrop(start, 2, landscape, ratio, anchor)
    expect(after.x + anchor.x * after.w).toBeCloseTo(before.x)
    expect(after.y + anchor.y * after.h).toBeCloseTo(before.y)
  })

  it('keeps the centre and the zoom when the shape changes', () => {
    const from = ASPECT_RATIO['4:3']
    const to = ASPECT_RATIO['4:5']
    const start = panCrop(centredCrop(landscape, from, 2), -300, 0, landscape, from)
    const next = reshapeCrop(start, from, to, landscape)
    expectValid(next, landscape, to)
    expect(next.x + next.w / 2).toBeCloseTo(start.x + start.w / 2)
    expect(next.y + next.h / 2).toBeCloseTo(start.y + start.h / 2)
    expect(zoomOf(next, landscape, to)).toBeCloseTo(2)
  })

  it('starts the thumbnail as the largest square inside the large framing', () => {
    const ratio = ASPECT_RATIO['4:3']
    const large = panCrop(centredCrop(landscape, ratio, 1.6), 200, 100, landscape, ratio)
    const square = squareWithin(large, landscape)
    expectValid(square, landscape, 1)
    expect(square.w).toBeCloseTo(large.h)
    expect(square.x + square.w / 2).toBeCloseTo(large.x + large.w / 2)
    expect(square.y + square.h / 2).toBeCloseTo(large.y + large.h / 2)
  })

  it('round-trips a framing through the fractions it is saved in, at the edges too', () => {
    const ratio = ASPECT_RATIO['1:1']
    for (const rect of [
      panCrop(centredCrop(portrait, ratio, 2), -9999, -9999, portrait, ratio),
      panCrop(centredCrop(portrait, ratio, 2), 9999, 9999, portrait, ratio),
      centredCrop(portrait, ratio),
    ]) {
      const fractions = toFractions(rect, portrait)
      for (const n of Object.values(fractions)) {
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(1)
      }
      const back = fromFractions(fractions, portrait, ratio)
      expect(back.x).toBeCloseTo(rect.x)
      expect(back.y).toBeCloseTo(rect.y)
      expect(back.w).toBeCloseTo(rect.w)
    }
  })

  it('mends a saved framing that no longer fits', () => {
    const ratio = ASPECT_RATIO['4:3']
    const rect = clampCrop({ x: -50, y: 1800, w: 9000, h: 10 }, landscape, ratio)
    expectValid(rect, landscape, ratio)
  })
})
