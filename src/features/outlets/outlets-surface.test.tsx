import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createMockAdapters,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
  OUTLET_MISTAKE_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OutletPage, OutletsSurface } from './outlets-surface'
import { publicMenuHost, publicMenuLink } from '@/lib/public-menu-link'

/**
 * Outlets: a list like Team, where each row opens that outlet's own page
 * (outlets-one-at-a-time). The page is where an outlet is edited, captured,
 * closed, reopened and deleted; the list is where one is added.
 *
 * The capture rules are still the substance of much of this file: a reading is
 * judged once and then judges every future check-in, so a loose fix must not be
 * saveable by accident.
 */

let watchPosition: ReturnType<typeof vi.fn>

/** Emit samples through watchPosition, best-by-accuracy last. */
function samples(...accuracies: number[]) {
  watchPosition.mockImplementation((onSuccess: PositionCallback) => {
    for (const accuracy of accuracies) {
      onSuccess({
        coords: { latitude: 22.975123, longitude: 88.434412, accuracy },
        timestamp: Date.parse('2026-07-27T04:00:00Z'),
      } as GeolocationPosition)
    }
    return 1
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  watchPosition = vi.fn().mockReturnValue(1)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition, clearWatch: vi.fn() },
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'geolocation')
})

const ownerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  assignments: personaFixtures.super_admin.assignments,
  ...deriveSessionScope(personaFixtures.super_admin.assignments),
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

const ID: Record<string, string> = {
  kalyani: OUTLET_KALYANI_ID,
  kanchrapara: OUTLET_KANCHRAPARA_ID,
  'demo-mistake': OUTLET_MISTAKE_ID,
}

/**
 * The two screens under their real addresses, and one other screen to have come
 * from. `entries` is the history the reader arrives with, its last entry open.
 */
function renderOutlets(
  adapters: DataAdapters = createMockAdapters(),
  entries: string[] = ['/outlets'],
) {
  return {
    adapters,
    ...render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <SessionContext.Provider value={ownerSession}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route path="/outlets" element={<OutletsSurface />} />
              <Route path="/outlets/:outletId" element={<OutletPage />} />
              <Route path="/elsewhere" element={<p>Somewhere else</p>} />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/** Open one outlet's page straight away, as a link from another screen would. */
function renderPage(handle: string, adapters: DataAdapters = createMockAdapters()) {
  return renderOutlets(adapters, ['/outlets', `/outlets/${ID[handle]}`])
}

/** Open an outlet's page from its row on the list. */
async function openFromList(user: ReturnType<typeof userEvent.setup>, handle: string) {
  await user.click(await screen.findByTestId(`open-${handle}`))
  return screen.findByTestId(`outlet-${handle}`)
}

/** Open the capture sheet on an outlet's page and let the sampling window close. */
async function takeReading(user: ReturnType<typeof userEvent.setup>, handle: string) {
  await user.click(await screen.findByTestId(`capture-${handle}`))
  await user.click(await screen.findByTestId('take-reading'))
  await vi.advanceTimersByTimeAsync(8_000)
}

async function addOutlet(
  user: ReturnType<typeof userEvent.setup>,
  fields: { name?: string; code?: string; label?: string },
) {
  await user.click(await screen.findByTestId('add-outlet'))
  if (fields.name) await user.type(screen.getByLabelText('Name'), fields.name)
  if (fields.code) await user.type(screen.getByLabelText('Short code'), fields.code)
  if (fields.label) await user.type(screen.getByLabelText('Location label'), fields.label)
  await user.click(screen.getByRole('button', { name: 'Create outlet' }))
}

async function markClosed(user: ReturnType<typeof userEvent.setup>, handle: string) {
  await user.click(await screen.findByTestId(`close-${handle}`))
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
  )
}

describe('the list of outlets', () => {
  it('lists every outlet, trading ones first, each with its status in plain words', async () => {
    renderOutlets()

    const list = await screen.findByTestId('outlet-list')
    const rows = within(list).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Shawarmania Kalyani.*kalyani · Kalyani — Central Park.*Open/),
      expect.stringMatching(/Shawarmania Kanchrapara.*Open/),
      expect.stringMatching(/created by mistake.*Closed/),
    ])
    // Open and Closed are a setting somebody chose, not a live reading, so
    // nothing on a row carries a coloured dot (design D6).
    expect(list.querySelector('.rounded-full')).toBeNull()
  })

  it('says in one line how each outlet’s tablets are', async () => {
    renderOutlets()

    // The demo tablets carry unsent bills on purpose.
    expect(await screen.findByTestId('open-kalyani')).toBeInTheDocument()
    const rows = within(screen.getByTestId('outlet-list')).getAllByRole('row')
    expect(rows[1]).toHaveTextContent(/1 unsent/)
    expect(rows[2]).toHaveTextContent(/3 unsent/)
  })

  it('says an outlet has no tablet, and never says so when the tablets could not be read', async () => {
    const empty = createMockAdapters()
    empty.counter.listDevices = () => Promise.resolve([])
    const { unmount } = renderOutlets(empty)
    const none = within(await screen.findByTestId('outlet-list'))
    await waitFor(() => expect(none.getAllByText('None').length).toBeGreaterThan(0))
    unmount()

    const failing = createMockAdapters()
    failing.counter.listDevices = () => Promise.reject(new Error('offline'))
    renderOutlets(failing)
    await screen.findByTestId('outlet-list')
    await waitFor(() => expect(screen.getAllByText('Not read').length).toBeGreaterThan(0))
    expect(screen.queryByText('None')).toBeNull()
  })

  it('opens an outlet’s own page from its row, with nothing of any other outlet on it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await openFromList(user, 'kanchrapara')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shawarmania Kanchrapara')
    expect(screen.getByText('kanchrapara')).toBeInTheDocument()
    expect(screen.queryByText('Shawarmania Kalyani')).toBeNull()
    expect(screen.queryByTestId('surface-outlet')).toBeNull()
  })
})

describe('an outlet’s page', () => {
  it('says whether the outlet is open in plain words, with no dot', async () => {
    renderPage('kalyani')

    await screen.findByTestId('outlet-kalyani')
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!
    expect(header).toHaveTextContent('Open')
    expect(header.querySelector('.rounded-full')).toBeNull()
  })

  it('goes back to where the reader came from', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets(createMockAdapters(), ['/elsewhere', `/outlets/${OUTLET_KALYANI_ID}`])

    await screen.findByTestId('outlet-kalyani')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Somewhere else')).toBeInTheDocument()
  })

  it('goes back to the list when it was the first page opened, rather than out of the app', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets(createMockAdapters(), [`/outlets/${OUTLET_KALYANI_ID}`])

    await screen.findByTestId('outlet-kalyani')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('outlet-list')).toBeInTheDocument()
  })

  it('shows nothing about an outlet that does not exist', async () => {
    renderOutlets(createMockAdapters(), ['/outlets/no-such-outlet'])

    expect(await screen.findByText('This outlet is not one you can see.')).toBeInTheDocument()
    expect(screen.queryByTestId(/^outlet-/)).toBeNull()
  })

  it('shows the details it edits, and the tablets standing at it', async () => {
    renderPage('kalyani')

    const page = await screen.findByTestId('outlet-kalyani')
    for (const caption of [
      'Location',
      'Phone',
      'Address',
      'Public menu',
      'Day ends',
      'Staff check in by',
    ]) {
      expect(within(page).getByText(caption)).toBeInTheDocument()
    }
    expect(within(page).getByText('04:00')).toBeInTheDocument()
    expect(await within(page).findByTestId('outlet-tablets')).toBeInTheDocument()
  })

  it('offers every action the card and the Tablets page had, to the owner', async () => {
    renderPage('kalyani')

    await screen.findByTestId('outlet-kalyani')
    for (const control of ['edit-kalyani', 'capture-kalyani', 'close-kalyani']) {
      expect(screen.getByTestId(control)).toBeInTheDocument()
    }
    // The page reads Details, Orders, Loyalty and Tablets at once; under a full
    // parallel suite the tablets can land after the default second.
    expect(await screen.findByTestId('add-tablet', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Edit Counter tablet' }, { timeout: 5_000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Counter tablet' })).toBeInTheDocument()
  })
})

describe('capturing an outlet’s position', () => {
  it('says which outlets have never been surveyed', async () => {
    renderPage('kanchrapara')

    // Kanchrapara carries placeholder coordinates and no capture record.
    expect(await screen.findByTestId('uncaptured-kanchrapara')).toHaveTextContent('Not captured')
    expect(screen.getByTestId('capture-kanchrapara')).toHaveTextContent('Capture')
  })

  it('shows how good the surveyed fix was, and keeps its button beside it', async () => {
    renderPage('kalyani')

    const fence = await screen.findByTestId('location-kalyani')
    expect(fence).toHaveTextContent('150 m')
    expect(fence).toHaveTextContent('±9 m')
    // The button sits inside the tile it retakes (design D3).
    expect(within(fence).getByTestId('capture-kalyani')).toHaveTextContent('Recapture')
    expect(screen.queryByTestId('uncaptured-kalyani')).toBeNull()
  })

  it('keeps the tightest sample and saves a good fix', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const save = vi.spyOn(adapters.outlets, 'saveLocation')
    samples(60, 8, 40)

    renderPage('kanchrapara', adapters)
    await takeReading(user, 'kanchrapara')

    const result = await screen.findByTestId('capture-result')
    expect(result).toHaveAttribute('data-quality', 'good')
    expect(result).toHaveTextContent('±8 m')

    await user.click(screen.getByTestId('save-position'))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ accuracyMetres: 8, radiusMetres: 150 }),
      ),
    )
  })

  it('warns but still saves a middling fix', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(38)

    renderPage('kanchrapara')
    await takeReading(user, 'kanchrapara')

    const result = await screen.findByTestId('capture-result')
    expect(result).toHaveAttribute('data-quality', 'imprecise')
    expect(result).toHaveTextContent('not tight')
    expect(screen.getByTestId('save-position')).toBeInTheDocument()
  })

  it('refuses to save a fix too loose to be a reference point', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const save = vi.spyOn(adapters.outlets, 'saveLocation')
    samples(180)

    renderPage('kanchrapara', adapters)
    await takeReading(user, 'kanchrapara')

    const result = await screen.findByTestId('capture-result')
    expect(result).toHaveAttribute('data-quality', 'unusable')
    expect(result).toHaveTextContent('too loose to save')
    expect(screen.queryByTestId('save-position')).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('offers one way to retry a refused reading, not two', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(180)

    renderPage('kanchrapara')
    await takeReading(user, 'kanchrapara')
    await screen.findByTestId('capture-result')

    // The footer and the result block both used to carry a retry, one labelled
    // "Take a reading" and the other "Take another reading" — the same call,
    // stacked in one sheet, reading as two different actions.
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getAllByRole('button', { name: /reading/i })).toHaveLength(1)
    expect(screen.getByTestId('take-reading')).toHaveTextContent('Take another reading')
    expect(screen.queryByTestId('retake-reading')).not.toBeInTheDocument()

    // And nothing offers to configure a save that cannot happen.
    expect(screen.queryByLabelText('How far from here may staff check in?')).not.toBeInTheDocument()
  })

  it('keeps the retry beside the save when a reading is good enough', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(12)

    renderPage('kanchrapara')
    await takeReading(user, 'kanchrapara')
    await screen.findByTestId('capture-result')

    // Two controls here, but two genuinely different actions.
    expect(screen.getByTestId('save-position')).toBeInTheDocument()
    expect(screen.getByTestId('retake-reading')).toHaveTextContent('Take another reading')
    expect(screen.queryByTestId('take-reading')).not.toBeInTheDocument()
  })

  it('lets the radius be changed at capture time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const save = vi.spyOn(adapters.outlets, 'saveLocation')
    samples(10)

    renderPage('kanchrapara', adapters)
    await takeReading(user, 'kanchrapara')

    const radius = await screen.findByLabelText('How far from here may staff check in?')
    await user.clear(radius)
    await user.type(radius, '90')
    await user.click(screen.getByTestId('save-position'))

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ radiusMetres: 90 }),
      ),
    )
  })

  it('names a geolocation failure instead of failing silently', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    watchPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) => {
      onError({ code: 1 } as GeolocationPositionError)
      return 1
    })

    renderPage('kanchrapara')
    await takeReading(user, 'kanchrapara')

    expect(await screen.findByTestId('capture-failed')).toHaveAttribute('data-failure', 'denied')
  })

  it('shows the new position on the page after saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(11)

    renderPage('kanchrapara')
    await takeReading(user, 'kanchrapara')
    await user.click(await screen.findByTestId('save-position'))

    await waitFor(() =>
      expect(screen.queryByTestId('uncaptured-kanchrapara')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('capture-kanchrapara')).toHaveTextContent('Recapture')
  })
})

/**
 * The empty database — the screen a new owner actually sees first, and the one
 * that used to be a dead end. Nothing here may assume a row exists.
 */
describe('the outlets list with nothing in it', () => {
  function emptyOutlets(): DataAdapters {
    const adapters = createMockAdapters()
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([])
    return adapters
  }

  it('tells the owner what to do rather than reporting no data', async () => {
    renderOutlets(emptyOutlets())

    expect(await screen.findByText(/An outlet has to exist before anyone/)).toBeInTheDocument()
  })

  it('offers the action that creates the first outlet, from inside the empty state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = emptyOutlets()
    const create = vi.spyOn(adapters.outlets, 'createOutlet')

    renderOutlets(adapters)
    await addOutlet(user, {
      name: 'Shawarmania Barrackpore',
      code: 'barrackpore',
      label: 'Barrackpore',
    })

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'barrackpore', name: 'Shawarmania Barrackpore' }),
      ),
    )
  })

  it('renders every control without a single outlet present', async () => {
    renderOutlets(emptyOutlets())

    await screen.findByTestId('add-outlet')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('outlets-error')).not.toBeInTheDocument()
  })
})

describe('creating and editing an outlet', () => {
  it('adds an outlet and opens its page', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await addOutlet(user, {
      name: 'Shawarmania Barrackpore',
      code: 'barrackpore',
      label: 'Barrackpore',
    })

    expect(await screen.findByTestId('outlet-barrackpore')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shawarmania Barrackpore')
  })

  it('gives a new outlet no position, so it judges nobody until it is captured', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await addOutlet(user, {
      name: 'Shawarmania Barrackpore',
      code: 'barrackpore',
      label: 'Barrackpore',
    })

    expect(await screen.findByTestId('uncaptured-barrackpore')).toHaveTextContent('Not captured')
  })

  it('refuses a code another outlet already uses, and says so', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await addOutlet(user, { name: 'Shawarmania Kalyani Two', code: 'kalyani', label: 'Kalyani' })

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('already used')
  })

  it('edits an existing outlet from its own values', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Shawarmania Kalyani')
    await user.clear(name)
    await user.type(name, 'Shawarmania Kalyani Central')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Shawarmania Kalyani Central',
      ),
    )
  })

  it('shows the public menu address a table QR code carries, as the address itself', async () => {
    renderPage('kalyani')

    const link = await screen.findByTestId('public-menu-kalyani')
    expect(link).toHaveTextContent(`${publicMenuHost()}shawarmania-kalyani/`)
    expect(link).toHaveAttribute('href', publicMenuLink('shawarmania-kalyani'))
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('copies the whole public menu address from beside it, and says so', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderPage('kalyani')

    await user.click(await screen.findByRole('button', { name: 'Copy public menu address' }))

    expect(writeText).toHaveBeenCalledWith(publicMenuLink('shawarmania-kalyani'))
    expect(screen.getByTestId('copy-public-menu-kalyani')).toHaveTextContent('Copied')
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
  })

  it('selects the address instead of claiming a copy where the device cannot copy', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
    renderPage('kalyani')

    await user.click(await screen.findByRole('button', { name: 'Copy public menu address' }))

    expect(window.getSelection()?.toString()).toContain('shawarmania-kalyani/')
    expect(screen.getByTestId('copy-public-menu-kalyani')).not.toHaveTextContent('Copied')
  })

  it('gives a new outlet the public address made from its name, without being asked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await user.click(await screen.findByTestId('add-outlet'))
    await user.type(screen.getByLabelText('Name'), 'Kalyani Cafe')
    // The placeholder is the address it will get, so the owner sees it first.
    expect(screen.getByLabelText('Public menu address')).toHaveAttribute(
      'placeholder',
      'kalyani-cafe',
    )
    await user.type(screen.getByLabelText('Short code'), 'skcafe')
    await user.type(screen.getByLabelText('Location label'), 'Kalyani')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('public-menu-skcafe')).toHaveTextContent(
      `${publicMenuHost()}kalyani-cafe/`,
    )
  })

  it('refuses a public address that is not URL-safe, before sending it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))
    const slug = screen.getByLabelText('Public menu address')
    expect(slug).toHaveValue('shawarmania-kalyani')
    await user.clear(slug)
    await user.type(slug, 'kalyani cafe!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect((await screen.findAllByText(/single hyphens between words/)).length).toBeGreaterThan(0)
  })

  it('refuses a public address another outlet already has', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))
    const slug = screen.getByLabelText('Public menu address')
    await user.clear(slug)
    await user.type(slug, 'shawarmania-kanchrapara')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      (await screen.findAllByText(/already uses that public menu address/)).length,
    ).toBeGreaterThan(0)
  })

  it('keeps the public address when the field is cleared, so printed codes keep working', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))
    await user.clear(screen.getByLabelText('Public menu address'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.getByTestId('public-menu-kalyani')).toHaveTextContent(
        `${publicMenuHost()}shawarmania-kalyani/`,
      ),
    )
  })

  it('says the cutover cannot move anything already recorded', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))

    expect(screen.getByLabelText('The day rolls over at')).toHaveValue('04:00')
    expect(screen.getByText(/never moves anything already recorded/)).toBeInTheDocument()
  })

  it('names the cutover as a seam rather than an opening time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))

    expect(screen.getByText(/Not the opening time/)).toBeInTheDocument()
    expect(screen.getByTestId('cutover-preview')).toHaveTextContent('04:00 to 03:59')
    expect(screen.queryByTestId('cutover-warning')).not.toBeInTheDocument()
  })

  // The mistake this field actually invites: an opening time typed into a
  // seam. The preview has to object before the value is saved, not after a
  // month of days stamped one behind.
  it('warns while an opening time is being typed into the cutover', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('edit-kalyani'))

    const cutover = screen.getByLabelText('The day rolls over at')
    await user.clear(cutover)
    await user.type(cutover, '12:00')

    expect(await screen.findByTestId('cutover-warning')).toHaveTextContent(
      'split across two business days',
    )
    expect(screen.getByTestId('cutover-preview')).toHaveTextContent('Prep starts, 11:00')
    expect(screen.getByTestId('cutover-preview')).toHaveTextContent('the day before')
  })
})

describe('closing and reopening an outlet', () => {
  it('offers closing once, at the foot of the page', async () => {
    renderPage('kalyani')

    const page = await screen.findByTestId('outlet-kalyani')
    expect(within(page).getAllByRole('button', { name: 'Mark closed' })).toHaveLength(1)
    expect(page.lastElementChild).toContainElement(screen.getByTestId('close-kalyani'))
  })

  it('states what closing does not do before it happens', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await user.click(await screen.findByTestId('close-kalyani'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('anyone mid-shift can still check out')
    expect(dialog).toHaveTextContent('Nothing is deleted')
    expect(dialog).toHaveTextContent('every recorded day stay exactly as they are')
  })

  it('marks the outlet closed and offers to reopen it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await markClosed(user, 'kalyani')

    const header = screen.getByRole('heading', { level: 1 }).closest('header')!
    await waitFor(() => expect(header).toHaveTextContent('Closed'))
    // A closed outlet has no counter to administer.
    expect(screen.queryByTestId('outlet-tablets')).toBeNull()

    await user.click(screen.getByTestId('reopen-kalyani'))
    await waitFor(() => expect(header).toHaveTextContent('Open'))
    expect(await screen.findByTestId('outlet-tablets')).toBeInTheDocument()
  })

  it('keeps a closed outlet listed for the owner, or it could never be reopened', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()

    renderPage('kalyani', adapters)
    await markClosed(user, 'kalyani')
    await screen.findByTestId('reopen-kalyani')

    // And it is gone from the list every other surface asks for. The owner's
    // list still carries the closed mis-created outlet the fixtures start with.
    expect(await adapters.outlets.listOutlets()).toHaveLength(1)
    expect(await adapters.outlets.listOutlets({ includeInactive: true })).toHaveLength(3)
  })
})

/**
 * Deleting an outlet — the one client-deletable table in the schema, and the
 * only screen that offers it.
 *
 * Two things carry these tests. Closing comes first, so a trading outlet must
 * offer no way to delete at all; and a refused delete must say what is still
 * attached rather than reporting an error, because "profiles_outlet_id_fkey"
 * is not something anybody can act on.
 */
describe('deleting an outlet', () => {
  /** The fixtures' mis-created outlet: closed, and nothing points at it. */
  const MISTAKE = 'demo-mistake'

  it('offers no delete on an outlet that is trading', async () => {
    renderPage('kalyani')

    await screen.findByTestId('outlet-kalyani')
    expect(screen.queryByTestId('delete-kalyani')).not.toBeInTheDocument()
    expect(screen.getByTestId('close-kalyani')).toBeInTheDocument()
  })

  it('offers it once the outlet is closed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kalyani')

    await markClosed(user, 'kalyani')

    expect(await screen.findByTestId('delete-kalyani')).toHaveTextContent('Delete outlet')
    expect(screen.queryByTestId('close-kalyani')).not.toBeInTheDocument()
  })

  it('deletes nothing until the confirmation is accepted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const remove = vi.spyOn(adapters.outlets, 'deleteOutlet')

    renderPage(MISTAKE, adapters)
    await user.click(await screen.findByTestId(`delete-${MISTAKE}`))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('removed, not hidden')
    expect(dialog).toHaveTextContent('no undo')
    expect(remove).not.toHaveBeenCalled()

    // And nothing is typed to get there: the outlet this exists to remove has
    // no name and no code to type (outlet-deletion, design D4).
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByTestId(`outlet-${MISTAKE}`)).toBeInTheDocument()
  })

  it('returns to the list, without the deleted outlet on it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage(MISTAKE)

    await user.click(await screen.findByTestId(`delete-${MISTAKE}`))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete outlet' }),
    )

    expect(await screen.findByTestId('outlet-list')).toBeInTheDocument()
    await screen.findByTestId('open-kalyani')
    expect(screen.queryByTestId(`open-${MISTAKE}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId('outlets-error')).not.toBeInTheDocument()
  })

  it('names what is still attached when the database refuses, and keeps the outlet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('kanchrapara')

    // Kanchrapara has people and accounts behind it, so it refuses — but it has
    // to be closed before the action is even offered.
    await markClosed(user, 'kanchrapara')
    await user.click(await screen.findByTestId('delete-kanchrapara'))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete outlet' }),
    )

    const refusal = await screen.findByTestId('delete-blocked-kanchrapara')
    // Staff are accounts, so what an outlet holds is people — one word for
    // one kind of row, with the count beside it.
    expect(refusal).toHaveTextContent(/people — \d+/)
    // A constraint name is not a sentence, and must not reach the screen.
    expect(refusal).not.toHaveTextContent('fkey')
    expect(screen.getByTestId('outlet-kanchrapara')).toBeInTheDocument()
  })

  it('gives a nameless outlet something to aim at', async () => {
    // The exact row outlet-deletion exists to remove: created with the
    // placeholders still showing, so name, code and location label are all
    // blank. A row that renders as nothing cannot be acted on.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const [first] = await adapters.outlets.listOutlets({ includeInactive: true })
    const nameless = {
      ...first!,
      id: 'blank-1',
      code: '  ',
      name: '   ',
      location_label: '',
      is_active: false,
    }
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([nameless])
    vi.spyOn(adapters.outlets, 'getOutlet').mockResolvedValue(nameless)

    renderOutlets(adapters)
    const row = await screen.findByTestId('open-blank-1')
    expect(row).toHaveTextContent('Outlet created without a name')

    await openFromList(user, 'blank-1')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Outlet created without a name',
    )
    expect(screen.getByTestId('delete-blank-1')).toBeInTheDocument()
  })
})

/**
 * The address search: what a pick actually writes, and what it deliberately
 * leaves alone.
 *
 * The mock lookup is deliberately the same one the demo uses, so these tests
 * and the demo walk cannot disagree about what a suggestion looks like.
 */
describe('filling an outlet address from a search', () => {
  /** Type into the combobox and let the debounce elapse. */
  async function search(user: ReturnType<typeof userEvent.setup>, query: string) {
    await user.type(screen.getByRole('combobox', { name: /Find the address/ }), query)
    await vi.advanceTimersByTimeAsync(400)
  }

  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId('add-outlet'))
  }

  it('fills the whole address block in one pick', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    expect(screen.getByLabelText('Address (optional)')).toHaveValue('Central Park')
    expect(screen.getByLabelText('Address line 2')).toHaveValue('B-7')
    expect(screen.getByLabelText('City')).toHaveValue('Kalyani')
    expect(screen.getByLabelText('PIN code')).toHaveValue('741235')
  })

  it('fills the district from the PIN, which is the field the map gets wrong', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    // OpenStreetMap would answer "B-7" here. Nadia is what goes on an invoice.
    await waitFor(() => expect(screen.getByLabelText('District')).toHaveValue('Nadia'))
  })

  it('fills the district for somebody who never opens the search', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await user.type(screen.getByLabelText('PIN code'), '743145')
    await vi.advanceTimersByTimeAsync(600)

    await waitFor(() => expect(screen.getByLabelText('District')).toHaveValue('North 24 Parganas'))
  })

  it('never overwrites a label the admin wrote', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await user.type(screen.getByLabelText('Location label'), 'The corner shop')
    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    expect(screen.getByLabelText('Location label')).toHaveValue('The corner shop')
  })

  it('fills an empty label from the place that was picked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    expect(screen.getByLabelText('Location label')).toHaveValue('Kalyani — Central Park')
  })

  it('leaves no mixture of two addresses behind', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))
    expect(screen.getByLabelText('PIN code')).toHaveValue('741235')

    // Ghoshpara Bazar carries no PIN. Keeping Kalyani's would put one place's
    // street beside another's PIN code — the failure nobody would notice.
    await user.clear(screen.getByRole('combobox', { name: /Find the address/ }))
    await search(user, 'Ghoshpara')
    await user.click(await screen.findByRole('option', { name: /Ghoshpara/ }))

    expect(screen.getByLabelText('Address (optional)')).toHaveValue('Ghoshpara Road')
    expect(screen.getByLabelText('PIN code')).toHaveValue('')
  })

  it('leaves every filled field editable', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    await user.clear(screen.getByLabelText('Address (optional)'))
    await user.type(screen.getByLabelText('Address (optional)'), 'Shop 4, Central Park')
    expect(screen.getByLabelText('Address (optional)')).toHaveValue('Shop 4, Central Park')
  })

  it('gives the outlet an address and still no position', async () => {
    // The whole reason the coordinates are dropped: a picked address must not
    // arm the geofence against a rooftop centroid, or somebody is marked absent
    // standing at their own counter.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await openForm(user)

    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await search(user, 'Central Park')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('uncaptured-barrackpore')).toHaveTextContent('Not captured')
  })
})

/**
 * Blank is not a value.
 *
 * An outlet reached production with no name: `required` was inert because the
 * form carries `noValidate`, `onSubmit` went straight to the adapter, and
 * `not null` has nothing to say about an empty string. These cover the middle
 * layer. The database refuses the same writes, proved in
 * `supabase/tests/12_required_fields_not_blank.sql`.
 */
describe('refusing a blank required field on the outlet form', () => {
  async function openAdd(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId('add-outlet'))
  }

  it('creates nothing and names the field when the name is left empty', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.outlets, 'createOutlet')
    renderOutlets(adapters)

    await openAdd(user)
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('needs a name')
    expect(create).not.toHaveBeenCalled()
  })

  it('treats a name of only spaces as no name at all', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.outlets, 'createOutlet')
    renderOutlets(adapters)

    await openAdd(user)
    // The case a `!== ''` guard would let straight through.
    await user.type(screen.getByLabelText('Name'), '   ')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('needs a name')
    expect(create).not.toHaveBeenCalled()
  })

  it('names the short code, not just the first missing field it finds', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.outlets, 'createOutlet')
    renderOutlets(adapters)

    await openAdd(user)
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    // One message per field. A single "fill in the required fields" would say
    // nothing about which of the four, on a phone where it is scrolled away.
    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('short code')
    expect(create).not.toHaveBeenCalled()
  })

  it('names the location label when that is the one left out', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.outlets, 'createOutlet')
    renderOutlets(adapters)

    await openAdd(user)
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('location label')
    expect(create).not.toHaveBeenCalled()
  })

  it('shows the refusal inside the open sheet, not on the page behind it', async () => {
    // The bug this exists to catch: the surface's own error region sits on the
    // page, and the form is a `fixed` overlay that covers the whole screen on a
    // phone. A refusal left only on the page is in the DOM, passes a
    // `findByTestId`, and is invisible to the person who just pressed the
    // button — so the guard reads as a dead button rather than an answer.
    // Design D3 keeps the button enabled precisely because the form "submits
    // and tells you"; if it does not tell you, that reasoning is gone.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await openAdd(user)
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    const sheet = screen.getByRole('dialog')
    const shown = within(sheet).getByTestId('form-sheet-error')
    expect(shown).toHaveTextContent('needs a name')
    expect(shown).toHaveAttribute('role', 'alert')
  })

  it('leaves the submit button enabled with every field empty', async () => {
    // Design D3, encoded. A dead button on a ten-field form says nothing about
    // which of the four required fields is missing; this form submits and then
    // tells you. Without this test the decision is indistinguishable from an
    // oversight, and the next person "fixes" it.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await openAdd(user)
    expect(screen.getByRole('button', { name: 'Create outlet' })).toBeEnabled()
  })

  it('refuses a name cleared while editing, not only one never typed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const update = vi.spyOn(adapters.outlets, 'updateOutlet')
    renderPage('kalyani', adapters)

    await user.click(await screen.findByTestId('edit-kalyani'))
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('needs a name')
    expect(update).not.toHaveBeenCalled()
  })
})

/**
 * A placeholder must not read as a value already filled in — and must not stop
 * being a label where it is doing a label's job. The narrowness is the
 * requirement (design D5), so both halves are asserted.
 */
describe('placeholders on the outlet form', () => {
  it('prefixes the sample values so none of them reads as a filled-in value', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await user.click(await screen.findByTestId('add-outlet'))

    // `Shawarmania Kalyani` is the name of a real outlet in this database. A
    // manager read it as already filled in, and created the nameless outlet.
    for (const label of ['Name', 'Short code', 'Location label']) {
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'placeholder',
        expect.stringMatching(/^e\.g\. /),
      )
    }
  })

  it('leaves the address placeholders alone, because they are the label', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()
    await user.click(await screen.findByTestId('add-outlet'))

    // These inputs carry `aria-label` and no visible label, so the placeholder
    // is the accessible name. `e.g. City` would be incoherent.
    for (const placeholder of ['City', 'District', 'PIN code', 'Line 2', 'Street and landmark']) {
      expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument()
    }
  })
})
