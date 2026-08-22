import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { resolveBusinessDate } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { StaffHome } from '../overview/staff-home'
import { isLate } from './attendance-record'

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
const AT_KANCHRAPARA = { latitude: 22.94508, longitude: 88.43312, accuracy: 14 }

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
  vi.useRealTimers()
})

/**
 * The Employee persona works both outlets since multi-outlet-people, which is
 * the whole point of them — but most of what this file asserts is the
 * single-outlet experience, and that has to keep reading exactly as it did.
 * So the sessions are built explicitly: one assignment, or both.
 */
function sessionWith(assignments: typeof personaFixtures.employee.assignments): Session {
  return {
    mode: 'demo',
    userId: personaFixtures.employee.profile.id,
    assignments,
    ...deriveSessionScope(assignments),
    displayName: personaFixtures.employee.profile.full_name,
    persona: personaFixtures.employee,
  }
}

const oneOutlet = personaFixtures.employee.assignments.slice(0, 1)
const employeeSession: Session = sessionWith(oneOutlet)
const bothOutletsSession: Session = sessionWith(personaFixtures.employee.assignments)

function renderHome(
  adapters: DataAdapters = createMockAdapters(),
  session: Session = employeeSession,
) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
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

  it('records a check-in taken at the counter, and says it is waiting', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    atPosition(AT_COUNTER)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))

    // Inside the fence and still not counted: the fence is evidence, and only a
    // manager's approval settles a day. The screen must never imply otherwise.
    await waitFor(() =>
      expect(screen.getByTestId('attendance-waiting')).toHaveTextContent(
        'waiting for your manager to approve it',
      ),
    )
    expect(screen.getByText('Waiting for a manager to approve')).toBeInTheDocument()
    expect(screen.getByText(/^12 m$/)).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-blocked')).not.toBeInTheDocument()
  })

  it('confirms material retry changes, and writes only when the employee uses the new check-in', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const outlet = await adapters.outlets.getOutlet(OUTLET_KALYANI_ID)
    if (!outlet) throw new Error('missing demo outlet')
    const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
    await adapters.attendance.checkIn({
      personId: personaFixtures.employee.profile.id,
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      reading: {
        latitude: DOWN_THE_ROAD.latitude,
        longitude: DOWN_THE_ROAD.longitude,
        accuracyMetres: DOWN_THE_ROAD.accuracy,
        at: new Date().toISOString(),
      },
    })
    atPosition(AT_KANCHRAPARA)
    renderHome(adapters, bothOutletsSession)

    await user.click(await screen.findByTestId('attendance-retry'))
    expect(await screen.findByRole('dialog', { name: 'Use this new check-in?' })).toHaveTextContent(
      /Kalyani.*Kanchrapara/,
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(/outside fence.*inside fence/)
    await user.click(screen.getByRole('button', { name: 'Keep existing check-in' }))
    expect(
      (await adapters.attendance.getDay(personaFixtures.employee.profile.id, businessDate))
        ?.attempts,
    ).toHaveLength(1)

    await user.click(screen.getByTestId('attendance-retry'))
    await user.click(await screen.findByTestId('confirm-retry'))
    await waitFor(async () => {
      const record = await adapters.attendance.getDay(
        personaFixtures.employee.profile.id,
        businessDate,
      )
      expect(record?.attempts).toHaveLength(2)
      expect(record?.outletId).toBe(OUTLET_KANCHRAPARA_ID)
      expect(record?.status).toBe('absent')
      expect(record?.currentAttemptId).toBe(record?.attempts.at(-1)?.id)
    })
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
    // And what approving it will cost the manager, so the person asking knows
    // what they are asking for.
    expect(blocked).toHaveTextContent('will have to give a reason')
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

  it('records the day as awaiting approval when it is recorded anyway', async () => {
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

  it('offers nothing further once a manager has approved the day', async () => {
    const adapters = createMockAdapters()
    // Staff are accounts: the employee's history is keyed by their own id. The
    // range is wide enough to reach the approved day in the fixtures.
    const history = await adapters.attendance.listHistory(
      personaFixtures.employee.profile.id,
      '2000-01-01',
      '2100-01-01',
    )
    const approved = history.find(
      (record) => record.approval !== null && record.outletId === OUTLET_KALYANI_ID,
    )!
    vi.spyOn(adapters.attendance, 'getDay').mockResolvedValue(approved)

    renderHome(adapters)

    expect(await screen.findByTestId('attendance-approved')).toHaveTextContent(
      'Your manager has approved today',
    )
    expect(screen.queryByTestId('attendance-action')).not.toBeInTheDocument()
  })

  it('shows a late arrival as late, against the deadline the row was stamped with', async () => {
    const adapters = createMockAdapters()
    const history = await adapters.attendance.listHistory(
      personaFixtures.employee.profile.id,
      '2000-01-01',
      '2100-01-01',
    )
    // Found by the same rule the surfaces use rather than by a hard-coded
    // instant: the fixture's 14:20 arrival against Kalyani's 13:00 deadline.
    const late = history.find((record) => isLate(record, '04:00:00'))!
    vi.spyOn(adapters.attendance, 'getDay').mockResolvedValue(late)

    renderHome(adapters)

    expect(await screen.findByTestId('late-tag')).toHaveTextContent('late')
  })

  it('does not read a position while the screen merely sits open', async () => {
    renderHome()
    await screen.findByTestId('attendance-action')

    // The no-background-tracking rule, asserted rather than trusted.
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('uses server attendance context despite a deliberately skewed browser clock', async () => {
    const adapters = createMockAdapters()
    // Today, by the demo store's own reckoning — deliberately rowless for the
    // employee, so the card opens on the one big button whatever day this runs.
    // A literal date here was a time bomb: it passed while the calendar agreed
    // with it, and failed the day an approved seed drifted onto the date.
    const today = (
      await adapters.attendance.getCurrentContext([OUTLET_KALYANI_ID])
    ).outlets[0]?.businessDate
    expect(today).toBeTruthy()
    const context = {
      serverAt: '2026-08-20T06:00:00.000Z',
      outlets: [{ outletId: OUTLET_KALYANI_ID, businessDate: today! }],
    }
    vi.spyOn(adapters.attendance, 'getCurrentContext').mockResolvedValue(context)
    const checkIn = vi.spyOn(adapters.attendance, 'checkIn')
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
      onSuccess({
        coords: AT_COUNTER,
        // This is what the browser would report from a badly skewed device.
        timestamp: Date.parse('2040-01-01T00:00:00.000Z'),
      } as GeolocationPosition),
    )

    renderHome(adapters)
    await userEvent.setup().click(await screen.findByTestId('attendance-action'))

    await waitFor(() => expect(checkIn).toHaveBeenCalled())
    expect(checkIn.mock.calls[0]?.[0].businessDate).toBe(today!)
    expect(checkIn.mock.calls[0]?.[0].reading?.at).toBe('2040-01-01T00:00:00.000Z')
  })

  it('loads both server dates between outlet cutovers and refreshes context in the foreground', async () => {
    const adapters = createMockAdapters()
    const context = {
      serverAt: '2026-08-20T02:00:00.000Z',
      outlets: [
        { outletId: OUTLET_KALYANI_ID, businessDate: '2026-08-20' },
        { outletId: OUTLET_KANCHRAPARA_ID, businessDate: '2026-08-19' },
      ],
    }
    const getContext = vi.spyOn(adapters.attendance, 'getCurrentContext').mockResolvedValue(context)
    const getDay = vi.spyOn(adapters.attendance, 'getDay')

    renderHome(adapters, bothOutletsSession)
    await waitFor(() => expect(getDay).toHaveBeenCalledTimes(2))
    expect(getDay.mock.calls.map(([, businessDate]) => businessDate)).toEqual(
      expect.arrayContaining(['2026-08-20', '2026-08-19']),
    )
    expect(getCurrentPosition).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(getContext).toHaveBeenCalledTimes(2))
    // A context refresh is a read, never a background geolocation request.
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('refreshes server context after a successful write crosses cutover', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const getCurrentContext = adapters.attendance.getCurrentContext.bind(adapters.attendance)
    const context = vi
      .spyOn(adapters.attendance, 'getCurrentContext')
      .mockResolvedValueOnce({
        serverAt: '1900-01-01T00:00:00.000Z',
        outlets: [{ outletId: OUTLET_KALYANI_ID, businessDate: '1900-01-01' }],
      })
      .mockImplementation(getCurrentContext)
    positionFails(1)

    renderHome(adapters)
    await user.click(await screen.findByTestId('attendance-action'))
    await user.click(await screen.findByTestId('request-override'))

    await waitFor(() => expect(context).toHaveBeenCalledTimes(2))
    // The position-free write is retryable. It becomes visible only after the
    // post-write context adopts the business date authored by the mock server.
    expect(await screen.findByTestId('attendance-retry')).toBeInTheDocument()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
})

/**
 * The person who works at two outlets.
 *
 * The gate clause this change exists for: they check in and out at each from
 * their own phone, with nothing to switch — the fence works out where they
 * are. Everything below is about that resolution, because the writing itself
 * is the same code path a single-outlet person takes.
 */
describe('an employee assigned to two outlets', () => {
  /** Kanchrapara's counter, from its own outlet fixture. */
  const AT_KANCHRAPARA = { latitude: 22.94508, longitude: 88.43312, accuracy: 14 }

  it('offers no outlet choice at all — the fence is the only chooser', async () => {
    atPosition(AT_COUNTER)
    renderHome(createMockAdapters(), bothOutletsSession)

    await screen.findByTestId('attendance-action')
    // Not a select, not a pair of buttons, not a "which shop?" prompt. The
    // proposal rejected anything a person has to switch, and this is where
    // that would have crept back in.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/which (shop|outlet)/i)).not.toBeInTheDocument()
  })

  it('records the check-in at the outlet they are standing in', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const checkIn = vi.spyOn(adapters.attendance, 'checkIn')
    atPosition(AT_KANCHRAPARA)
    renderHome(adapters, bothOutletsSession)

    await user.click(await screen.findByTestId('attendance-action'))

    await waitFor(() => expect(checkIn).toHaveBeenCalled())
    expect(checkIn.mock.calls[0]?.[0].outletId).toBe(OUTLET_KANCHRAPARA_ID)
  })

  it('records it at the other outlet when they are standing there instead', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const checkIn = vi.spyOn(adapters.attendance, 'checkIn')
    atPosition(AT_COUNTER)
    renderHome(adapters, bothOutletsSession)

    await user.click(await screen.findByTestId('attendance-action'))

    await waitFor(() => expect(checkIn).toHaveBeenCalled())
    expect(checkIn.mock.calls[0]?.[0].outletId).toBe(OUTLET_KALYANI_ID)
  })

  it('blocks at the nearest assigned outlet when they are inside neither fence', async () => {
    const user = userEvent.setup()
    atPosition(DOWN_THE_ROAD)
    renderHome(createMockAdapters(), bothOutletsSession)

    await user.click(await screen.findByTestId('attendance-action'))

    // Blocked, with an override to ask for — and named, because "the outlet"
    // means nothing to somebody who works at two. DOWN_THE_ROAD is Kalyani's
    // neighbourhood, so Kalyani is who gets asked.
    const blocked = await screen.findByTestId('attendance-blocked')
    expect(blocked).toHaveTextContent('Shawarmania Kalyani')
    expect(screen.getByTestId('request-override')).toBeInTheDocument()
  })

  it('asks which outlet when the phone can supply no position', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const checkIn = vi.spyOn(adapters.attendance, 'checkIn')
    positionFails(2)
    renderHome(adapters, bothOutletsSession)

    await user.click(await screen.findByTestId('attendance-action'))

    // The one place anybody is ever asked which shop they are at
    // (attendance-one-day-per-person, design D5). #28 refused outright here;
    // there is no ambiguity to resolve and no data, so a question is the only
    // honest input left. Nothing is recorded until they answer.
    const asked = await screen.findByTestId('attendance-which-outlet')
    expect(asked).toHaveTextContent(/which one you are at/i)
    expect(checkIn).not.toHaveBeenCalled()

    // Both shops are offered, and neither is pre-selected.
    expect(await screen.findByTestId(`choose-outlet-${OUTLET_KALYANI_ID}`)).toBeInTheDocument()
    await user.click(screen.getByTestId(`choose-outlet-${OUTLET_KANCHRAPARA_ID}`))

    // Recorded at the shop they picked, with no coordinates at all — so it
    // waits for that outlet's manager, who must give a reason to settle it.
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1))
    expect(checkIn.mock.calls[0]?.[0]).toMatchObject({
      outletId: OUTLET_KANCHRAPARA_ID,
      reading: null,
    })
    expect(await screen.findByTestId('attendance-waiting')).toBeInTheDocument()
  })

  it('never asks somebody who works at one shop', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    positionFails(1)
    renderHome(adapters)

    await user.click(await screen.findByTestId('attendance-action'))

    // Nothing to resolve, so nothing to ask: the flow is exactly what it was.
    expect(await screen.findByTestId('attendance-unlocatable')).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-which-outlet')).not.toBeInTheDocument()
  })
})
