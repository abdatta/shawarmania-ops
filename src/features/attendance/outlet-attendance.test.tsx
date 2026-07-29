import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createMockAdapters,
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  OUTLET_KALYANI_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { OutletAttendance } from './outlet-attendance'

/**
 * The manager's day. What matters here is that nothing hides: every current
 * staff member appears whether or not they have a record — deactivated people
 * included — a blocked check-in is distinguishable at a glance, an approval
 * cannot be recorded without a reason, and a manual entry permanently names
 * who typed it in.
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
  it('lists every current staff member, including those with nothing recorded', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    expect(within(day).getByText(/Demo Griller/)).toBeInTheDocument()
    expect(within(day).getByText(/Demo Helper/)).toBeInTheDocument()
    // No check-in today, and still listed — the people who never arrived are
    // exactly what a day view must not hide.
    expect(within(day).getByText(/Demo Staff/)).toBeInTheDocument()
    expect(within(day).getAllByText('Nothing recorded').length).toBeGreaterThan(0)
  })

  it('leaves departed people off the day', async () => {
    renderDay()

    await screen.findByTestId('attendance-day')
    expect(screen.queryByText(/Demo Former Staff/)).not.toBeInTheDocument()
  })

  it('keeps a deactivated person on the day — access cut is not departure', async () => {
    renderDay()

    const day = await screen.findByTestId('attendance-day')
    const card = within(day).getByTestId(`day-d1000000-0000-4000-a000-000000000013`)
    expect(within(card).getByText(/Demo Prep Cook/)).toBeInTheDocument()
    expect(within(card).getByText(/account deactivated/)).toBeInTheDocument()
  })

  it('distinguishes a check-in waiting for a decision, and counts them', async () => {
    renderDay()

    expect(await screen.findByTestId('awaiting-count')).toHaveTextContent(
      '1 check-in is waiting for your decision.',
    )
    expect(screen.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toBeInTheDocument()
    // The one that was inside the fence needs no decision.
    expect(screen.queryByTestId(`approve-${DEMO_GRILLER_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })

  it('shows the evidence a decision has to be made on', async () => {
    renderDay()
    const card = await screen.findByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)

    // Distance and the reading's own accuracy, beside the verdict — the two
    // numbers a manager needs to judge a drifting fix.
    expect(within(card).getByText(/from the outlet/)).toBeInTheDocument()
    expect(within(card).getByText(/±65 m/)).toBeInTheDocument()
    expect(within(card).getByText('Waiting for a manager to approve')).toBeInTheDocument()
  })

  it('records an approval with the manager’s reason, and clears the flag', async () => {
    const user = userEvent.setup()
    renderDay()

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
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

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
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

    await user.click(await screen.findByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`))
    await user.type(screen.getByLabelText('Why are you approving this?'), '   ')
    await user.click(screen.getByRole('button', { name: /Approve and record my reason/ }))

    expect(approve).not.toHaveBeenCalled()
  })

  it('moves between business days and cannot walk into the future', async () => {
    const user = userEvent.setup()
    renderDay()

    expect(await screen.findByTestId('day-label')).toHaveTextContent('Today')
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    // Today offers manual entry; a past day must not — the database refuses
    // back-filling prior days, so the surface does not offer it.
    expect(await screen.findByTestId(`manual-${DEMO_GRILLER_ACCOUNT_ID}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByTestId('day-label')).not.toHaveTextContent('Today'))
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
    expect(screen.queryByTestId(`manual-${DEMO_GRILLER_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })

  it('records a manual check-in with the manager stamped as enterer', async () => {
    const user = userEvent.setup()
    renderDay()

    // Demo Staff has nothing recorded today, so the offered event is a
    // check-in. 04:00 is the earliest moment of any business day — the one
    // time guaranteed not to be in the future while that day is current.
    const staffId = personaFixtures.employee.profile.id
    await user.click(await screen.findByTestId(`manual-${staffId}`))
    expect(
      screen.getByText(/The record will permanently show that you entered it/),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('When did it happen?'), '04:00')
    await user.click(screen.getByRole('button', { name: 'Record it under my name' }))

    const card = await screen.findByTestId(`day-${staffId}`)
    await waitFor(() =>
      expect(within(card).getByTestId('entered-by')).toHaveTextContent('Entered by Demo Manager'),
    )
    expect(within(card).getByText('manual entry')).toBeInTheDocument()
  })

  it('asks the outlet only for its own day', async () => {
    const adapters = createMockAdapters()
    const list = vi.spyOn(adapters.attendance, 'listOutletDay')
    renderDay(adapters)

    await screen.findByTestId('attendance-day')
    expect(list).toHaveBeenCalledWith(OUTLET_KALYANI_ID, expect.any(String))
  })
})
