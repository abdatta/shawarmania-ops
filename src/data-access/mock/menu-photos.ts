import {
  MenuActionError,
  type MenuItemPhoto,
  type MenuPhotoAdapter,
  type MenuPhotoCrop,
  type MenuPhotoUpload,
} from '../adapters'
import type { DemoStore } from './store'

/**
 * The mock dish-photo adapter (a-dish-can-show-its-photo, task 2.1).
 *
 * The files are held as object URLs in this tab's memory and never written
 * anywhere, so a demo photo lasts until the tab closes. It refuses what the
 * database and the bucket's policies will refuse — a biller, another outlet, a
 * removed dish, a malformed key or framing — so the demo cannot walk a state
 * production would reject. A photo needs a connection in production; here the
 * browser's own offline state stands in for one, which is how a failed upload
 * is shown in the demo.
 */

const KEY = /^[0-9a-f]{64}$/
const ASPECTS = ['4:3', '1:1', '4:5'] as const
const FORMATS = ['webp', 'jpeg'] as const

function validCrop(crop: MenuPhotoCrop) {
  return (
    [crop.x, crop.y, crop.w, crop.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
    crop.w > 0 &&
    crop.h > 0 &&
    crop.x + crop.w <= 1 + 1e-9 &&
    crop.y + crop.h <= 1 + 1e-9
  )
}

/** An address the page can draw; jsdom has no `createObjectURL`, so tests stub it. */
function urlFor(blob: Blob) {
  return URL.createObjectURL(blob)
}

function release(url: string) {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // Nothing to release where object URLs are stubbed.
  }
}

/** One step of the pretend upload, so progress is seen and a test can await it. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function createMockMenuPhotoAdapter(
  store: DemoStore,
  mayWrite: boolean,
  reachableOutlets: readonly string[] | null,
): MenuPhotoAdapter {
  function itemFor(itemId: string, verb: 'read' | 'change') {
    const item = store.menuItems.find((candidate) => candidate.id === itemId)
    if (!item || !item.is_active) {
      throw new MenuActionError('missing', 'That menu item no longer exists.')
    }
    if (verb === 'change' && !mayWrite) {
      throw new MenuActionError(
        'not_permitted',
        'The menu is changed by a manager. This account can read it only.',
      )
    }
    if (reachableOutlets && !reachableOutlets.includes(item.outlet_id)) {
      throw new MenuActionError('not_permitted', 'You can change only a menu you manage.')
    }
    return item
  }

  function refuseOffline() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new MenuActionError('offline', 'No connection. The photo was not sent.')
    }
  }

  return {
    async listPhotos(outletId) {
      if (reachableOutlets && !reachableOutlets.includes(outletId)) {
        throw new MenuActionError('not_permitted', 'You can read only your own outlet’s menu.')
      }
      return [...store.menuPhotos.values()]
        .filter((photo) =>
          store.menuItems.some(
            (item) => item.id === photo.itemId && item.outlet_id === outletId && item.is_active,
          ),
        )
        .map((photo) => structuredClone(photo))
    },

    async setPhoto(itemId, upload: MenuPhotoUpload, onProgress) {
      itemFor(itemId, 'change')
      const previous = store.menuPhotos.get(itemId)
      if (
        !KEY.test(upload.key) ||
        !KEY.test(upload.source.key) ||
        !ASPECTS.includes(upload.aspect) ||
        !FORMATS.includes(upload.large.format) ||
        upload.thumb.format !== upload.large.format ||
        !FORMATS.includes(upload.source.format) ||
        !validCrop(upload.largeCrop) ||
        !validCrop(upload.thumbCrop)
      ) {
        throw new MenuActionError('invalid', 'That photo could not be saved. Choose it again.')
      }
      // Reusing the original is allowed only for the original this dish keeps.
      const reusesSource = upload.source.blob === null
      if (
        reusesSource &&
        (!previous ||
          previous.sourceKey !== upload.source.key ||
          previous.sourceFormat !== upload.source.format)
      ) {
        throw new MenuActionError('invalid', 'That photo could not be saved. Choose it again.')
      }

      const files = reusesSource ? 2 : 3
      let done = 0
      const sent: string[] = []
      try {
        refuseOffline()
        await tick()
        refuseOffline()
        const largeUrl = urlFor(upload.large.blob)
        sent.push(largeUrl)
        onProgress?.(++done, files)
        await tick()
        refuseOffline()
        const thumbUrl = urlFor(upload.thumb.blob)
        sent.push(thumbUrl)
        onProgress?.(++done, files)
        let sourceUrl = previous?.sourceUrl ?? ''
        if (upload.source.blob) {
          await tick()
          refuseOffline()
          sourceUrl = urlFor(upload.source.blob)
          sent.push(sourceUrl)
          onProgress?.(++done, files)
        }

        const saved: MenuItemPhoto = {
          itemId,
          key: upload.key,
          format: upload.large.format,
          aspect: upload.aspect,
          sourceKey: upload.source.key,
          sourceFormat: upload.source.format,
          largeCrop: { ...upload.largeCrop },
          thumbCrop: { ...upload.thumbCrop },
          largeUrl,
          thumbUrl,
          sourceUrl,
        }
        store.menuPhotos.set(itemId, saved)
        // The replaced files go once the new photo is set, as the live adapter
        // deletes them; the original only when it changed.
        if (previous) {
          release(previous.largeUrl)
          release(previous.thumbUrl)
          if (!reusesSource) release(previous.sourceUrl)
        }
        return structuredClone(saved)
      } catch (cause) {
        sent.forEach(release)
        throw cause
      }
    },

    async clearPhoto(itemId) {
      itemFor(itemId, 'change')
      refuseOffline()
      const previous = store.menuPhotos.get(itemId)
      if (!previous) return
      store.menuPhotos.delete(itemId)
      release(previous.largeUrl)
      release(previous.thumbUrl)
      release(previous.sourceUrl)
    },
  }
}
