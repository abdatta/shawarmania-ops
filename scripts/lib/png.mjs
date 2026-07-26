/**
 * A minimal PNG reader/writer and image resampler.
 *
 * Hand-rolled rather than pulled from npm because the only thing that needs it
 * is one build-time step (deriving the icon set from the brand master), and an
 * image library is a large native dependency to carry for that. Scope is
 * deliberately narrow: 8-bit truecolour with alpha, non-interlaced — which is
 * what the master is — and anything else throws a clear error rather than
 * decoding subtly wrong.
 *
 * Round-tripped by png.test.mjs, because both halves are easy to get quietly
 * wrong in ways that only show up as a corrupted icon on someone's home screen.
 */

import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG')

  let offset = 8
  let header
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  if (!header) throw new Error('PNG has no IHDR')
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(
      `Unsupported PNG: bitDepth=${header.bitDepth} colorType=${header.colorType} ` +
        `interlace=${header.interlace}. This reader handles 8-bit RGBA, non-interlaced only.`,
    )
  }

  const { width, height } = header
  const bpp = 4
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const out = new Uint8Array(width * height * bpp)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dst = y * stride
    const up = dst - stride

    for (let i = 0; i < stride; i++) {
      const x = line[i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const b = y > 0 ? out[up + i] : 0
      const c = y > 0 && i >= bpp ? out[up + i - bpp] : 0

      let value
      switch (filter) {
        case 0:
          value = x
          break
        case 1:
          value = x + a
          break
        case 2:
          value = x + b
          break
        case 3:
          value = x + ((a + b) >> 1)
          break
        case 4:
          value = x + paeth(a, b, c)
          break
        default:
          throw new Error(`Unknown PNG filter type ${filter} on row ${y}`)
      }
      out[dst + i] = value & 0xff
    }
  }

  return { width, height, data: out }
}

/** Encode RGBA pixels as a PNG. Uses filter 0 throughout; icons are small. */
export function encodePng({ width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Box-filter resample.
 *
 * Averaging happens on premultiplied alpha. Averaging straight RGBA instead
 * would pull the colour of fully-transparent pixels into the edge, which on
 * this master (opaque art against transparent corners) shows up as a dark
 * halo around the rounded corners at small sizes.
 */
export function resize(image, targetWidth, targetHeight) {
  const { width, height, data } = image
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  const scaleX = width / targetWidth
  const scaleY = height / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * scaleY)
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY))

    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * scaleX)
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0

      for (let sy = y0; sy < Math.min(y1, height); sy++) {
        for (let sx = x0; sx < Math.min(x1, width); sx++) {
          const i = (sy * width + sx) * 4
          const alpha = data[i + 3] / 255
          r += data[i] * alpha
          g += data[i + 1] * alpha
          b += data[i + 2] * alpha
          a += data[i + 3]
          n++
        }
      }

      const o = (y * targetWidth + x) * 4

      // r/g/b are sums of premultiplied values and `a` is the sum of alphas,
      // so dividing by `a` both averages and unpremultiplies in one step —
      // (r/n) / ((a/n)/255) reduces to r*255/a.
      const unpremultiply = a > 0 ? 255 / a : 0

      out[o] = Math.round(Math.min(255, r * unpremultiply))
      out[o + 1] = Math.round(Math.min(255, g * unpremultiply))
      out[o + 2] = Math.round(Math.min(255, b * unpremultiply))
      out[o + 3] = Math.round(a / n)
    }
  }

  return { width: targetWidth, height: targetHeight, data: out }
}

/** Flatten onto an opaque background. `background` is [r, g, b]. */
export function flatten(image, background) {
  const { width, height, data } = image
  const out = new Uint8Array(data.length)

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    out[i] = Math.round(data[i] * alpha + background[0] * (1 - alpha))
    out[i + 1] = Math.round(data[i + 1] * alpha + background[1] * (1 - alpha))
    out[i + 2] = Math.round(data[i + 2] * alpha + background[2] * (1 - alpha))
    out[i + 3] = 255
  }

  return { width, height, data: out }
}

/** A new opaque canvas. */
export function canvas(size, background) {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0]
    data[i + 1] = background[1]
    data[i + 2] = background[2]
    data[i + 3] = 255
  }
  return { width: size, height: size, data }
}

/** Draw `source` onto `target` at (dx, dy), source-over. */
export function drawOnto(target, source, dx, dy) {
  for (let y = 0; y < source.height; y++) {
    const ty = y + dy
    if (ty < 0 || ty >= target.height) continue

    for (let x = 0; x < source.width; x++) {
      const tx = x + dx
      if (tx < 0 || tx >= target.width) continue

      const s = (y * source.width + x) * 4
      const t = (ty * target.width + tx) * 4
      const alpha = source.data[s + 3] / 255
      if (alpha === 0) continue

      target.data[t] = Math.round(source.data[s] * alpha + target.data[t] * (1 - alpha))
      target.data[t + 1] = Math.round(source.data[s + 1] * alpha + target.data[t + 1] * (1 - alpha))
      target.data[t + 2] = Math.round(source.data[s + 2] * alpha + target.data[t + 2] * (1 - alpha))
      target.data[t + 3] = 255
    }
  }
  return target
}

/** Read the pixel at (x, y) as [r, g, b, a]. */
export function pixelAt(image, x, y) {
  const i = (y * image.width + x) * 4
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]]
}
