import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { OutletsSurface } from './outlets-surface'

/**
 * Capturing an outlet's position. The accuracy rules are the substance here:
 * this reading is judged once and then judges every future check-in, so a loose
 * fix must not be saveable by accident.
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
  role: 'super_admin',
  outletId: null,
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

function renderOutlets(adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={ownerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/** Open the capture sheet for an outlet and let the sampling window close. */
async function takeReading(user: ReturnType<typeof userEvent.setup>, outletName: RegExp) {
  const cards = await screen.findByTestId('outlet-list')
  const card = Array.from(cards.children).find((child) =>
    outletName.test(child.textContent ?? ''),
  ) as HTMLElement
  await user.click(
    within(card).getByRole('button', { name: /Capture position here|Capture again/ }),
  )
  await user.click(await screen.findByTestId('take-reading'))
  await vi.advanceTimersByTimeAsync(8_000)
}

describe('the outlets surface', () => {
  it('says which outlets have never been surveyed', async () => {
    renderOutlets()

    await screen.findByTestId('outlet-list')
    // Kanchrapara carries placeholder coordinates and no capture record.
    expect(screen.getByTestId('uncaptured-kanchrapara')).toHaveTextContent('never captured on site')
    expect(screen.queryByTestId('uncaptured-kalyani')).not.toBeInTheDocument()
  })

  it('shows how good the surveyed fix was, and when it was taken', async () => {
    renderOutlets()

    await screen.findByTestId('outlet-list')
    expect(screen.getByText(/Captured on site/)).toHaveTextContent('accurate to ±9 m')
  })

  it('keeps the tightest sample and saves a good fix', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const save = vi.spyOn(adapters.outlets, 'saveLocation')
    samples(60, 8, 40)

    renderOutlets(adapters)
    await takeReading(user, /Kanchrapara/)

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

    renderOutlets()
    await takeReading(user, /Kanchrapara/)

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

    renderOutlets(adapters)
    await takeReading(user, /Kanchrapara/)

    const result = await screen.findByTestId('capture-result')
    expect(result).toHaveAttribute('data-quality', 'unusable')
    expect(result).toHaveTextContent('too loose to save')
    expect(screen.queryByTestId('save-position')).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('offers one way to retry a refused reading, not two', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(180)

    renderOutlets()
    await takeReading(user, /Kanchrapara/)
    await screen.findByTestId('capture-result')

    // The footer and the result block both used to carry a retry, one labelled
    // "Take a reading" and the other "Take another reading" — the same call,
    // stacked in one sheet, reading as two different actions.
    expect(screen.getAllByRole('button', { name: /reading/i })).toHaveLength(1)
    expect(screen.getByTestId('take-reading')).toHaveTextContent('Take another reading')
    expect(screen.queryByTestId('retake-reading')).not.toBeInTheDocument()

    // And nothing offers to configure a save that cannot happen.
    expect(screen.queryByLabelText('How far from here may staff check in?')).not.toBeInTheDocument()
  })

  it('keeps the retry beside the save when a reading is good enough', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(12)

    renderOutlets()
    await takeReading(user, /Kanchrapara/)
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

    renderOutlets(adapters)
    await takeReading(user, /Kanchrapara/)

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

    renderOutlets()
    await takeReading(user, /Kanchrapara/)

    expect(await screen.findByTestId('capture-failed')).toHaveAttribute('data-failure', 'denied')
  })

  it('shows the new position on the list after saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    samples(11)

    renderOutlets()
    await takeReading(user, /Kanchrapara/)
    await user.click(await screen.findByTestId('save-position'))

    await waitFor(() =>
      expect(screen.queryByTestId('uncaptured-kanchrapara')).not.toBeInTheDocument(),
    )
  })
})

/**
 * The empty database — the screen a new owner actually sees first, and the one
 * that used to be a dead end. Nothing here may assume a row exists.
 */
describe('the outlets surface with nothing in it', () => {
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

    await user.click(await screen.findByTestId('add-outlet'))
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'barrackpore', name: 'Shawarmania Barrackpore' }),
      ),
    )
  })

  it('renders every control without a single outlet present', async () => {
    renderOutlets(emptyOutlets())

    await screen.findByTestId('add-outlet')
    expect(screen.queryByTestId('outlet-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('outlets-error')).not.toBeInTheDocument()
  })
})

describe('creating and editing an outlet', () => {
  it('adds an outlet and shows it on the list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await user.click(await screen.findByTestId('add-outlet'))
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('outlet-barrackpore')).toBeInTheDocument()
  })

  it('gives a new outlet no position, so it judges nobody until it is captured', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await user.click(await screen.findByTestId('add-outlet'))
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Barrackpore')
    await user.type(screen.getByLabelText('Short code'), 'barrackpore')
    await user.type(screen.getByLabelText('Location label'), 'Barrackpore')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('uncaptured-barrackpore')).toHaveTextContent(
      'not measured against a geofence at all',
    )
  })

  it('refuses a code another outlet already uses, and says so', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await user.click(await screen.findByTestId('add-outlet'))
    await user.type(screen.getByLabelText('Name'), 'Shawarmania Kalyani Two')
    await user.type(screen.getByLabelText('Short code'), 'kalyani')
    await user.type(screen.getByLabelText('Location label'), 'Kalyani')
    await user.click(screen.getByRole('button', { name: 'Create outlet' }))

    expect(await screen.findByTestId('outlets-error')).toHaveTextContent('already used')
  })

  it('edits an existing outlet from its own values', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Edit' }))

    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Shawarmania Kalyani')
    await user.clear(name)
    await user.type(name, 'Shawarmania Kalyani Central')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Shawarmania Kalyani Central')).toBeInTheDocument()
  })

  it('says the cutover cannot move anything already recorded', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('The business day starts at')).toHaveValue('04:00')
    expect(screen.getByText(/never moves anything already recorded/)).toBeInTheDocument()
  })
})

describe('closing and reopening an outlet', () => {
  it('states what closing does not do before it happens', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Mark closed' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('anyone mid-shift can still check out')
    expect(dialog).toHaveTextContent('Nothing is deleted')
    expect(dialog).toHaveTextContent('every recorded day stay exactly as they are')
  })

  it('marks the outlet closed and offers to reopen it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Mark closed' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
    )

    expect(await screen.findByTestId('closed-kalyani')).toHaveTextContent('Nobody can check in')

    await user.click(
      within(screen.getByTestId('outlet-kalyani')).getByRole('button', { name: 'Reopen' }),
    )
    await waitFor(() => expect(screen.queryByTestId('closed-kalyani')).not.toBeInTheDocument())
  })

  it('keeps a closed outlet visible to the owner, or it could never be reopened', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()

    renderOutlets(adapters)
    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Mark closed' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
    )
    await screen.findByTestId('closed-kalyani')

    // And it is gone from the list every other surface asks for.
    expect(await adapters.outlets.listOutlets()).toHaveLength(1)
    expect(await adapters.outlets.listOutlets({ includeInactive: true })).toHaveLength(2)
  })
})
