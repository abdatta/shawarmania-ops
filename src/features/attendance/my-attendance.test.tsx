import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { MyAttendance } from './my-attendance'
import { OutletAttendance } from './outlet-attendance'

/**
 * The symmetry promise, asserted rather than trusted.
 *
 * The proposal is explicit that an employee's own history must show exactly
 * what their manager sees — asymmetric visibility in a monitoring feature is
 * how it becomes something staff resent. So the test renders one day through
 * both surfaces and compares what each says about it.
 */

function sessionFor(role: 'employee' | 'franchise_admin'): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderWith(
  role: 'employee' | 'franchise_admin',
  ui: React.ReactNode,
  adapters: DataAdapters,
) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>{ui}</AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('my attendance', () => {
  it('lists the employee’s own days', async () => {
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    // The fixture week: normal days, a leave day, and an overridden one.
    expect(within(history).getAllByText(/^(In|Out)$/).length).toBeGreaterThan(0)
    expect(within(history).getByText('Leave')).toBeInTheDocument()
  })

  it('shows who approved an override, and the reason they gave', async () => {
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    expect(within(history).getByText(/Approved by Demo Manager/)).toBeInTheDocument()
    expect(within(history).getByText(/Signal drift by the main road/)).toBeInTheDocument()
  })

  it('shows a flagged check-out, not just a clean summary', async () => {
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    expect(within(history).getByText('check-out flagged')).toBeInTheDocument()
  })

  it('says the same thing about a day as the manager’s view does', async () => {
    const adapters = createMockAdapters()

    // The manager's view of today, including the outlet's blocked check-in.
    // Staff are accounts, so the day card keys on the persona's own id.
    const manager = renderWith('franchise_admin', <OutletAttendance />, adapters)
    const managerCard = await screen.findByTestId(`day-${personaFixtures.employee.profile.id}`)
    const managerSays = normalise(managerCard.textContent ?? '')
    manager.unmount()

    // The employee's own view of the same day.
    const employeeAdapters = createMockAdapters()
    renderWith('employee', <MyAttendance />, employeeAdapters)
    const history = await screen.findByTestId('attendance-history')
    const employeeSays = normalise(history.textContent ?? '')

    // Whatever the manager is told about distance, accuracy and source, the
    // person it is about is told too.
    for (const fact of managerSays.match(/\d+ m from the outlet|±\d+ m|phone/g) ?? []) {
      expect(employeeSays).toContain(fact)
    }
  })
})

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ')
}
