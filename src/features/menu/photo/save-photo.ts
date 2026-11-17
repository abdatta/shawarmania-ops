import type { MenuItemPhoto, MenuPhotoAdapter } from '@/data-access/adapters'

import type { PhotoDraft } from './photo-draft'
import { renderPhoto, type ImageToolkit } from './prepare-photo'

/** Where a photo's Save has got to, for the button. */
export type PhotoSaveProgress =
  { stage: 'preparing' } | { stage: 'sending'; done: number; total: number }

/**
 * Send a dish's photo choice (a-dish-can-show-its-photo, design D8): the large
 * photo and thumbnail are cut from the kept original now, then uploaded and
 * set; a removal clears it. Called after the dish's own fields are saved, so a
 * failure here leaves those saved.
 */
export async function savePhotoDraft(
  photos: MenuPhotoAdapter,
  itemId: string,
  draft: PhotoDraft,
  saved: MenuItemPhoto | null,
  onProgress: (progress: PhotoSaveProgress) => void,
  toolkit?: ImageToolkit,
): Promise<void> {
  if (draft.kind === 'unchanged') return
  if (draft.kind === 'removed') {
    if (saved) await photos.clearPhoto(itemId)
    return
  }
  onProgress({ stage: 'preparing' })
  const original = await draft.original.ready
  const { aspect, largeCrop, thumbCrop } = draft.framing
  const rendered = await renderPhoto(original.blob, aspect, largeCrop, thumbCrop, toolkit)
  await photos.setPhoto(
    itemId,
    {
      key: rendered.key,
      aspect,
      large: { blob: rendered.large.blob, format: rendered.large.format },
      thumb: { blob: rendered.thumb.blob, format: rendered.thumb.format },
      largeCrop,
      thumbCrop,
      source: {
        key: original.key,
        format: original.format,
        blob: draft.original.reused ? null : original.blob,
      },
    },
    (done, total) => onProgress({ stage: 'sending', done, total }),
  )
}
