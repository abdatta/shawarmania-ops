import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { DailyCashSurface } from '@/features/cash/daily-cash-surface'
import { ExpensesSurface } from '@/features/expenses/expenses-surface'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { forgetRememberedOutlets, readRememberedOutlet } from './remembered-outlet'

/**
 * The outlet in scope, remembered (owner-reaches-every-outlet, design D6 and D7).
 *
 * Two surfaces are used deliberately: the claim is that the choice is *shared*,
 * and a test that only ever renders one screen cannot tell a remembered value
 * from component state. `localStorage` is cleared between tests by the suite
 * setup, so each of these starts from "never chosen anything".
 */

const ownerAssignments = [
  {
    id: 'a1',
    role: 'super_admin' as const,
    outletId: null,
    startedOn: '2025-06-01',
    endedOn: null,
  },
]

/** An owner holding no outlet assignment: reaches every outlet, manages none. */
const ownerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  assignments: ownerAssignments,
  ...deriveSessionScope(ownerAssignments),
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

function renderSurface(
  Surface: typeof ExpensesSurface | typeof DailyCashSurface,
  session: Session = ownerSession,
  adapters: DataAdapters = createMockAdapters('super_admin'),
) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <AdaptersContext.Provider value={adapters}>
            <Surface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

async function chooseOutlet(outletId: string) {
  const user = userEvent.setup()
  const selector = await screen.findByTestId('surface-outlet')
  await user.selectOptions(selector, outletId)
  await waitFor(() => expect(screen.getByTestId('surface-outlet')).toHaveValue(outletId))
}

describe('the outlet in scope, remembered', () => {
  it('opens the next surface on the outlet chosen on the last one', async () => {
    const first = renderSurface(ExpensesSurface)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    first.unmount()

    // A different surface entirely, and the question is not asked again.
    renderSurface(DailyCashSurface)
    expect(await screen.findByTestId('surface-outlet')).toHaveValue(OUTLET_KANCHRAPARA_ID)
  })

  it('survives the surface being torn down and rebuilt', async () => {
    const first = renderSurface(DailyCashSurface)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    first.unmount()

    renderSurface(DailyCashSurface)
    expect(await screen.findByTestId('surface-outlet')).toHaveValue(OUTLET_KANCHRAPARA_ID)
  })

  it('replaces a remembered outlet the person may no longer see', async () => {
    // A shop that closed, was deleted, or was never theirs.
    localStorage.setItem(
      `shawarmania.outlet-scope.demo.${ownerSession.userId}`,
      'd0000000-0000-4000-a000-00000000dead',
    )

    renderSurface(ExpensesSurface)

    // Opens on a real outlet rather than on a blank or an error…
    const selector = await screen.findByTestId('surface-outlet')
    expect((selector as HTMLSelectElement).value).toBe(OUTLET_KALYANI_ID)
    // …and the dead value is written over, so the next surface does not
    // rediscover it.
    await waitFor(() => expect(readRememberedOutlet(ownerSession)).toBe(OUTLET_KALYANI_ID))
  })

  it('is forgotten when a session ends', async () => {
    const first = renderSurface(ExpensesSurface)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    first.unmount()

    // What signing out does, on a phone that gets handed over.
    forgetRememberedOutlets()
    expect(readRememberedOutlet(ownerSession)).toBeNull()

    renderSurface(ExpensesSurface)
    expect(await screen.findByTestId('surface-outlet')).toHaveValue(OUTLET_KALYANI_ID)
  })

  it('keeps the demo’s choice out of a real session', async () => {
    const first = renderSurface(ExpensesSurface)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    first.unmount()

    // The same person, signed in for real. The demo is a separate namespace, so
    // a demonstrator's choice cannot follow them into the live app.
    const realSession: Session = {
      mode: 'real',
      userId: ownerSession.userId,
      assignments: ownerAssignments,
      ...deriveSessionScope(ownerAssignments),
      displayName: ownerSession.displayName,
    }
    expect(readRememberedOutlet(realSession)).toBeNull()
  })

  it('remembers a filter and nothing more — the outlet is still not theirs to run', async () => {
    const first = renderSurface(DailyCashSurface)
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    first.unmount()

    renderSurface(DailyCashSurface)

    // Remembering where somebody was looking cannot make the drawer theirs: that
    // comes from the assignment, and the database is the one enforcing it.
    expect(await screen.findByTestId('drawer-not-yours')).toBeInTheDocument()
    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument()
  })

  it('asks nobody with one outlet, and remembers nothing for them', async () => {
    const staff = personaFixtures.franchise_admin
    const managerSession: Session = {
      mode: 'demo',
      userId: staff.profile.id,
      assignments: staff.assignments,
      ...deriveSessionScope(staff.assignments),
      displayName: staff.profile.full_name,
      persona: staff,
    }

    renderSurface(DailyCashSurface, managerSession, createMockAdapters('franchise_admin'))

    await screen.findByTestId('cash-figures')
    expect(screen.queryByTestId('surface-outlet')).not.toBeInTheDocument()
    expect(readRememberedOutlet(managerSession)).toBeNull()
  })

  it('offers the owner every outlet to remember, and no more', async () => {
    renderSurface(ExpensesSurface)

    const selector = await screen.findByTestId('surface-outlet')
    const values = within(selector)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
    expect(values).toEqual([OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID])
  })
})
