import type { MenuPhotoAspect, MenuPhotoCrop } from '@/data-access/adapters'

/**
 * The cropper's geometry (a-dish-can-show-its-photo, design D5), kept apart
 * from the screen so every rule is a plain function a test can hold to.
 *
 * **The state is the framing itself**, a rectangle in the kept original's own
 * pixels. The frame on screen only decides how large that rectangle is drawn,
 * so turning the phone or resizing a window never moves what is framed, and
 * what the frame shows is, by construction, what is cut.
 *
 * Three rules hold for every rectangle these functions return:
 *
 * - it has the shape asked for;
 * - it lies inside the photo, so the photo always covers the frame;
 * - its long side is at least {@link MIN_CROP_LONG_SIDE} pixels, unless the
 *   photo itself is smaller, so a large photo cannot be zoomed into mush.
 */

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ImageSize {
  width: number
  height: number
}

/** The zoom stop: a framing is never cut from fewer pixels than this on its long side. */
export const MIN_CROP_LONG_SIDE = 400

/** Width over height for each large-photo shape. */
export const ASPECT_RATIO: Record<MenuPhotoAspect, number> = {
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
}

/** The shapes in the order the cropper offers them. */
export const ASPECTS: readonly MenuPhotoAspect[] = ['4:3', '1:1', '4:5']

/** Step 1's starting shape: portrait for a portrait photo, landscape otherwise. */
export function defaultAspect(image: ImageSize): MenuPhotoAspect {
  return image.height > image.width ? '4:5' : '4:3'
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high))

/** The largest rectangle of this shape the photo can fill: zoom 1. */
export function coverSize(image: ImageSize, ratio: number): { w: number; h: number } {
  if (image.width / image.height > ratio) {
    return { w: image.height * ratio, h: image.height }
  }
  return { w: image.width, h: image.width / ratio }
}

/** The narrowest a framing of this shape may get: the zoom stop. */
export function minCropWidth(image: ImageSize, ratio: number): number {
  const cover = coverSize(image, ratio).w
  const atStop = ratio >= 1 ? MIN_CROP_LONG_SIDE : MIN_CROP_LONG_SIDE * ratio
  return Math.min(atStop, cover)
}

/** How far in the photo can zoom for this shape; 1 when it is already small. */
export function maxZoom(image: ImageSize, ratio: number): number {
  return coverSize(image, ratio).w / minCropWidth(image, ratio)
}

/** 1 is the whole photo across the frame; larger is closer. */
export function zoomOf(rect: CropRect, image: ImageSize, ratio: number): number {
  return coverSize(image, ratio).w / rect.w
}

/**
 * The nearest framing that keeps every rule: the shape, inside the photo,
 * within the zoom range. Its centre stays where it was wherever it can.
 */
export function clampCrop(rect: CropRect, image: ImageSize, ratio: number): CropRect {
  const w = clamp(rect.w, minCropWidth(image, ratio), coverSize(image, ratio).w)
  const h = Math.min(w / ratio, image.height)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return {
    x: clamp(cx - w / 2, 0, image.width - w),
    y: clamp(cy - h / 2, 0, image.height - h),
    w,
    h,
  }
}

/** A framing at a zoom level, centred on a point of the photo (its centre by default). */
export function centredCrop(
  image: ImageSize,
  ratio: number,
  zoom = 1,
  centre: { x: number; y: number } = { x: image.width / 2, y: image.height / 2 },
): CropRect {
  const w = coverSize(image, ratio).w / zoom
  const h = w / ratio
  return clampCrop({ x: centre.x - w / 2, y: centre.y - h / 2, w, h }, image, ratio)
}

/** Move the photo's framing by a distance in the photo's own pixels. */
export function panCrop(
  rect: CropRect,
  dx: number,
  dy: number,
  image: ImageSize,
  ratio: number,
): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, image, ratio)
}

/**
 * Zoom to a level, keeping one point of the frame still: `anchor` is that
 * point as a fraction of the frame (the middle by default), which is where a
 * pinch's fingers or the mouse pointer are.
 */
export function zoomCrop(
  rect: CropRect,
  zoom: number,
  image: ImageSize,
  ratio: number,
  anchor: { x: number; y: number } = { x: 0.5, y: 0.5 },
): CropRect {
  const w = clamp(
    coverSize(image, ratio).w / zoom,
    minCropWidth(image, ratio),
    coverSize(image, ratio).w,
  )
  const h = w / ratio
  const px = rect.x + anchor.x * rect.w
  const py = rect.y + anchor.y * rect.h
  const x = px - anchor.x * w
  const y = py - anchor.y * h
  // Re-centred on the result so clampCrop keeps this position where it can.
  return clampCrop({ x, y, w, h }, image, ratio)
}

/** A new shape for the same framing: the same centre and the same zoom level. */
export function reshapeCrop(rect: CropRect, from: number, to: number, image: ImageSize): CropRect {
  return centredCrop(image, to, zoomOf(rect, image, from), {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  })
}

/** Step 2's starting square: the largest one inside step 1's framing, on its centre. */
export function squareWithin(rect: CropRect, image: ImageSize): CropRect {
  const side = Math.min(rect.w, rect.h)
  return clampCrop(
    {
      x: rect.x + (rect.w - side) / 2,
      y: rect.y + (rect.h - side) / 2,
      w: side,
      h: side,
    },
    image,
    1,
  )
}

/** A framing as the fractions it is saved in. */
export function toFractions(rect: CropRect, image: ImageSize): MenuPhotoCrop {
  return {
    x: rect.x / image.width,
    y: rect.y / image.height,
    w: rect.w / image.width,
    h: rect.h / image.height,
  }
}

/** A saved framing back on this photo, made to keep every rule. */
export function fromFractions(crop: MenuPhotoCrop, image: ImageSize, ratio: number): CropRect {
  return clampCrop(
    {
      x: crop.x * image.width,
      y: crop.y * image.height,
      w: crop.w * image.width,
      h: crop.h * image.height,
    },
    image,
    ratio,
  )
}

/**
 * The frame's size on screen: the largest rectangle of the shape that fits the
 * stage with room around it to see what is cut off.
 */
export function frameSize(stage: ImageSize, ratio: number, margin = 24): ImageSize {
  const width = Math.max(1, stage.width - margin * 2)
  const height = Math.max(1, stage.height - margin * 2)
  if (width / height > ratio) return { width: height * ratio, height }
  return { width, height: width / ratio }
}
