import { render, screen, within } from '@testing-library/react'
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

/**
 * The clock is pinned mid-month, and that is load-bearing rather than tidy.
 *
 * Every attendance fixture is authored as *business days back from today*, and
 * both person views default to **this month** — so on the first day or two of a
 * month the pattern sits almost entirely in the previous one and these surfaces
 * are legitimately empty. The tests then fail for a calendar reason with nothing
 * to do with the code, which is exactly what happened on 1 August 2026.
 *
 * Only `Date` is faked; timers stay real, so `userEvent` behaves normally.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-20T12:00:00+05:30'))
})

afterEach(() => {
  vi.useRealTimers()
})

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

/**
 * Open every day on screen.
 *
 * A day collapses to its headline unless it is waiting for a manager, so a test
 * about what a day *says* has to open the days first. The employee's own screen
 * and the manager's roll-call collapse the same way, from the same component —
 * which is the symmetry promise holding rather than breaking.
 */
async function openEveryDay(user: ReturnType<typeof userEvent.setup>) {
  for (const toggle of screen.queryAllByTestId(/^expand-/)) {
    if (toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle)
  }
}

describe('my attendance', () => {
  it('lists the employee’s own days, with the counts for the range', async () => {
    const user = userEvent.setup()
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    await openEveryDay(user)
    // The fixture month: approved days, a leave day, a waiting one, a late one,
    // and days with nothing recorded at all.
    // "Arrived" is the accessible name of the time chip row; the visible part
    // is the time itself, since the card became chips (design D9).
    expect(within(history).getAllByText('Arrived').length).toBeGreaterThan(0)
    expect(within(history).getByText('Leave')).toBeInTheDocument()
    expect(within(history).getByTestId('attendance-tally')).toBeInTheDocument()
    // Never a check-out, anywhere, ever again.
    expect(within(history).queryByText('Out')).not.toBeInTheDocument()
  })

  it('shows who approved a day, whether they were there, and any reason', async () => {
    const user = userEvent.setup()
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    await openEveryDay(user)
    expect(within(history).getAllByText(/Demo Manager, /).length).toBeGreaterThan(0)
    // The off-site approval: the reason it cost, and the fact that the manager
    // was not at the outlet — both readable by the person the day is about.
    expect(within(history).getAllByText(/Signal drift by the main road/).length).toBeGreaterThan(0)
    // The chip names itself to a screen reader ("Approver") and shows the
    // distance to everybody else, so neither reader has to infer it from an icon.
    expect(
      within(history)
        .getAllByTestId('approver-place')
        .some((node) => /Approver: \d/.test(node.textContent ?? '')),
    ).toBe(true)
    expect(
      within(history)
        .getAllByTestId('approver-place')
        .some((node) => /Approver: on site/.test(node.textContent ?? '')),
    ).toBe(true)
  })

  it('shows a day nobody has approved as waiting, and a late one as late', async () => {
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    expect(within(history).getAllByText('Waiting for a manager to approve').length).toBeGreaterThan(
      0,
    )
    expect(within(history).getAllByTestId('late-tag').length).toBeGreaterThan(0)
  })

  it('derives an absent day for a date with nothing recorded', async () => {
    renderWith('employee', <MyAttendance />, createMockAdapters())

    const history = await screen.findByTestId('attendance-history')
    // No row exists for these dates. Nothing wrote them and nothing will — the
    // reading is derived when the day is read (design D6).
    expect(within(history).getAllByTestId('derived-absent').length).toBeGreaterThan(0)
  })

  it('says the same thing about a day as the manager’s view does', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()

    // The manager's view of today, including the outlet's blocked check-in.
    // Staff are accounts, so the day card keys on the persona's own id.
    const manager = renderWith('franchise_admin', <OutletAttendance />, adapters)
    await screen.findByTestId(`day-${personaFixtures.employee.profile.id}`)
    await openEveryDay(user)
    const managerCard = screen.getByTestId(`day-${personaFixtures.employee.profile.id}`)
    const managerSays = normalise(managerCard.textContent ?? '')
    manager.unmount()

    // The employee's own view of the same day.
    const employeeAdapters = createMockAdapters()
    renderWith('employee', <MyAttendance />, employeeAdapters)
    const history = await screen.findByTestId('attendance-history')
    await openEveryDay(user)
    const employeeSays = normalise(history.textContent ?? '')

    // Whatever the manager is told about distance, accuracy and source, the
    // person it is about is told too.
    for (const fact of managerSays.match(/Distance from the outlet: [\d.]+ m|±[\d.]+ m|phone/g) ??
      []) {
      expect(employeeSays).toContain(fact)
    }
  })
})

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ')
}
