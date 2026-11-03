import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { DEMO_DEACTIVATED_BILLER_ACCOUNT_ID } from '@/data-access/mock/fixtures/accounts'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatBusinessDate, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { OutletAttendance } from './outlet-attendance'

/**
 * Attendance lists a deactivated person through the day they were deactivated
 * and not after (a-deactivated-person-leaves-in-two-steps, design D8), on By day
 * and on By staff's month. Off, they are listed every day as before.
 *
 * The clock is pinned mid-month, so the days around the deactivation sit in
 * the month By staff opens on whatever day this runs.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-20T12:00:00+05:30'))
})

afterEach(() => {
  vi.useRealTimers()
})

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

const BILLER = DEMO_DEACTIVATED_BILLER_ACCOUNT_ID

/**
 * The demo, with the Biller deactivated two days before today at 15:00, after
 * Kalyani's 13:00 deadline, and today's date.
 */
async function demoWith(
  on: boolean,
  adjust?: (biller: ReturnType<typeof createDemoData>['accounts'][number], today: string) => void,
) {
  const data = createDemoData()
  const adapters = createMockAdapters('franchise_admin', data)
  const kalyani = (await adapters.outlets.getOutlet(OUTLET_KALYANI_ID))!
  const today = resolveBusinessDate(new Date(), kalyani.business_day_cutover)
  const biller = data.accounts.find((account) => account.id === BILLER)!
  biller.deactivatedAt = `${shiftBusinessDate(today, -2)}T15:00:00+05:30`
  adjust?.(biller, today)
  render(
    <MemoryRouter>
      <ChangeGatesForTest on={{ 'deactivate-then-leave': on }}>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  return { adapters, today }
}

async function stepBack(user: ReturnType<typeof userEvent.setup>, days: number, to: string) {
  await screen.findByTestId('attendance-day')
  for (let step = 0; step < days; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
  }
  await waitFor(() =>
    expect(screen.getByTestId('day-label')).toHaveTextContent(formatBusinessDate(to)),
  )
}

describeChangeGate('deactivate-then-leave', (on) => {
  it(
    on
      ? 'lists a deactivated person on their deactivation day, noted, and not the day after'
      : 'lists a deactivated person every day, as before',
    async () => {
      const user = userEvent.setup()
      const { today } = await demoWith(on)

      await stepBack(user, 1, shiftBusinessDate(today, -1))
      if (on) expect(screen.queryByTestId(`day-${BILLER}`)).not.toBeInTheDocument()
      else expect(await screen.findByTestId(`day-${BILLER}`)).toBeInTheDocument()

      await stepBack(user, 1, shiftBusinessDate(today, -2))
      const card = await screen.findByTestId(`day-${BILLER}`)
      expect(card).toHaveTextContent('deactivated')
    },
  )

  it(
    on
      ? 'leaves out the day of somebody switched off before its deadline'
      : 'lists somebody switched off in the morning on that day, as before',
    async () => {
      const user = userEvent.setup()
      const { today } = await demoWith(on, (biller, day) => {
        biller.deactivatedAt = `${shiftBusinessDate(day, -2)}T10:00:00+05:30`
      })

      await stepBack(user, 2, shiftBusinessDate(today, -2))
      if (on) expect(screen.queryByTestId(`day-${BILLER}`)).not.toBeInTheDocument()
      else expect(await screen.findByTestId(`day-${BILLER}`)).toBeInTheDocument()
    },
  )

  it('still lists a recorded day after the deactivation', async () => {
    const user = userEvent.setup()
    const { adapters, today } = await demoWith(on)
    await adapters.attendance.recordManualEntry({
      personId: BILLER,
      enteredBy: managerSession.userId,
      outletId: OUTLET_KALYANI_ID,
      businessDate: shiftBusinessDate(today, -1),
      at: `${shiftBusinessDate(today, -1)}T04:00:00.000Z`,
    })

    await stepBack(user, 1, shiftBusinessDate(today, -1))
    expect(await screen.findByTestId(`day-${BILLER}`)).toBeInTheDocument()
  })

  it('lists somebody reactivated on every day again', async () => {
    const user = userEvent.setup()
    const { today } = await demoWith(on, (biller) => {
      biller.isActive = true
      biller.deactivatedAt = null
    })

    await stepBack(user, 1, shiftBusinessDate(today, -1))
    expect(await screen.findByTestId(`day-${BILLER}`)).toBeInTheDocument()
  })

  it(
    on
      ? 'stops By staff’s month at the deactivation day'
      : 'paints By staff’s days after the deactivation absent',
    async () => {
      const user = userEvent.setup()
      const { today } = await demoWith(on)
      await user.click(await screen.findByTestId('axis-staff'))
      await user.selectOptions(await screen.findByTestId('person-picker'), BILLER)
      await screen.findByTestId('attendance-calendar')

      // The deactivation day itself still reads absent: nothing was recorded.
      await waitFor(() =>
        expect(screen.getByTestId(`calendar-day-${shiftBusinessDate(today, -2)}`)).toHaveAttribute(
          'data-mark',
          'absent',
        ),
      )
      const after = screen.queryByTestId(`calendar-day-${shiftBusinessDate(today, -1)}`)
      if (on) expect(after).not.toBeInTheDocument()
      else expect(after).toHaveAttribute('data-mark', 'absent')
    },
  )
})
