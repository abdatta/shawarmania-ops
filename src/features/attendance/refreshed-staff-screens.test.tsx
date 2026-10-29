import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChangeGateKey } from '@/change-gates/gates'
import type { AttendanceRecord, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { StaffHome } from '../overview/staff-home'
import { ApprovalNote } from './evidence'
import { MyAttendance } from './my-attendance'

/**
 * The refreshed staff screens (a-check-in-at-the-shop-approves-itself, design
 * D7–D8): Home as a pass for today, and the month as a calendar. Driven through
 * the mock adapter and a stubbed geolocation, both gates named.
 */

const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346, accuracy: 12 }
const FAR_AWAY = { latitude: 22.997, longitude: 88.4346, accuracy: 20 }

let getCurrentPosition: ReturnType<typeof vi.fn>
let watchPosition: ReturnType<typeof vi.fn>

/**
 * The phone reads the same place however long it is asked. The refreshed card
 * keeps reading after a reading outside the fence (design D7), so the watch has
 * to answer too, or the window runs its full six seconds.
 */
function atPosition(coords: { latitude: number; longitude: number; accuracy: number }) {
  const answer = (onSuccess: PositionCallback) =>
    onSuccess({ coords, timestamp: Date.now() } as GeolocationPosition)
  getCurrentPosition.mockImplementation(answer)
  watchPosition.mockImplementation((onSuccess: PositionCallback) => {
    answer(onSuccess)
    return 1
  })
}

beforeEach(() => {
  getCurrentPosition = vi.fn()
  watchPosition = vi.fn().mockReturnValue(1)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation')
  Reflect.deleteProperty(navigator, 'permissions')
  vi.useRealTimers()
})

/**
 * A reading outside the fence never gets good enough, so the refreshed card
 * reads for its whole window before answering (design D7). The clock is moved
 * rather than waited on.
 */
function awayClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function letTheReadingFinish() {
  await act(() => vi.advanceTimersByTimeAsync(6_000))
}

/** One outlet, so the fence has one shop to judge against. */
const assignments = personaFixtures.employee.assignments.slice(0, 1)
const session: Session = {
  mode: 'demo',
  userId: personaFixtures.employee.profile.id,
  assignments,
  ...deriveSessionScope(assignments),
  displayName: personaFixtures.employee.profile.full_name,
  persona: personaFixtures.employee,
}

function renderWith(
  ui: React.ReactNode,
  gates: Partial<Record<ChangeGateKey, boolean>>,
  adapters: DataAdapters = createMockAdapters(
    'employee',
    createDemoData({ autoApproving: () => gates['auto-approve-at-the-shop'] === true }),
  ),
) {
  render(
    <MemoryRouter>
      <ChangeGatesForTest on={gates}>
        <SessionContext.Provider value={session}>
          <AdaptersContext.Provider value={adapters}>{ui}</AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  return adapters
}

describeChangeGate('refreshed-staff-screens', (on) => {
  // The refreshed screens run only under the rule they are drawn around.
  const gates = { 'auto-approve-at-the-shop': true, 'refreshed-staff-screens': on }

  it(
    on ? 'opens Home on the pass for today, with no greeting' : 'opens Home as it was',
    async () => {
      renderWith(<StaffHome />, gates)

      expect(await screen.findByTestId('attendance-action')).toHaveTextContent('Check in')
      if (on) {
        expect(screen.getByTestId('today-pass-heading')).toBeInTheDocument()
        expect(screen.getByTestId('today-pass-deadline')).toHaveTextContent(/1:00 pm/)
        expect(screen.queryByText(/^Hello,/)).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'My attendance' })).not.toBeInTheDocument()
      } else {
        expect(screen.getByText(/^Hello,/)).toBeInTheDocument()
        expect(screen.queryByTestId('today-pass')).not.toBeInTheDocument()
      }
    },
  )

  it('says a check-in at the counter is approved', async () => {
    const user = userEvent.setup()
    atPosition(AT_COUNTER)
    renderWith(<StaffHome />, gates)

    await user.click(await screen.findByTestId('attendance-action'))

    if (on) {
      await waitFor(() =>
        expect(screen.getByTestId('today-pass-approved')).toHaveTextContent('Approved'),
      )
      expect(screen.getByTestId('place-chip')).toHaveTextContent('At the shop')
      // The manager's numbers are not the person's words.
      expect(screen.queryByText(/^12 m$/)).not.toBeInTheDocument()
    } else {
      await waitFor(() =>
        expect(screen.getByTestId('attendance-approved')).toHaveTextContent('approved today'),
      )
    }
  })

  it('offers to record a check-in from away for a manager', async () => {
    const user = awayClock()
    atPosition(FAR_AWAY)
    renderWith(<StaffHome />, gates)

    await user.click(await screen.findByTestId('attendance-action'))
    await letTheReadingFinish()

    expect(await screen.findByTestId('attendance-blocked')).toBeInTheDocument()
    expect(screen.getByTestId('request-override')).toBeInTheDocument()
    if (on) {
      // One sentence and one decision, in the popup; the numbers are behind Why?.
      const steps = screen.getByTestId('check-in-steps')
      expect(within(steps).getByTestId('attendance-blocked')).toBeInTheDocument()
      expect(within(steps).getByTestId('attendance-why')).toBeInTheDocument()
    }
  })

  it('waits quietly after recording from away, with a better try offered second', async () => {
    const user = awayClock()
    atPosition(FAR_AWAY)
    renderWith(<StaffHome />, gates)

    await user.click(await screen.findByTestId('attendance-action'))
    await letTheReadingFinish()
    await user.click(await screen.findByTestId('request-override'))

    expect(await screen.findByTestId('attendance-waiting')).toBeInTheDocument()
    if (on) {
      expect(screen.getByTestId('attendance-waiting')).toHaveTextContent('Waiting for your manager')
      expect(screen.getByTestId('attendance-retry')).toHaveTextContent('Check my location again')
    } else {
      expect(screen.getByTestId('attendance-retry')).toHaveTextContent('Check in again')
    }
  })

  if (on) {
    it('saves nothing on a recheck that is still away', async () => {
      const user = awayClock()
      atPosition(FAR_AWAY)
      const adapters = renderWith(<StaffHome />, gates)

      await user.click(await screen.findByTestId('attendance-action'))
      await letTheReadingFinish()
      await user.click(await screen.findByTestId('request-override'))
      await screen.findByTestId('attendance-waiting')
      const before = await adapters.attendance.listHistory(
        session.userId,
        '2000-01-01',
        '2100-01-01',
      )

      await user.click(screen.getByTestId('attendance-retry'))

      expect(await screen.findByTestId('recheck-missed')).toHaveTextContent('Still not at the shop')
      expect(screen.queryByTestId('check-in-steps')).not.toBeInTheDocument()
      expect(screen.queryByTestId('attendance-retry')).not.toBeInTheDocument()

      // The answer stands in for the link for three seconds, then the link returns.
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      expect(screen.queryByTestId('recheck-missed')).not.toBeInTheDocument()
      expect(screen.getByTestId('attendance-retry')).toHaveTextContent('Check my location again')
      expect(
        await adapters.attendance.listHistory(session.userId, '2000-01-01', '2100-01-01'),
      ).toEqual(before)
    })

    it('approves a recheck from the shop with no question asked', async () => {
      const user = awayClock()
      atPosition(FAR_AWAY)
      renderWith(<StaffHome />, gates)

      await user.click(await screen.findByTestId('attendance-action'))
      await letTheReadingFinish()
      await user.click(await screen.findByTestId('request-override'))
      await screen.findByTestId('attendance-waiting')

      atPosition(AT_COUNTER)
      await user.click(screen.getByTestId('attendance-retry'))

      await waitFor(() =>
        expect(screen.getByTestId('today-pass-approved')).toHaveTextContent('Approved'),
      )
      expect(screen.queryByTestId('confirm-retry')).not.toBeInTheDocument()
      // Approved is done: nothing more to press.
      expect(screen.queryByTestId('attendance-retry')).not.toBeInTheDocument()
    })

    it('reads the location again on Check in anyway, and approves once inside', async () => {
      const user = awayClock()
      atPosition(FAR_AWAY)
      renderWith(<StaffHome />, gates)

      await user.click(await screen.findByTestId('attendance-action'))
      await letTheReadingFinish()
      expect(await screen.findByTestId('attendance-blocked')).toBeInTheDocument()

      // Walked in while the panel was up.
      atPosition(AT_COUNTER)
      await user.click(screen.getByRole('button', { name: /Check in anyway/ }))

      await waitFor(() =>
        expect(screen.getByTestId('today-pass-approved')).toHaveTextContent('Approved'),
      )
    })

    it('closing the popup is Not now', async () => {
      const user = awayClock()
      atPosition(FAR_AWAY)
      renderWith(<StaffHome />, gates)

      await user.click(await screen.findByTestId('attendance-action'))
      await letTheReadingFinish()
      const steps = await screen.findByTestId('check-in-steps')
      await user.click(
        within(steps.closest('dialog') ?? document.body).getByRole('button', { name: 'Close' }),
      )

      await waitFor(() =>
        expect(screen.queryByTestId('attendance-blocked')).not.toBeInTheDocument(),
      )
      expect(screen.getByTestId('attendance-action')).toHaveTextContent('Check in')
    })

    it('leaves with Not now, writing nothing', async () => {
      const user = awayClock()
      atPosition(FAR_AWAY)
      const adapters = renderWith(<StaffHome />, gates)
      const history = () =>
        adapters.attendance.listHistory(session.userId, '2000-01-01', '2100-01-01')
      const before = (await history()).length

      await user.click(await screen.findByTestId('attendance-action'))
      await letTheReadingFinish()
      await user.click(await screen.findByTestId('attendance-not-now'))

      expect(screen.getByTestId('attendance-action')).toHaveTextContent('Check in')
      expect(await history()).toHaveLength(before)
    })
  }

  it('opens My attendance on the month', async () => {
    renderWith(<MyAttendance />, gates)

    expect(await screen.findByTestId('attendance-history')).toBeInTheDocument()
    if (on) {
      expect(screen.getByTestId('attendance-calendar')).toBeInTheDocument()
      expect(screen.queryByTestId('attendance-range')).not.toBeInTheDocument()
      expect(within(screen.getByTestId('attendance-tally')).getByText('Late')).toBeVisible()
      expect(screen.queryByText(/exactly what your manager sees/)).not.toBeInTheDocument()
    } else {
      expect(screen.getByTestId('attendance-range')).toBeInTheDocument()
      expect(screen.queryByTestId('attendance-calendar')).not.toBeInTheDocument()
    }
  })
})

describe('the refreshed Home under an outlet that blocks away check-ins', () => {
  const gates = { 'auto-approve-at-the-shop': true, 'refreshed-staff-screens': true }

  it('says a check-in from away was not recorded, and offers no way to record it', async () => {
    const user = awayClock()
    const data = createDemoData({ autoApproving: () => true })
    await createMockAdapters('franchise_admin', data).outlets.updateAttendanceRules(
      OUTLET_KALYANI_ID,
      { needsManager: false, blocksAway: true },
    )
    atPosition(FAR_AWAY)
    renderWith(<StaffHome />, gates, createMockAdapters('employee', data))

    await user.click(await screen.findByTestId('attendance-action'))
    await letTheReadingFinish()

    expect(await screen.findByTestId('attendance-refused')).toHaveTextContent('Check-in denied')
    expect(screen.queryByTestId('request-override')).not.toBeInTheDocument()
    // Nothing to decide: one OK, and no Check in again bringing the same popup back.
    expect(screen.queryByText('Check in again')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('attendance-okay'))
    expect(screen.queryByTestId('attendance-refused')).not.toBeInTheDocument()
    expect(screen.getByTestId('attendance-action')).toBeVisible()
  })

  it('explains how to turn location back on when the browser has said no', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: async () => ({
          state: 'denied',
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      },
    })
    renderWith(<StaffHome />, gates)

    expect(await screen.findByTestId('location-help')).toHaveTextContent('Permissions')
  })
})

describe('a day the fence approved', () => {
  it('reads as auto-approved where an approver would be named', () => {
    const at = '2026-10-26T03:32:00.000Z'
    const record = {
      approval: null,
      latestDecisionId: 'decision-1',
      decisions: [{ id: 'decision-1', kind: 'auto_approved', at }],
    } as unknown as AttendanceRecord

    render(<ApprovalNote record={record} radiusMetres={150} />)

    expect(screen.getByTestId('auto-approved-note')).toHaveTextContent('Auto-approved at the shop')
  })
})
