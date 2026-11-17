import type {
  MenuPhotoAspect,
  MenuPhotoCrop,
  MenuPhotoFile,
  MenuPhotoFormat,
} from '@/data-access/adapters'

/**
 * The phone's image work (a-dish-can-show-its-photo, design D4), set for
 * quality first: the files stay small only because no phone screen can show
 * more than this.
 *
 * 1. The picked photo is decoded upright and kept at up to 2560 px on its long
 *    side. That kept original is what the cropper shows and what every framing
 *    is cut from, now and on any later Adjust.
 * 2. The large photo is cut from it at up to 1600 px on its long side, the
 *    thumbnail at up to 400 × 400; neither is ever scaled up.
 * 3. Everything is WebP where the browser can encode it, JPEG otherwise, at
 *    0.92 (original and large) and 0.90 (thumbnail).
 *
 * The browser's canvas, decoder and hash come in through {@link ImageToolkit},
 * so every rule here is tested without a real canvas.
 */

export const ORIGINAL_LONG_SIDE = 2560
export const LARGE_LONG_SIDE = 1600
export const THUMB_SIDE = 400
/** Under this on its long side, a large photo may look soft when opened. */
export const SHARP_LONG_SIDE = 800
export const ORIGINAL_QUALITY = 0.92
export const LARGE_QUALITY = 0.92
export const THUMB_QUALITY = 0.9

/** Anything drawable that knows its size: a decoded bitmap or a canvas. */
export interface Raster {
  readonly width: number
  readonly height: number
}

export interface PhotoContext {
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  drawImage(
    image: Raster,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

export interface PhotoCanvas extends Raster {
  getContext(kind: '2d'): PhotoContext | null
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void
}

export interface ImageToolkit {
  /** Decode a file upright (its camera orientation applied). */
  decode(blob: Blob): Promise<Raster>
  createCanvas(width: number, height: number): PhotoCanvas
  sha256(bytes: ArrayBuffer): Promise<ArrayBuffer>
}

export class PhotoPrepareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoPrepareError'
  }
}

const UNREADABLE = 'This photo could not be read. Choose a JPEG or PNG photo.'

/** The browser's own canvas, decoder and hash. */
export const browserToolkit: ImageToolkit = {
  async decode(blob) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      // Older engines refuse the options object, and apply the camera's
      // orientation by default anyway.
      try {
        return await createImageBitmap(blob)
      } catch {
        throw new PhotoPrepareError(UNREADABLE)
      }
    }
  },
  createCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas as unknown as PhotoCanvas
  },
  sha256: (bytes) => crypto.subtle.digest('SHA-256', bytes),
}

function context(canvas: PhotoCanvas): PhotoContext {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoPrepareError('This phone could not prepare the photo.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

/**
 * Draw part of an image at a new size. Shrinking by more than half is done in
 * halving steps, so fine detail — crumbs, char marks, herbs — does not alias.
 */
export function drawScaled(
  toolkit: ImageToolkit,
  image: Raster,
  source: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): PhotoCanvas {
  let current: Raster = image
  let { x, y, w, h } = source
  while (w > width * 2 && h > height * 2) {
    const stepW = Math.max(width, Math.round(w / 2))
    const stepH = Math.max(height, Math.round(h / 2))
    const step = toolkit.createCanvas(stepW, stepH)
    context(step).drawImage(current, x, y, w, h, 0, 0, stepW, stepH)
    current = step
    x = 0
    y = 0
    w = stepW
    h = stepH
  }
  const out = toolkit.createCanvas(width, height)
  context(out).drawImage(current, x, y, w, h, 0, 0, width, height)
  return out
}

function toBlob(canvas: PhotoCanvas, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Encode as WebP, or as JPEG where the browser hands back anything else (older
 * Safari answers a WebP request with a PNG). `format` forces one, so a photo's
 * two files always share a format.
 */
export async function encode(
  canvas: PhotoCanvas,
  quality: number,
  format?: MenuPhotoFormat,
): Promise<MenuPhotoFile> {
  if (format !== 'jpeg') {
    const webp = await toBlob(canvas, 'image/webp', quality)
    if (webp?.type === 'image/webp') return { blob: webp, format: 'webp' }
  }
  const jpeg = await toBlob(canvas, 'image/jpeg', quality)
  if (!jpeg) throw new PhotoPrepareError('This phone could not prepare the photo.')
  return { blob: jpeg, format: 'jpeg' }
}

/** Lowercase hex SHA-256 over the blobs' bytes, in order. */
export async function hashOf(toolkit: ImageToolkit, ...blobs: Blob[]): Promise<string> {
  const parts = await Promise.all(blobs.map((blob) => blob.arrayBuffer()))
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(new Uint8Array(part), offset)
    offset += part.byteLength
  }
  const digest = new Uint8Array(await toolkit.sha256(bytes.buffer))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A size whose long side is at most `limit`, never larger than the original. */
export function fitWithin(width: number, height: number, limit: number) {
  const scale = Math.min(1, limit / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The large photo's pixel size: 1600 on the long side, or the crop's own if smaller. */
export function largeSize(cropWidth: number, cropHeight: number, aspect: MenuPhotoAspect) {
  const long = Math.max(1, Math.min(LARGE_LONG_SIDE, Math.round(Math.max(cropWidth, cropHeight))))
  if (aspect === '4:3') return { width: long, height: Math.round((long * 3) / 4) }
  if (aspect === '4:5') return { width: Math.round((long * 4) / 5), height: long }
  return { width: long, height: long }
}

/** The thumbnail's side: 400, or the crop's own if smaller. */
export function thumbSize(cropSide: number) {
  return Math.max(1, Math.min(THUMB_SIDE, Math.round(cropSide)))
}

/** Whether a large framing is cut from too few pixels to look sharp when opened. */
export function isSmallCrop(crop: MenuPhotoCrop, original: Raster) {
  return Math.max(crop.w * original.width, crop.h * original.height) < SHARP_LONG_SIDE - 0.5
}

export interface PreparedOriginal {
  blob: Blob
  format: MenuPhotoFormat
  key: string
  width: number
  height: number
}

/**
 * Step 1, in two halves so the cropper need not wait for the encoder: the
 * photo is decoded upright and its kept size is known at once (every framing
 * is in those pixels), while the kept original encodes behind the cropper.
 */
export async function startOriginal(
  file: Blob,
  toolkit: ImageToolkit = browserToolkit,
): Promise<{ size: { width: number; height: number }; ready: Promise<PreparedOriginal> }> {
  const image = await toolkit.decode(file)
  if (!image.width || !image.height) throw new PhotoPrepareError(UNREADABLE)
  const size = fitWithin(image.width, image.height, ORIGINAL_LONG_SIDE)
  const ready = (async () => {
    const canvas = drawScaled(
      toolkit,
      image,
      { x: 0, y: 0, w: image.width, h: image.height },
      size.width,
      size.height,
    )
    const encoded = await encode(canvas, ORIGINAL_QUALITY)
    return { ...encoded, key: await hashOf(toolkit, encoded.blob), ...size }
  })()
  // Read by Save; a picture abandoned in the cropper must not surface as an
  // unhandled rejection.
  ready.catch(() => undefined)
  return { size, ready }
}

/** The picked photo, upright, at up to 2560 px, encoded and named by its hash. */
export async function prepareOriginal(
  file: Blob,
  toolkit: ImageToolkit = browserToolkit,
): Promise<PreparedOriginal> {
  return (await startOriginal(file, toolkit)).ready
}

/** A saved original, for Adjust: its bytes and its size, read back once. */
export async function readSavedOriginal(
  url: string,
  toolkit: ImageToolkit = browserToolkit,
): Promise<{ blob: Blob; width: number; height: number }> {
  let blob: Blob
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(String(response.status))
    blob = await response.blob()
  } catch {
    throw new PhotoPrepareError('The saved photo could not be loaded. Check the connection.')
  }
  const image = await toolkit.decode(blob)
  return { blob, width: image.width, height: image.height }
}

export interface RenderedPhoto {
  key: string
  large: MenuPhotoFile & { width: number; height: number }
  thumb: MenuPhotoFile & { width: number; height: number }
}

function pixels(crop: MenuPhotoCrop, image: Raster) {
  return {
    x: crop.x * image.width,
    y: crop.y * image.height,
    w: crop.w * image.width,
    h: crop.h * image.height,
  }
}

/**
 * Steps 2 and 3: the large photo and the thumbnail, cut from the kept original
 * at the manager's framings, and the key naming the pair.
 */
export async function renderPhoto(
  original: Blob,
  aspect: MenuPhotoAspect,
  largeCrop: MenuPhotoCrop,
  thumbCrop: MenuPhotoCrop,
  toolkit: ImageToolkit = browserToolkit,
): Promise<RenderedPhoto> {
  const image = await toolkit.decode(original)
  const largeSource = pixels(largeCrop, image)
  const largeOut = largeSize(largeSource.w, largeSource.h, aspect)
  const large = await encode(
    drawScaled(toolkit, image, largeSource, largeOut.width, largeOut.height),
    LARGE_QUALITY,
  )
  const thumbSource = pixels(thumbCrop, image)
  const side = thumbSize(Math.min(thumbSource.w, thumbSource.h))
  const thumb = await encode(
    drawScaled(toolkit, image, thumbSource, side, side),
    THUMB_QUALITY,
    large.format,
  )
  return {
    key: await hashOf(toolkit, large.blob, thumb.blob),
    large: { ...large, ...largeOut },
    thumb: { ...thumb, width: side, height: side },
  }
}
