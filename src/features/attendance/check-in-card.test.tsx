import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { StaffHome } from '../overview/staff-home'

/**
 * The Employee's day, driven end to end through the mock adapter and a stubbed
 * geolocation API.
 *
 * The stub is the whole reason `src/lib/geolocation.ts` is one module: a
 * blocked check-in is the single most important state on this screen, and
 * without the seam it could only be exercised by denying a real browser
 * permission.
 */

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346, accuracy: 12 }
/** Far outside a 150 m fence. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362, accuracy: 45 }

let getCurrentPosition: ReturnType<typeof vi.fn>

function atPosition(coords: { latitude: number; longitude: number; accuracy: number }) {
  getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
    onSuccess({
      coords,
      timestamp: Date.parse('2026-07-27T04:00:00Z'),
    } as GeolocationPosition),
  )
}

function positionFails(code: number) {
  getCurrentPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) =>
    onError({ code } as GeolocationPositionError),
  )
}

beforeEach(() => {
  getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation')
})

const employeeSession: Session = {
  mode: 'demo',
  userId: personaFixtures.employee.profile.id,
  role: 'employee',
  outletId: OUTLET_KALYANI_ID,
  displayName: personaFixtures.employee.profile.full_name,
  persona: personaFixtures.employee,
}

function renderHome(adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={employeeSession}>
          <AdaptersContext.Provider value={adapters}>
            <StaffHome />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the employee home', () => {
  it('opens on the one big button, with nothing recorded yet', async () => {
    renderHome()

    expect(await screen.findByTestId('attendance-action')).toHaveTextContent('Check in')
    expect(screen.getByRole('link', { name: 'My attendance' })).toBeInTheDocument()
  })

  it('records a check-in taken at the counter, then offers check-out', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    atPosition(AT_COUNTER)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))

    await waitFor(() =>
      expect(screen.getByTestId('attendance-action')).toHaveTextContent('Check out'),
    )
    expect(screen.getByText(/12 m from the outlet/)).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-blocked')).not.toBeInTheDocument()
  })

  it('refuses a check-in taken outside the fence, and explains it', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    atPosition(DOWN_THE_ROAD)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))

    const blocked = await screen.findByTestId('attendance-blocked')
    expect(blocked).toHaveTextContent('too far from the outlet')
    // The distance, the limit, how far beyond, and the reading's own accuracy.
    expect(blocked).toHaveTextContent('150 m')
    expect(blocked).toHaveTextContent('±45 m')
    expect(screen.getByTestId('request-override')).toBeInTheDocument()
  })

  it('writes nothing when a blocked check-in is abandoned', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const checkIn = vi.spyOn(adapters.attendance, 'checkIn')
    atPosition(DOWN_THE_ROAD)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))
    await screen.findByTestId('attendance-blocked')
    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByTestId('attendance-blocked')).not.toBeInTheDocument()
    expect(checkIn).not.toHaveBeenCalled()
  })

  it('records the day as awaiting approval when an override is requested', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    atPosition(DOWN_THE_ROAD)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))
    await user.click(await screen.findByTestId('request-override'))

    // Claimed present, stored absent — and said so in words, not as a status code.
    expect(await screen.findByText('Waiting for a manager to approve')).toBeInTheDocument()
  })

  it.each([
    [1, 'Location permission is off'],
    [2, 'could not find a position'],
    [3, 'took too long'],
  ])('names geolocation failure %d rather than failing generically', async (code, copy) => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    positionFails(code)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))

    expect(await screen.findByTestId('attendance-unlocatable')).toHaveTextContent(copy)
    // The same way through is offered.
    expect(screen.getByTestId('request-override')).toBeInTheDocument()
  })

  it('records a positionless day when the device cannot help', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    positionFails(1)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))
    await user.click(await screen.findByTestId('request-override'))

    expect(await screen.findByText('Waiting for a manager to approve')).toBeInTheDocument()
  })

  it('offers nothing further once the day is complete', async () => {
    const adapters = createMockAdapters()
    // Staff are accounts: the employee's history is keyed by their own id.
    const history = await adapters.attendance.listHistory(personaFixtures.employee.profile.id)
    // Yesterday is the completed day in the fixtures.
    const complete = history.find((record) => record.checkOut !== null)!
    vi.spyOn(adapters.attendance, 'getDay').mockResolvedValue(complete)

    renderHome(adapters)

    expect(await screen.findByTestId('attendance-complete')).toHaveTextContent(
      'Your day is recorded',
    )
    expect(screen.queryByTestId('attendance-action')).not.toBeInTheDocument()
  })

  it('does not read a position while the screen merely sits open', async () => {
    renderHome()
    await screen.findByTestId('attendance-action')

    // The no-background-tracking rule, asserted rather than trusted.
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})
