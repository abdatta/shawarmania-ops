import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenuPhotoUpload } from '../adapters'
import { OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'
import { MENU_ITEM_CLASSIC_ID, MENU_ITEM_LEBANESE_ID, menuItemId } from './fixtures/menu'
import { createMockMenuAdapter } from './menu'
import { createDemoStore, DEMO_OUTLET_ID } from './store'

/**
 * The demo's dish photos (a-dish-can-show-its-photo, task 2.1): held as object
 * URLs in memory, and refused wherever the database and the bucket will refuse.
 */

const hex = (digit: string) => digit.repeat(64)

function upload(overrides: Partial<MenuPhotoUpload> = {}): MenuPhotoUpload {
  return {
    key: hex('a'),
    aspect: '4:3',
    large: { blob: new Blob(['large'], { type: 'image/webp' }), format: 'webp' },
    thumb: { blob: new Blob(['thumb'], { type: 'image/webp' }), format: 'webp' },
    largeCrop: { x: 0, y: 0.1, w: 1, h: 0.75 },
    thumbCrop: { x: 0.2, y: 0.1, w: 0.5, h: 0.66 },
    source: { key: hex('b'), format: 'webp', blob: new Blob(['source'], { type: 'image/webp' }) },
    ...overrides,
  }
}

let made = 0
const revoked: string[] = []

beforeEach(() => {
  made = 0
  revoked.length = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:demo/${++made}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mock dish photos', () => {
  it('sets a photo, reports each file, and lists it for the outlet', async () => {
    const store = createDemoStore()
    const photos = createMockMenuAdapter(store, 'franchise_admin').photos!
    const progress: string[] = []

    const saved = await photos.setPhoto(MENU_ITEM_CLASSIC_ID, upload(), (done, total) =>
      progress.push(`${done}/${total}`),
    )

    expect(progress).toEqual(['1/3', '2/3', '3/3'])
    expect(saved).toMatchObject({
      itemId: MENU_ITEM_CLASSIC_ID,
      key: hex('a'),
      format: 'webp',
      aspect: '4:3',
      sourceKey: hex('b'),
      largeUrl: 'blob:demo/1',
      thumbUrl: 'blob:demo/2',
      sourceUrl: 'blob:demo/3',
    })
    expect(await photos.listPhotos(DEMO_OUTLET_ID)).toEqual([saved])
  })

  it('re-frames on the kept original, sending only the two small files', async () => {
    const store = createDemoStore()
    const photos = createMockMenuAdapter(store, 'franchise_admin').photos!
    await photos.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    const progress: string[] = []

    const adjusted = await photos.setPhoto(
      MENU_ITEM_CLASSIC_ID,
      upload({
        key: hex('c'),
        aspect: '4:5',
        source: { key: hex('b'), format: 'webp', blob: null },
      }),
      (done, total) => progress.push(`${done}/${total}`),
    )

    expect(progress).toEqual(['1/2', '2/2'])
    expect(adjusted.sourceUrl).toBe('blob:demo/3')
    expect(adjusted.aspect).toBe('4:5')
    // The replaced large photo and thumbnail go; the original stays.
    expect(revoked).toEqual(['blob:demo/1', 'blob:demo/2'])
  })

  it('refuses to reuse an original the dish does not keep', async () => {
    const photos = createMockMenuAdapter(createDemoStore(), 'franchise_admin').photos!
    await expect(
      photos.setPhoto(
        MENU_ITEM_CLASSIC_ID,
        upload({ source: { key: hex('b'), format: 'webp', blob: null } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it.each([
    ['a malformed key', upload({ key: 'not-a-hash' })],
    ['an unknown shape', upload({ aspect: '16:9' as never })],
    ['a framing outside the photo', upload({ largeCrop: { x: 0.5, y: 0, w: 0.6, h: 0.5 } })],
    ['a thumbnail in another format', upload({ thumb: { blob: new Blob(['t']), format: 'jpeg' } })],
  ])('refuses %s', async (_, bad) => {
    const photos = createMockMenuAdapter(createDemoStore(), 'franchise_admin').photos!
    await expect(photos.setPhoto(MENU_ITEM_CLASSIC_ID, bad)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('refuses a biller, who reads the photos but cannot change them', async () => {
    const store = createDemoStore()
    await createMockMenuAdapter(store, 'franchise_admin').photos!.setPhoto(
      MENU_ITEM_CLASSIC_ID,
      upload(),
    )
    const photos = createMockMenuAdapter(store, 'biller').photos!

    await expect(photos.setPhoto(MENU_ITEM_LEBANESE_ID, upload())).rejects.toMatchObject({
      code: 'not_permitted',
    })
    await expect(photos.clearPhoto(MENU_ITEM_CLASSIC_ID)).rejects.toMatchObject({
      code: 'not_permitted',
    })
    expect(await photos.listPhotos(DEMO_OUTLET_ID)).toHaveLength(1)
  })

  it('refuses another outlet’s dish and another outlet’s photos', async () => {
    const photos = createMockMenuAdapter(createDemoStore(), 'franchise_admin').photos!
    const elsewhere = menuItemId(OUTLET_KANCHRAPARA_ID, 'classic')

    await expect(photos.setPhoto(elsewhere, upload())).rejects.toMatchObject({
      code: 'not_permitted',
    })
    await expect(photos.listPhotos(OUTLET_KANCHRAPARA_ID)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })

  it('refuses a removed dish, and leaves a removed dish’s photo out of the list', async () => {
    const store = createDemoStore()
    const adapter = createMockMenuAdapter(store, 'franchise_admin')
    await adapter.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    await adapter.removeItem(MENU_ITEM_CLASSIC_ID)

    expect(await adapter.photos!.listPhotos(DEMO_OUTLET_ID)).toEqual([])
    await expect(adapter.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())).rejects.toMatchObject({
      code: 'missing',
    })
  })

  it('clears a photo and lets its files go', async () => {
    const store = createDemoStore()
    const photos = createMockMenuAdapter(store, 'franchise_admin').photos!
    await photos.setPhoto(MENU_ITEM_CLASSIC_ID, upload())

    await photos.clearPhoto(MENU_ITEM_CLASSIC_ID)

    expect(await photos.listPhotos(DEMO_OUTLET_ID)).toEqual([])
    expect(revoked).toEqual(['blob:demo/1', 'blob:demo/2', 'blob:demo/3'])
  })

  it('fails offline without changing the saved photo', async () => {
    const store = createDemoStore()
    const photos = createMockMenuAdapter(store, 'franchise_admin').photos!
    const first = await photos.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(
      photos.setPhoto(MENU_ITEM_CLASSIC_ID, upload({ key: hex('d') })),
    ).rejects.toMatchObject({ code: 'offline' })

    online.mockRestore()
    expect(await photos.listPhotos(DEMO_OUTLET_ID)).toEqual([first])
  })

  it('does not touch the menu the counter reads', async () => {
    const store = createDemoStore()
    const adapter = createMockMenuAdapter(store, 'franchise_admin')
    const before = await adapter.readOutletMenu(DEMO_OUTLET_ID)

    await adapter.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())

    expect(await adapter.readOutletMenu(DEMO_OUTLET_ID)).toEqual(before)
  })
})
