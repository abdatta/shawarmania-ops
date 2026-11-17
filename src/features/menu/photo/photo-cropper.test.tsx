import { fireEvent, render, screen, within } from '@testing-library/react'
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

/** The dashed thumbnail square inside the frame, in the photo's own fractions. */
function thumbnailShown(image: ImageSize): MenuPhotoCrop {
  const frame = shown(image)
  const box = screen.getByTestId('crop-frame')
  const square = screen.getByTestId('crop-thumbnail')
  const perPixelX = frame.w / px(box.style.width)
  const perPixelY = frame.h / px(box.style.height)
  return {
    x: frame.x + px(square.style.left) * perPixelX,
    y: frame.y + px(square.style.top) * perPixelY,
    w: px(square.style.width) * perPixelX,
    h: px(square.style.height) * perPixelY,
  }
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
  it('names each shape in a word with its outline, the ratio for screen readers', () => {
    renderCropper(landscape)
    const tabs = within(screen.getByRole('group', { name: 'Shape' })).getAllByRole('button')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Wide', 'Square', 'Tall'])
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Wide, 4:3',
      'Square, 1:1',
      'Tall, 4:5',
    ])
    for (const aspect of ['4:3', '1:1', '4:5']) {
      expect(screen.getByTestId(`shape-outline-${aspect}`)).toBeInTheDocument()
    }
    expect(screen.queryByText(/4:3|1:1|4:5/)).not.toBeInTheDocument()
  })

  it('starts a landscape photo Wide', () => {
    renderCropper(landscape)
    expect(screen.getByRole('button', { name: 'Wide, 4:3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('starts a portrait photo Tall', () => {
    renderCropper(portrait)
    expect(screen.getByRole('button', { name: 'Tall, 4:5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const frame = screen.getByTestId('crop-frame')
    expect(px(frame.style.width) / px(frame.style.height)).toBeCloseTo(4 / 5)
  })

  it('keeps the frame’s shape and the frame’s centre when the shape changes', async () => {
    const { user } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Square, 1:1' }))
    const frame = screen.getByTestId('crop-frame')
    expect(px(frame.style.width)).toBeCloseTo(px(frame.style.height))
    const crop = shown(landscape)
    expect(crop.x + crop.w / 2).toBeCloseTo(0.5)
    expect(crop.y + crop.h / 2).toBeCloseTo(0.5)
  })

  it('makes both pictures from one framing: Done, with the thumbnail the dashed square', async () => {
    const { user, onDone } = renderCropper()
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Frame the photo')
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    drag(-60, 25)
    const large = shown(landscape)
    const dashed = thumbnailShown(landscape)
    // The dashed square is the largest square inside the frame, on its centre.
    expect(dashed.h).toBeCloseTo(large.h)
    expect(dashed.x + dashed.w / 2).toBeCloseTo(large.x + large.w / 2)
    expect(within(screen.getByTestId('crop-thumbnail')).getByText('Thumbnail')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    const framing = onDone.mock.calls[0]![0]
    expect(framing.aspect).toBe('4:3')
    expectSameCrop(framing.largeCrop, large)
    expectSameCrop(framing.thumbCrop, dashed)
  })

  it('frames the thumbnail separately, handing back exactly what its frame showed', async () => {
    const { user, onDone } = renderCropper()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.5' } })
    const large = shown(landscape)
    const dashed = thumbnailShown(landscape)

    await user.click(screen.getByRole('button', { name: 'Frame the thumbnail separately ›' }))
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Thumbnail')
    expect(screen.queryByRole('group', { name: 'Shape' })).not.toBeInTheDocument()
    // It starts on the dashed square.
    expectSameCrop(shown(landscape), dashed)

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '3' } })
    drag(40, -10)
    const thumb = shown(landscape)
    await user.click(screen.getByRole('button', { name: 'Done' }))

    const framing = onDone.mock.calls[0]![0]
    expectSameCrop(framing.largeCrop, large)
    expectSameCrop(framing.thumbCrop, thumb)
  })

  it('keeps a separately framed thumbnail when the frame moves, until Match the photo', async () => {
    const { user, onDone } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Frame the thumbnail separately ›' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2.5' } })
    drag(30, 30)
    const thumb = shown(landscape)
    await user.click(screen.getByRole('button', { name: 'Back' }))

    // Back on the frame: no dashed square, and the link says the thumbnail is its own.
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Frame the photo')
    expect(screen.queryByTestId('crop-thumbnail')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change the thumbnail ›' })).toBeVisible()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.8' } })
    drag(-80, 0)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[0]![0].thumbCrop, thumb)

    // Match the photo puts it back inside the frame.
    await user.click(screen.getByRole('button', { name: 'Change the thumbnail ›' }))
    await user.click(screen.getByRole('button', { name: 'Match the photo' }))
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Frame the photo')
    const dashed = thumbnailShown(landscape)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[1]![0].thumbCrop, dashed)
  })

  it('leaves the thumbnail following the frame when its step is opened and left alone', async () => {
    const { user, onDone } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Frame the thumbnail separately ›' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('crop-thumbnail')).toBeInTheDocument()
    drag(-100, 0)
    const dashed = thumbnailShown(landscape)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[0]![0].thumbCrop, dashed)
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

  it('goes Back from the thumbnail to the frame, and Back from there cancels', async () => {
    const { user, onCancel, onDone } = renderCropper()
    await user.click(screen.getByRole('button', { name: 'Frame the thumbnail separately ›' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('cropper-title')).toHaveTextContent('Frame the photo')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('reopens at a saved shape and framing whose thumbnail follows it', async () => {
    const saved: PhotoFraming = {
      aspect: '4:5',
      largeCrop: { x: 0.3, y: 0.1, w: 0.45, h: 0.75 },
      // The largest square inside it, centred: 1152 px wide, so 1152 x 1152.
      thumbCrop: { x: 0.3, y: 0.175, w: 0.45, h: 0.6 },
    }
    const { user, onDone } = renderCropper(landscape, saved)
    expect(screen.getByRole('button', { name: 'Tall, 4:5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expectSameCrop(shown(landscape), saved.largeCrop)
    expectSameCrop(thumbnailShown(landscape), saved.thumbCrop)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[0]![0].largeCrop, saved.largeCrop)
    expectSameCrop(onDone.mock.calls[0]![0].thumbCrop, saved.thumbCrop)
  })

  it('reopens a separately framed thumbnail as the manager’s, kept as the frame moves', async () => {
    const saved: PhotoFraming = {
      aspect: '4:3',
      largeCrop: { x: 0, y: 0, w: 1, h: 1 },
      thumbCrop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    }
    const { user, onDone } = renderCropper(landscape, saved)
    expect(screen.queryByTestId('crop-thumbnail')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    drag(10, 0)
    await user.click(screen.getByRole('button', { name: 'Change the thumbnail ›' }))
    expectSameCrop(shown(landscape), saved.thumbCrop)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expectSameCrop(onDone.mock.calls[0]![0].thumbCrop, saved.thumbCrop)
  })
})
