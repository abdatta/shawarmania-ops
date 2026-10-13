import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import type { GateState } from '@/gates/registry'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Role, type Session } from '@/session/session'

import { AccountMenu } from './account-menu'

/**
 * The way in to Change gates (a-release-can-be-switched-off, D18): the account
 * menu, beside View Demo, for the owner alone — and only once the surface is
 * real, so a link never leads to a page the gate would refuse.
 */

const gatesState = vi.hoisted(() => ({ value: 'demo' as GateState }))

vi.mock('@/gates/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/gates/registry')>()
  return {
    ...actual,
    getSurface: (id: Parameters<typeof actual.getSurface>[0]) => {
      const surface = actual.getSurface(id)
      return id === 'owner-change-gates' ? { ...surface, state: gatesState.value } : surface
    },
  }
})

function sessionFor(role: Role): Session {
  const { profile, assignments } = personaFixtures[role]
  return {
    mode: 'real',
    userId: profile.id,
    assignments,
    ...deriveSessionScope(assignments),
    displayName: profile.full_name,
  }
}

async function openMenu(role: Role) {
  render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={createMockAdapters(role)}>
          <AccountMenu onSignOut={() => undefined} />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await userEvent.setup().click(screen.getByLabelText('Account'))
}

describe('the Change gates link', () => {
  it('sits above View Demo for the owner once Change gates is live', async () => {
    gatesState.value = 'live'
    await openMenu('super_admin')
    const link = screen.getByTestId('change-gates-link')
    expect(link).toHaveAttribute('href', '/owner/change-gates')
    expect(link.compareDocumentPosition(screen.getByTestId('demo-link'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('is absent while Change gates is still demo-only', async () => {
    gatesState.value = 'demo'
    await openMenu('super_admin')
    expect(screen.queryByTestId('change-gates-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('demo-link')).toBeInTheDocument()
  })

  it('is never offered to anybody but the owner', async () => {
    gatesState.value = 'live'
    for (const role of ['franchise_admin', 'employee'] as const) {
      await openMenu(role)
      expect(screen.queryByTestId('change-gates-link')).not.toBeInTheDocument()
      cleanup()
    }
  })
})
