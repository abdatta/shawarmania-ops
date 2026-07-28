import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import {
  DEMO_BLOCKED_EMPLOYEE_ID,
  DEMO_GRILLER_EMPLOYEE_ID,
} from '@/data-access/mock/fixtures/employees'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { OutletAttendance } from './outlet-attendance'

/**
 * The manager's day. What matters here is that nothing hides: every active
 * roster employee appears whether or not they have a record, a blocked
 * check-in is distinguishable at a glance, and an approval cannot be recorded
 * without a reason.
 */

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  role: 'franchise_admin',
  outletId: OUTLET_KALYANI_ID,
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderDay(adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OutletAttendance />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the outlet attendance day', () => {
  it('lists every active roster employee, including those with nothing recorded', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    expect(within(day).getByText(/Demo Griller/)).toBeInTheDocument()
    expect(within(day).getByText(/Demo Helper/)).toBeInTheDocument()
    // No check-in today, and still listed — the people who never arrived are
    // exactly what a day view must not hide.
    expect(within(day).getByText(/Demo Staff/)).toBeInTheDocument()
    expect(within(day).getAllByText('Nothing recorded').length).toBeGreaterThan(0)
  })

  it('leaves former staff off the day', async () => {
    renderDay()

    await screen.findByTestId('attendance-day')
    expect(screen.queryByText(/Demo Former Staff/)).not.toBeInTheDocument()
  })

  it('distinguishes a check-in waiting for a decision, and counts them', async () => {
    renderDay()

    expect(await screen.findByTestId('awaiting-count')).toHaveTextContent(
      '1 check-in is waiting for your decision.',
    )
    expect(screen.getByTestId(`approve-${DEMO_BLOCKED_EMPLOYEE_ID}`)).toBeInTheDocument()
    // The one that was inside the fence needs no decision.
    expect(screen.queryByTestId(`approve-${DEMO_GRILLER_EMPLOYEE_ID}`)).not.toBeInTheDocument()
  })

  it('shows the evidence a decision has to be made on', async () => {
    renderDay()
    const card = await screen.findByTestId(`day-${DEMO_BLOCKED_EMPLOYEE_ID}`)

    // Distance and the reading's own accuracy, beside the verdict — the two
    // numbers a manager needs to judge a drifting fix.
    expect(within(card).getByText(/from the outlet/)).toBeInTheDocument()
    expect(within(card).getByText(/±65 m/)).toBeInTheDocument()
    expect(within(card).getByText('Waiting for a manager to approve')).toBeInTheDocument()
  })

  it('records an approval with the manager’s reason, and clears the flag', async () => {
    const user = userEvent.setup()
    renderDay()

    await user.click(await screen.findByTestId(`approve-${DEMO_BLOCKED_EMPLOYEE_ID}`))
    await user.type(
      screen.getByLabelText('Why are you approving this?'),
      'Seen at the counter at 9:30',
    )
    await user.click(screen.getByRole('button', { name: /Approve and record my reason/ }))

    await waitFor(() => expect(screen.queryByTestId('awaiting-count')).not.toBeInTheDocument())
    expect(screen.getByText(/Seen at the counter at 9:30/)).toBeInTheDocument()
    expect(screen.getByText(/Approved by Demo Manager/)).toBeInTheDocument()
  })

  it('will not record an approval without a reason', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const approve = vi.spyOn(adapters.attendance, 'approveOverride')
    renderDay(adapters)

    await user.click(await screen.findByTestId(`approve-${DEMO_BLOCKED_EMPLOYEE_ID}`))
    const submit = screen.getByRole('button', { name: /Approve and record my reason/ })

    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(approve).not.toHaveBeenCalled()
  })

  it('will not record an approval whose reason is only spaces', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const approve = vi.spyOn(adapters.attendance, 'approveOverride')
    renderDay(adapters)

    await user.click(await screen.findByTestId(`approve-${DEMO_BLOCKED_EMPLOYEE_ID}`))
    await user.type(screen.getByLabelText('Why are you approving this?'), '   ')
    await user.click(screen.getByRole('button', { name: /Approve and record my reason/ }))

    expect(approve).not.toHaveBeenCalled()
  })

  it('moves between business days and cannot walk into the future', async () => {
    const user = userEvent.setup()
    renderDay()

    expect(await screen.findByTestId('day-label')).toHaveTextContent('Today')
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
  })

  it('asks the outlet only for its own day', async () => {
    const adapters = createMockAdapters()
    const list = vi.spyOn(adapters.attendance, 'listOutletDay')
    renderDay(adapters)

    await screen.findByTestId('attendance-day')
    expect(list).toHaveBeenCalledWith(OUTLET_KALYANI_ID, expect.any(String))
  })
})
