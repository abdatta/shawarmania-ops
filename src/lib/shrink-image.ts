/**
 * A campaign's picture, made small on the phone before it is uploaded
 * (a-campaign-goes-out-on-whatsapp, task 3.2; design, *Pictures and the free
 * plan*).
 *
 * The `campaign-images` bucket refuses anything over 1 MB, to keep storage and
 * egress inside Supabase's free plan [owner, 2026-11-18]. A phone photo is
 * several times that, and WhatsApp shrinks it to a few hundred kilobytes
 * before sending it anyway, so the page does the same first: at most 1,600
 * pixels on the longer side, as a JPEG. The bucket's cap is what holds if this
 * does not.
 *
 * Always a JPEG, whatever was chosen: the bucket takes JPEG and PNG, and a
 * photo is far smaller as a JPEG. A transparent PNG is laid on white, which is
 * how WhatsApp shows one in a chat.
 */

/** The longer side of the picture that is uploaded. */
export const PICTURE_LONG_SIDE = 1600

/** What the bucket takes. */
export const PICTURE_MAX_BYTES = 1024 * 1024

/** Tried in order until one fits under the cap. */
const ATTEMPTS: readonly { side: number; quality: number }[] = [
  { side: PICTURE_LONG_SIDE, quality: 0.85 },
  { side: PICTURE_LONG_SIDE, quality: 0.72 },
  { side: 1280, quality: 0.72 },
  { side: 1024, quality: 0.65 },
]

export class PictureUnreadable extends Error {
  constructor() {
    super('The picture could not be read.')
    this.name = 'PictureUnreadable'
  }
}

/** The size a picture is drawn at: never larger than it is, the longer side at most `side`. */
export function fittedSize(
  width: number,
  height: number,
  side: number,
): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function shrinkPicture(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    // `from-image` turns a phone photo the way its camera held it.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PictureUnreadable()
  }
  try {
    let smallest: Blob | null = null
    for (const attempt of ATTEMPTS) {
      const size = fittedSize(bitmap.width, bitmap.height, attempt.side)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) throw new PictureUnreadable()
      // The white a transparent picture is laid on: part of the picture, not a colour of the app.
      context.fillStyle = 'white'
      context.fillRect(0, 0, size.width, size.height)
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', attempt.quality),
      )
      if (!blob) throw new PictureUnreadable()
      if (blob.size <= PICTURE_MAX_BYTES) return blob
      smallest = blob
    }
    // Still over: upload the smallest, and let the bucket say no.
    return smallest ?? file
  } finally {
    bitmap.close()
  }
}
