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
import { deriveSessionScope } from '@/session/session'

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
  assignments: personaFixtures.super_admin.assignments,
  ...deriveSessionScope(personaFixtures.super_admin.assignments),
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
 * Two things carry these tests. Closing comes first, so an active outlet must
 * offer no way to delete at all; and a refused delete must say what is still
 * attached rather than reporting an error, because "profiles_outlet_id_fkey"
 * is not something anybody can act on.
 */
describe('deleting an outlet', () => {
  /** The fixtures' mis-created outlet: closed, and nothing points at it. */
  const MISTAKE = 'demo-mistake'

  it('offers no delete on an outlet that is trading', async () => {
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    expect(within(card).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Mark closed' })).toBeInTheDocument()
  })

  it('offers it once the outlet is closed, and says why closing came first', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Mark closed' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
    )

    const closed = await screen.findByTestId('outlet-kalyani')
    expect(within(closed).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByTestId('closed-kalyani')).toHaveTextContent('should never have existed')
  })

  it('deletes nothing until the confirmation is accepted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const adapters = createMockAdapters()
    const remove = vi.spyOn(adapters.outlets, 'deleteOutlet')

    renderOutlets(adapters)
    await user.click(
      within(await screen.findByTestId(`outlet-${MISTAKE}`)).getByTestId(`delete-${MISTAKE}`),
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('removed, not hidden')
    expect(dialog).toHaveTextContent('no undo')
    expect(remove).not.toHaveBeenCalled()

    // And nothing is typed to get there: the outlet this exists to remove has
    // no name and no code to type (design D4).
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByTestId(`outlet-${MISTAKE}`)).toBeInTheDocument()
  })

  it('takes a deleted outlet off the list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    await user.click(
      within(await screen.findByTestId(`outlet-${MISTAKE}`)).getByTestId(`delete-${MISTAKE}`),
    )
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete outlet' }),
    )

    await waitFor(() => expect(screen.queryByTestId(`outlet-${MISTAKE}`)).not.toBeInTheDocument())
    expect(screen.queryByTestId('outlets-error')).not.toBeInTheDocument()
  })

  it('names what is still attached when the database refuses, and keeps the outlet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderOutlets()

    // Kanchrapara has a roster and accounts behind it, so it refuses — but it
    // has to be closed before the action is even offered.
    const card = await screen.findByTestId('outlet-kanchrapara')
    await user.click(within(card).getByRole('button', { name: 'Mark closed' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
    )
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
    // The exact row this change exists to remove: created with the
    // placeholders still showing, so name, code and location label are all
    // blank. A card that renders as nothing cannot be acted on.
    const adapters = createMockAdapters()
    const [first] = await adapters.outlets.listOutlets({ includeInactive: true })
    const nameless = { ...first!, id: 'blank-1', code: '  ', name: '   ', location_label: '' }
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([{ ...nameless, is_active: false }])

    renderOutlets(adapters)

    const card = await screen.findByTestId('outlet-blank-1')
    expect(card).toHaveTextContent('Outlet created without a name')
    expect(within(card).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
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

    expect(await screen.findByTestId('uncaptured-barrackpore')).toHaveTextContent(
      'not measured against a geofence at all',
    )
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
    renderOutlets(adapters)

    const card = await screen.findByTestId('outlet-kalyani')
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
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

/**
 * The staff code prefix. It ends up on every staff code at the outlet forever,
 * so it arrives filled in rather than asked for — and stops being editable the
 * moment a code has been issued from it.
 */
