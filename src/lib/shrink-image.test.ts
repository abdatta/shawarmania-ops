import { describe, expect, it } from 'vitest'

import { fittedSize, PICTURE_LONG_SIDE } from './shrink-image'

/**
 * The size a campaign's picture is drawn at before upload (task 3.2). The
 * drawing itself is the browser's canvas, which jsdom has not got; it is seen
 * in the authenticated browser test, which uploads a picture through it.
 */
describe('fittedSize', () => {
  it('brings a phone photo’s longer side down to 1,600, keeping its shape', () => {
    expect(fittedSize(4032, 3024, PICTURE_LONG_SIDE)).toEqual({ width: 1600, height: 1200 })
    expect(fittedSize(3024, 4032, PICTURE_LONG_SIDE)).toEqual({ width: 1200, height: 1600 })
  })

  it('never makes a small picture larger', () => {
    expect(fittedSize(800, 600, PICTURE_LONG_SIDE)).toEqual({ width: 800, height: 600 })
  })

  it('keeps a very thin picture at least a pixel wide', () => {
    expect(fittedSize(10000, 2, PICTURE_LONG_SIDE)).toEqual({ width: 1600, height: 1 })
  })
})
