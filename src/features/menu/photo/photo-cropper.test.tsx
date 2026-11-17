import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { MenuPhotoCrop } from '@/data-access/adapters'

import { maxZoom, MIN_CROP_LONG_SIDE, type ImageSize } from './crop-geometry'
import { PhotoCropper, type PhotoFraming } from './photo-cropper'

/**
 * The cropper (a-dish-can-show-its-photo, task 2.3). jsdom lays nothing out, so
 * the stage stands in at 360 × 360 and every claim is read off the positions
 * the cropper itself gives the photo and the frame.
 */

const landscape: ImageSize = { width: 2560, height: 1920 }
const portrait: ImageSize = { width: 1920, height: 2560 }

function renderCropper(image: ImageSize = landscape, initial?: PhotoFraming) {
  const onDone = vi.fn<(framing: PhotoFraming) => void>()
  const onCancel = vi.fn()
  render(
    <PhotoCropper
      open
      imageUrl="blob:photo"
      image={image}
      initial={initial}
      onCancel={onCancel}
      onDone={onDone}
    />,
  )
  return { onDone, onCancel, user: userEvent.setup() }
}

const px = (value: string) => Number.parseFloat(value)

/** The part of the photo the frame shows, read off the page, in the photo's pixels. */
function shown(image: ImageSize): MenuPhotoCrop {
  const img = screen.getByTestId('crop-image')
  const frame = screen.getByTestId('crop-frame')
  const scale = px(img.style.width) / image.width
  const x = (px(frame.style.left) - px(img.style.left)) / scale
  const y = (px(frame.style.top) - px(img.style.top)) / scale
  const w = px(frame.style.width) / scale
  const h = px(frame.style.height) / scale
  return { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height }
}

function expectCovered(image: ImageSize) {
  const crop = shown(image)
  expect(crop.x).toBeGreaterThanOrEqual(-1e-6)
  expect(crop.y).toBeGreaterThanOrEqual(-1e-6)
  expect(crop.x + crop.w).toBeLessThanOrEqual(1 + 1e-6)
  expect(crop.y + crop.h).toBeLessThanOrEqual(1 + 1e-6)
}

function expectSameCrop(actual: MenuPhotoCrop, expected: MenuPhotoCrop) {
  for (const side of ['x', 'y', 'w', 'h'] as const) {
    expect(actual[side], side).toBeCloseTo(expected[side], 4)
  }
}

const stage = () => screen.getByTestId('crop-stage')

function drag(dx: number, dy: number, pointerId = 1) {
  fireEvent.pointerDown(stage(), { pointerId, clientX: 200, clientY: 200 })
  fireEvent.pointerMove(stage(), { pointerId, clientX: 200 + dx, clientY: 200 + dy })
  fireEvent.pointerUp(stage(), { pointerId, clientX: 200 + dx, clientY: 200 + dy })
}

describe('PhotoCropper', () => {
  it('starts a landscape photo in 4:3 and a portrait one in 4:5', () => {
    renderCropper(landscape)
    expect(screen.getByRole('button', { name: 'Landscape 4:3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('starts a portrait photo in 4:5', () => {
    renderCropper(portrait)
    expect(screen.getByRole('button', { name: 'Portrait 4:5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const frame = screen.getByTestId('crop-frame')
    expect(px(frame.style.width) / px(frame.style.height)).toBeCloseTo(4 / 5)
  })

  it('keeps the frame’s shape and the frame’s centre when the shape changes', async () => {
    const { user } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Square 1:1' }))
    const frame = screen.getByTestId('crop-frame')
    expect(px(frame.style.width)).toBeCloseTo(px(frame.style.height))
    const crop = shown(landscape)
    expect(crop.x + crop.w / 2).toBeCloseTo(0.5)
    expect(crop.y + crop.h / 2).toBeCloseTo(0.5)
  })

  it('hands back exactly what the frames showed, after a drag, a zoom and the thumbnail', async () => {
    const { user, onDone } = renderCropper()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    drag(-60, 25)
    const large = shown(landscape)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Step 2 · Menu thumbnail')
    // The thumbnail starts as the largest square inside the large frame, on its centre.
    const startSquare = shown(landscape)
    expect(startSquare.x + startSquare.w / 2).toBeCloseTo(large.x + large.w / 2)
    expect(startSquare.h).toBeCloseTo(large.h)

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '3' } })
    drag(40, -10)
    const thumb = shown(landscape)
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    const framing = onDone.mock.calls[0]![0]
    expect(framing.aspect).toBe('4:3')
    expectSameCrop(framing.largeCrop, large)
    expectSameCrop(framing.thumbCrop, thumb)
  })

  it('cannot be dragged so far that an edge shows', () => {
    renderCropper()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.5' } })
    for (const [dx, dy] of [
      [5000, 5000],
      [-5000, -5000],
      [5000, -5000],
    ] as const) {
      drag(dx, dy)
      expectCovered(landscape)
    }
  })

  it('cannot be zoomed out past covering the frame, by slider or wheel', () => {
    renderCropper()
    const slider = screen.getByRole('slider', { name: 'Zoom' })
    expect(slider).toHaveAttribute('min', '1')
    fireEvent.wheel(stage(), { deltaY: 5000, clientX: 180, clientY: 180 })
    expectCovered(landscape)
    expect(shown(landscape).w).toBeCloseTo(1)
  })

  it('stops zooming where the framing would be under 400 px', () => {
    renderCropper()
    const slider = screen.getByRole('slider', { name: 'Zoom' })
    expect(Number(slider.getAttribute('max'))).toBeCloseTo(maxZoom(landscape, 4 / 3))
    fireEvent.wheel(stage(), { deltaY: -50000, clientX: 180, clientY: 180 })
    expect(shown(landscape).w * landscape.width).toBeCloseTo(MIN_CROP_LONG_SIDE)
  })

  it('zooms with a pinch', () => {
    renderCropper()
    const before = shown(landscape).w
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 150, clientY: 180 })
    fireEvent.pointerDown(stage(), { pointerId: 2, clientX: 210, clientY: 180 })
    fireEvent.pointerMove(stage(), { pointerId: 2, clientX: 270, clientY: 180 })
    expect(shown(landscape).w).toBeCloseTo(before / 2, 2)
    expectCovered(landscape)
  })

  it('moves with the arrow keys and zooms with plus and minus', async () => {
    const { user } = renderCropper()
    stage().focus()
    await user.keyboard('++')
    const zoomed = shown(landscape)
    expect(zoomed.w).toBeLessThan(1)
    await user.keyboard('{ArrowLeft}')
    // Sliding the photo left brings more of its right side into the frame.
    expect(shown(landscape).x).toBeGreaterThan(zoomed.x)
    await user.keyboard('-')
    expect(shown(landscape).w).toBeGreaterThan(zoomed.w)
  })

  it('shows the rule-of-thirds grid only while a finger is down', () => {
    renderCropper()
    expect(screen.queryByTestId('crop-grid')).not.toBeInTheDocument()
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 100, clientY: 100 })
    expect(screen.getAllByTestId('crop-grid')).toHaveLength(2)
    fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 100, clientY: 100 })
    expect(screen.queryByTestId('crop-grid')).not.toBeInTheDocument()
  })

  it('goes Back from the thumbnail to the large photo, and Back from there cancels', async () => {
    const { user, onCancel, onDone } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Step 1 · Large photo')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('reopens at the saved shape and framings for Adjust', async () => {
    const saved: PhotoFraming = {
      aspect: '4:5',
      largeCrop: { x: 0.3, y: 0.1, w: 0.45, h: 0.75 },
      thumbCrop: { x: 0.4, y: 0.3, w: 0.3, h: 0.4 },
    }
    const { user, onDone } = renderCropper(landscape, saved)
    expect(screen.getByRole('button', { name: 'Portrait 4:5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expectSameCrop(shown(landscape), saved.largeCrop)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expectSameCrop(shown(landscape), saved.thumbCrop)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[0]![0].largeCrop, saved.largeCrop)
    expectSameCrop(onDone.mock.calls[0]![0].thumbCrop, saved.thumbCrop)
  })

  it('re-centres the thumbnail when the large framing changed since', async () => {
    const saved: PhotoFraming = {
      aspect: '4:3',
      largeCrop: { x: 0, y: 0, w: 1, h: 1 },
      thumbCrop: { x: 0, y: 0, w: 0.2, h: 0.2667 },
    }
    const { user } = renderCropper(landscape, saved)
    drag(10, 0)
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    const large = shown(landscape)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const square = shown(landscape)
    expect(square.x + square.w / 2).toBeCloseTo(large.x + large.w / 2)
  })
})
