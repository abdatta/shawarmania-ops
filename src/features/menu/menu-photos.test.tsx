import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { DataAdapters, MenuPhotoUpload } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { MENU_ITEM_CLASSIC_ID } from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { MenuSurface } from './menu-surface'

/**
 * The Photo field in the dish editor and the row thumbnails
 * (a-dish-can-show-its-photo, task 2.4), in both states of `dish-photos`. The
 * canvas work is the image module's and tested there; here it is stood in for,
 * so these tests are about what the editor does with it.
 */

let renders = 0
vi.mock('./photo/prepare-photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./photo/prepare-photo')>()
  const size = { width: 2560, height: 1920 }
  const blob = new Blob(['original'], { type: 'image/webp' })
  return {
    ...actual,
    startOriginal: vi.fn(async () => ({
      size,
      ready: Promise.resolve({ blob, format: 'webp', key: 'b'.repeat(64), ...size }),
    })),
    readSavedOriginal: vi.fn(async () => ({ blob, ...size })),
    renderPhoto: vi.fn(async () => {
      renders += 1
      const file = (side: number) => ({
        blob: new Blob([`${renders}-${side}`], { type: 'image/webp' }),
        format: 'webp' as const,
        width: side,
        height: side,
      })
      return { key: String(renders % 10).repeat(64), large: file(1600), thumb: file(400) }
    }),
  }
})

let made = 0
beforeEach(() => {
  renders = 0
  made = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:test/${++made}`,
    revokeObjectURL: () => undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function manager(): Session {
  const persona = personaFixtures.franchise_admin
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  } as Session
}

function renderMenu(on: boolean, adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  render(
    <MemoryRouter>
      <ChangeGatesForTest on={{ 'dish-photos': on }}>
        <SessionContext.Provider value={manager()}>
          <AdaptersContext.Provider value={adapters}>
            <MenuSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  return { adapters, user: userEvent.setup() }
}

const camera = () => new File(['jpeg'], 'burger.jpg', { type: 'image/jpeg' })

async function openClassic(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('menu-list')
  await user.click(screen.getByRole('button', { name: 'Actions for Classic Chicken Shawarma' }))
  await user.click(screen.getByTestId(`edit-${MENU_ITEM_CLASSIC_ID}`))
  return screen.findByRole('dialog', { name: /Edit Classic Chicken Shawarma/ })
}

/** Pick a photo, then Next and Done through the cropper with its starting framings. */
async function pickAndFrame(user: ReturnType<typeof userEvent.setup>, shape?: string) {
  await user.upload(screen.getByTestId('menu-photo-input'), camera())
  await screen.findByTestId('photo-cropper')
  if (shape) await user.click(screen.getByRole('button', { name: shape }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByTestId('photo-cropper')).not.toBeInTheDocument())
}

const upload = (): MenuPhotoUpload => ({
  key: '9'.repeat(64),
  aspect: '4:3',
  large: { blob: new Blob(['l']), format: 'webp' },
  thumb: { blob: new Blob(['t']), format: 'webp' },
  largeCrop: { x: 0, y: 0, w: 1, h: 1 },
  thumbCrop: { x: 0.25, y: 0, w: 0.75, h: 1 },
  source: { key: '8'.repeat(64), format: 'webp', blob: new Blob(['s']) },
})

describeChangeGate('dish-photos', (on) => {
  it(
    on ? 'shows the Photo field in the dish editor' : 'leaves the dish editor as it was',
    async () => {
      const { user, adapters } = renderMenu(on)
      const list = vi.spyOn(adapters.menu.photos!, 'listPhotos')
      const sheet = await openClassic(user)
      expect(within(sheet).queryByTestId('menu-photo-field') !== null).toBe(on)
      if (!on) expect(list).not.toHaveBeenCalled()
    },
  )

  it(on ? 'shows a row thumbnail for a photographed dish' : 'shows no row thumbnails', async () => {
    const adapters = createMockAdapters('franchise_admin')
    await adapters.menu.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    renderMenu(on, adapters)
    await screen.findByTestId('menu-list')
    if (on) {
      expect(await screen.findByTestId(`menu-photo-row-${MENU_ITEM_CLASSIC_ID}`)).toBeVisible()
      expect(document.querySelectorAll('[data-testid^="menu-photo-row-"]')).toHaveLength(1)
    } else {
      expect(screen.queryByTestId(`menu-photo-row-${MENU_ITEM_CLASSIC_ID}`)).toBeNull()
    }
  })

  if (!on) return

  it('adds a photo: a dashed tile with Add, the two framings shown, saved after the dish', async () => {
    const { user, adapters } = renderMenu(true)
    const set = vi.spyOn(adapters.menu.photos!, 'setPhoto')
    const update = vi.spyOn(adapters.menu, 'updateItemWithCategory')
    const sheet = await openClassic(user)
    expect(within(sheet).getByTestId('menu-photo-empty')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Add photo' })).toBeVisible()

    await pickAndFrame(user, 'Portrait 4:5')

    expect(within(sheet).getByTestId('menu-photo-thumb')).toBeVisible()
    expect(within(sheet).getByTestId('menu-photo-large')).toHaveStyle({ aspectRatio: String(0.8) })
    // Nothing goes before Save.
    expect(set).not.toHaveBeenCalled()

    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(set.mock.invocationCallOrder[0]!)
    const [itemId, sent] = set.mock.calls[0]!
    expect(itemId).toBe(MENU_ITEM_CLASSIC_ID)
    expect(sent.aspect).toBe('4:5')
    expect(sent.source.blob).not.toBeNull()
    expect(await screen.findByTestId(`menu-photo-row-${MENU_ITEM_CLASSIC_ID}`)).toBeVisible()
  })

  it('adds a photo to a dish being created', async () => {
    const { user, adapters } = renderMenu(true)
    const set = vi.spyOn(adapters.menu.photos!, 'setPhoto')
    await screen.findByTestId('menu-list')
    await user.click(screen.getByTestId('add-menu-item'))
    await screen.findByRole('dialog', { name: /Add item/ })
    await pickAndFrame(user)
    // Pasted rather than typed key by key: this test is about the photo, and
    // typing three fields one key at a time ran past the timeout under load.
    for (const [field, value] of [
      [screen.getByLabelText('Name'), 'Fat Chicken Burrito'],
      [screen.getByRole('combobox', { name: 'Category' }), 'Shawarmas'],
      [screen.getByLabelText('Price (₹)'), '300'],
    ] as const) {
      await user.click(field)
      await user.paste(value)
    }
    await user.click(screen.getByRole('button', { name: 'Create item' }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    const created = (await adapters.menu.listMenu(OUTLET_KALYANI_ID))
      .flatMap((entry) => entry.items)
      .find((item) => item.name === 'Fat Chicken Burrito')!
    expect(set.mock.calls[0]![0]).toBe(created.id)
  })

  it('adjusts a saved photo at its saved framing, sending only the two small files', async () => {
    const adapters = createMockAdapters('franchise_admin')
    await adapters.menu.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    const { user } = renderMenu(true, adapters)
    const set = vi.spyOn(adapters.menu.photos!, 'setPhoto')
    const sheet = await openClassic(user)

    await user.click(within(sheet).getByRole('button', { name: 'Adjust' }))
    await screen.findByTestId('photo-cropper')
    expect(screen.getByRole('button', { name: 'Landscape 4:3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Square 1:1' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    const sent = set.mock.calls[0]![1]
    expect(sent.aspect).toBe('1:1')
    expect(sent.source).toMatchObject({ key: '8'.repeat(64), blob: null })
  })

  it('changes a saved photo for a new one', async () => {
    const adapters = createMockAdapters('franchise_admin')
    await adapters.menu.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    const { user } = renderMenu(true, adapters)
    const set = vi.spyOn(adapters.menu.photos!, 'setPhoto')
    const sheet = await openClassic(user)
    expect(within(sheet).getByRole('button', { name: 'Change' })).toBeVisible()

    await pickAndFrame(user)
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]![1].source).toMatchObject({ key: 'b'.repeat(64) })
    expect(set.mock.calls[0]![1].source.blob).not.toBeNull()
  })

  it('removes a photo on Save', async () => {
    const adapters = createMockAdapters('franchise_admin')
    await adapters.menu.photos!.setPhoto(MENU_ITEM_CLASSIC_ID, upload())
    const { user } = renderMenu(true, adapters)
    const sheet = await openClassic(user)

    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))
    expect(within(sheet).getByTestId('menu-photo-empty')).toBeVisible()
    expect(await adapters.menu.photos!.listPhotos(OUTLET_KALYANI_ID)).toHaveLength(1)

    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await adapters.menu.photos!.listPhotos(OUTLET_KALYANI_ID)).toEqual([])
    expect(screen.queryByTestId(`menu-photo-row-${MENU_ITEM_CLASSIC_ID}`)).toBeNull()
  })

  it('discards a picked photo on Cancel', async () => {
    const { user, adapters } = renderMenu(true)
    const set = vi.spyOn(adapters.menu.photos!, 'setPhoto')
    await openClassic(user)
    await pickAndFrame(user)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(set).not.toHaveBeenCalled()

    const sheet = await openClassic(user)
    expect(within(sheet).getByTestId('menu-photo-empty')).toBeVisible()
  })

  it('keeps the new price when the photo fails, says so, and retries', async () => {
    const { user, adapters } = renderMenu(true)
    const sheet = await openClassic(user)
    await pickAndFrame(user)
    const price = within(sheet).getByLabelText('Price (₹)')
    await user.clear(price)
    await user.type(price, '199')

    const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))

    const failed = await within(sheet).findByTestId('menu-photo-failed')
    expect(failed).toHaveTextContent('Photo not saved')
    const classic = (await adapters.menu.listMenu(OUTLET_KALYANI_ID))
      .flatMap((entry) => entry.items)
      .find((item) => item.id === MENU_ITEM_CLASSIC_ID)!
    expect(classic.price_paise).toBe(19900)
    expect(await adapters.menu.photos!.listPhotos(OUTLET_KALYANI_ID)).toEqual([])

    offline.mockRestore()
    await user.click(within(failed).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await adapters.menu.photos!.listPhotos(OUTLET_KALYANI_ID)).toHaveLength(1)
  })
})
