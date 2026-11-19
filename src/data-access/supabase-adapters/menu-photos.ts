import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  MenuActionError,
  type MenuItemPhoto,
  type MenuPhotoAdapter,
  type MenuPhotoAspect,
  type MenuPhotoCrop,
  type MenuPhotoFormat,
  type MenuPhotoUpload,
} from '../adapters'
import type { Database, Json, Tables } from '../database.types'

/**
 * The live dish-photo adapter (a-dish-can-show-its-photo, task 4.1).
 *
 * Files go to the private `menu-photos` bucket with the manager's own session,
 * under `<outlet_id>/`, so the bucket's policies decide who may write them:
 * `<key>.<format>`, `<key>-sm.<format>` and `<source_key>-src.<format>`. Then
 * `set_menu_item_photo` records the photo, refusing unless all three are there,
 * and hands back the keys it replaced, whose files are deleted after. A failed
 * delete leaves a file nothing links (design D6, non-goal: sweep).
 *
 * The editor draws photos from signed addresses, good for an hour: the bucket
 * is private, and customers never fetch from it.
 */

const BUCKET = 'menu-photos'
const SIGNED_FOR_SECONDS = 60 * 60
const YEAR = String(60 * 60 * 24 * 365)

const CONTENT_TYPE: Record<MenuPhotoFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
}

const largePath = (outlet: string, key: string, format: MenuPhotoFormat) =>
  `${outlet}/${key}.${format}`
const thumbPath = (outlet: string, key: string, format: MenuPhotoFormat) =>
  `${outlet}/${key}-sm.${format}`
const sourcePath = (outlet: string, key: string, format: MenuPhotoFormat) =>
  `${outlet}/${key}-src.${format}`

function photoError(error: PostgrestError | { message?: string; statusCode?: string }) {
  const code = 'code' in error ? error.code : undefined
  switch (code) {
    case '42501':
      return new MenuActionError(
        'not_permitted',
        'The menu is changed by a manager. This account cannot change this photo.',
      )
    case 'P0001':
      return new MenuActionError('off', 'Dish photos are switched off.')
    case 'P0002':
      return new MenuActionError('missing', 'That menu item no longer exists.')
    case '22023':
    case '23514':
      return new MenuActionError('invalid', 'That photo could not be saved. Choose it again.')
    default:
      return new MenuActionError('failed', 'The photo could not be saved. Try again.')
  }
}

function isCrop(value: Json): value is Json & MenuPhotoCrop {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['x', 'y', 'w', 'h'].every((side) => typeof value[side] === 'number')
  )
}

/** The previous keys a set or clear hands back, or null. */
interface Previous {
  key: string
  format: MenuPhotoFormat
  sourceKey: string
  sourceFormat: MenuPhotoFormat
}

function previousFrom(value: Json): Previous | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { key, format, sourceKey, sourceFormat } = value
  if (
    typeof key !== 'string' ||
    typeof sourceKey !== 'string' ||
    (format !== 'webp' && format !== 'jpeg') ||
    (sourceFormat !== 'webp' && sourceFormat !== 'jpeg')
  ) {
    return null
  }
  return { key, format, sourceKey, sourceFormat }
}

type PhotoRow = Tables<'menu_item_photos'>

export function createSupabaseMenuPhotoAdapter(client: SupabaseClient<Database>): MenuPhotoAdapter {
  const bucket = () => client.storage.from(BUCKET)

  /** Signed addresses for every row's three files, in one request. */
  async function withUrls(rows: PhotoRow[]): Promise<MenuItemPhoto[]> {
    if (rows.length === 0) return []
    const paths = rows.flatMap((row) => {
      const format = row.photo_format as MenuPhotoFormat
      const sourceFormat = row.source_format as MenuPhotoFormat
      return [
        largePath(row.outlet_id, row.photo_key, format),
        thumbPath(row.outlet_id, row.photo_key, format),
        sourcePath(row.outlet_id, row.source_key, sourceFormat),
      ]
    })
    const { data, error } = await bucket().createSignedUrls(paths, SIGNED_FOR_SECONDS)
    if (error || !data) {
      throw new MenuActionError('failed', 'The photos could not be loaded. Try again.')
    }
    const url = new Map(data.map((signed) => [signed.path, signed.signedUrl]))
    return rows.flatMap((row) => {
      const format = row.photo_format as MenuPhotoFormat
      const sourceFormat = row.source_format as MenuPhotoFormat
      const largeUrl = url.get(largePath(row.outlet_id, row.photo_key, format))
      const thumbUrl = url.get(thumbPath(row.outlet_id, row.photo_key, format))
      const sourceUrl = url.get(sourcePath(row.outlet_id, row.source_key, sourceFormat))
      if (
        !largeUrl ||
        !thumbUrl ||
        !sourceUrl ||
        !isCrop(row.large_crop) ||
        !isCrop(row.thumb_crop)
      ) {
        return []
      }
      return [
        {
          itemId: row.item_id,
          key: row.photo_key,
          format,
          aspect: row.aspect as MenuPhotoAspect,
          sourceKey: row.source_key,
          sourceFormat,
          largeCrop: {
            x: row.large_crop.x,
            y: row.large_crop.y,
            w: row.large_crop.w,
            h: row.large_crop.h,
          },
          thumbCrop: {
            x: row.thumb_crop.x,
            y: row.thumb_crop.y,
            w: row.thumb_crop.w,
            h: row.thumb_crop.h,
          },
          largeUrl,
          thumbUrl,
          sourceUrl,
        },
      ]
    })
  }

  async function outletOf(itemId: string): Promise<string> {
    const { data, error } = await client
      .from('menu_items')
      .select('outlet_id')
      .eq('id', itemId)
      .maybeSingle()
    if (error) throw photoError(error)
    if (!data) throw new MenuActionError('missing', 'That menu item no longer exists.')
    return data.outlet_id
  }

  async function upload(path: string, blob: Blob, format: MenuPhotoFormat) {
    const { error } = await bucket().upload(path, blob, {
      upsert: true,
      contentType: CONTENT_TYPE[format],
      // Content-addressed: the bytes behind a name never change.
      cacheControl: YEAR,
    })
    if (error) {
      throw new MenuActionError('failed', 'The photo could not be uploaded. Check the connection.')
    }
  }

  /** Best effort: a file that fails to go is one nothing links. */
  async function removeQuietly(paths: string[]) {
    if (paths.length === 0) return
    try {
      await bucket().remove(paths)
    } catch {
      // Left behind; see the module comment.
    }
  }

  return {
    async listPhotos(outletId) {
      const { data, error } = await client
        .from('menu_item_photos')
        .select('*')
        .eq('outlet_id', outletId)
      if (error) throw photoError(error)
      return withUrls(data ?? [])
    },

    async setPhoto(itemId, sent: MenuPhotoUpload, onProgress) {
      const outlet = await outletOf(itemId)
      const format = sent.large.format
      const files: [string, Blob, MenuPhotoFormat][] = [
        [largePath(outlet, sent.key, format), sent.large.blob, format],
        [thumbPath(outlet, sent.key, format), sent.thumb.blob, format],
      ]
      if (sent.source.blob) {
        files.push([
          sourcePath(outlet, sent.source.key, sent.source.format),
          sent.source.blob,
          sent.source.format,
        ])
      }
      let done = 0
      for (const [path, blob, fileFormat] of files) {
        await upload(path, blob, fileFormat)
        onProgress?.(++done, files.length)
      }

      const { data, error } = await client.rpc('set_menu_item_photo', {
        p_item_id: itemId,
        p_key: sent.key,
        p_format: format,
        p_aspect: sent.aspect,
        p_source_key: sent.source.key,
        p_source_format: sent.source.format,
        p_large_crop: { ...sent.largeCrop },
        p_thumb_crop: { ...sent.thumbCrop },
      })
      if (error) throw photoError(error)

      const previous = previousFrom(data)
      if (previous) {
        const stale: string[] = []
        if (previous.key !== sent.key || previous.format !== format) {
          stale.push(
            largePath(outlet, previous.key, previous.format),
            thumbPath(outlet, previous.key, previous.format),
          )
        }
        if (
          previous.sourceKey !== sent.source.key ||
          previous.sourceFormat !== sent.source.format
        ) {
          stale.push(sourcePath(outlet, previous.sourceKey, previous.sourceFormat))
        }
        await removeQuietly(stale)
      }

      const { data: row, error: readError } = await client
        .from('menu_item_photos')
        .select('*')
        .eq('item_id', itemId)
        .single()
      if (readError) throw photoError(readError)
      const [saved] = await withUrls([row])
      if (!saved)
        throw new MenuActionError('failed', 'The photo was saved, but could not be shown.')
      return saved
    },

    async clearPhoto(itemId) {
      const outlet = await outletOf(itemId)
      const { data, error } = await client.rpc('clear_menu_item_photo', { p_item_id: itemId })
      if (error) throw photoError(error)
      const previous = previousFrom(data)
      if (previous) {
        await removeQuietly([
          largePath(outlet, previous.key, previous.format),
          thumbPath(outlet, previous.key, previous.format),
          sourcePath(outlet, previous.sourceKey, previous.sourceFormat),
        ])
      }
    },
  }
}
