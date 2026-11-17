import type { ImageSize } from './crop-geometry'
import type { PhotoFraming } from './photo-cropper'
import type { PreparedOriginal } from './prepare-photo'

/**
 * What the dish editor's Photo field holds until Save
 * (a-dish-can-show-its-photo, design D8): nothing changed, a removal, or a
 * framed photo on its original.
 */

/** The original a choice is framed on. */
export interface FramedOriginal {
  /** What the page draws while framing. */
  displayUrl: string
  /** The kept original's size: every framing is in these pixels. */
  size: ImageSize
  /** Its bytes, key and format: still encoding for a new photo, at hand for a saved one. */
  ready: Promise<PreparedOriginal>
  /** A saved original reused on Adjust, which is not sent again. */
  reused: boolean
}

export type PhotoDraft =
  | { kind: 'unchanged' }
  | { kind: 'removed' }
  | { kind: 'framed'; original: FramedOriginal; framing: PhotoFraming }

export const UNCHANGED: PhotoDraft = { kind: 'unchanged' }
