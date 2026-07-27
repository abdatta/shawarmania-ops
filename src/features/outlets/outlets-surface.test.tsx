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
    watchPosition.mockImplementation(
      (_ok: PositionCallback, onError: PositionErrorCallback) => {
        onError({ code: 1 } as GeolocationPositionError)
        return 1
      },
    )

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
