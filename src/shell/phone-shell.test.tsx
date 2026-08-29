import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { Assignment } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { PhoneShell } from './phone-shell'

/**
 * What the phone shell's navigation is *for*: the surfaces a session can reach,
 * addressed so that following one keeps the reader in the shell they are in
 * (owner-reaches-every-outlet, design D1 and D1a).
 */

function live(id: string, role: Role, outletId: string | null): Assignment {
  return { id, role, outletId, startedOn: '2026-01-01', endedOn: null }
}

function sessionWith(assignments: Assignment[], mode: 'real' | 'demo' = 'real'): Session {
  const core = {
    userId: personaFixtures.super_admin.profile.id,
    assignments,
    ...deriveSessionScope(assignments),
    displayName: 'A Person',
  }
  return mode === 'real'
    ? { mode: 'real', ...core }
    : { mode: 'demo', persona: personaFixtures.super_admin, ...core }
}

function renderShell(session: Session) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={session}>
        <AdaptersContext.Provider value={createMockAdapters(session.role ?? 'super_admin')}>
          <Routes>
            <Route element={<PhoneShell />}>
              <Route path="*" element={<p>a surface</p>} />
            </Route>
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

/** The nav renders twice — a rail and a bottom bar — so links come in pairs. */
function linkTo(label: string): string | null {
  const links = screen.getAllByRole('link', { name: new RegExp(`^${label}`) })
  expect(links.length).toBeGreaterThan(0)
  return links[0]?.getAttribute('href') ?? null
}

const ownerOnly = [live('a1', 'super_admin', null)]

describe('the owner’s navigation', () => {
  it('offers the outlet-level surfaces while holding no assignment', () => {
    renderShell(sessionWith(ownerOnly))

    // Attendance is a manager surface, and the owner has one because they are
    // the owner rather than because somebody appointed them.
    expect(linkTo('Attendance')).toBe('/owner/attendance')
  })

  it('keeps every entry inside the owner’s own shell', () => {
    renderShell(sessionWith(ownerOnly))

    for (const links of screen.getAllByRole('link')) {
      expect(links.getAttribute('href')).toMatch(/^\/owner/)
    }
  })

  it('offers one home, not a second dashboard', () => {
    renderShell(sessionWith(ownerOnly))

    expect(linkTo('Overview')).toBe('/owner')
    // `admin-dashboard` is the manager's home. A home belongs to a role you
    // hold, so an owner who manages no outlet does not collect a second one.
    expect(screen.queryByRole('link', { name: /^Today/ })).not.toBeInTheDocument()
  })

  it('keeps the manager’s own home when the owner really does run an outlet', () => {
    renderShell(sessionWith([...ownerOnly, live('a2', 'franchise_admin', OUTLET_KALYANI_ID)]))

    expect(linkTo('Overview')).toBe('/owner')
    // Two homes, two addresses. This one is theirs by assignment.
    expect(linkTo('Today')).toBe('/admin')
  })

  it('does not reach the counter or a staff surface', () => {
    renderShell(sessionWith(ownerOnly))

    expect(screen.queryByRole('link', { name: /^Counter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^My attendance/ })).not.toBeInTheDocument()
  })

  it('keeps the demo persona while walking a manager surface', () => {
    renderShell(sessionWith(ownerOnly, 'demo'))

    // The role lives in the URL in demo mode, so a link into another role's
    // segment would hand the walk to a different persona mid-demo.
    expect(linkTo('Attendance')).toBe('/demo/owner/attendance')
    // `Cash` was this example until #11 made the day-close screen `hidden`. The
    // Drawer is the manager surface the owner reaches now, and it makes the same
    // point: the link stays inside the owner's own segment.
    expect(linkTo('Drawer')).toBe('/demo/owner/drawer')
  })
})

describe('a person holding two roles', () => {
  const managerAndStaff = [
    live('b1', 'franchise_admin', OUTLET_KALYANI_ID),
    live('b2', 'employee', OUTLET_KANCHRAPARA_ID),
  ]

  it('keeps both homes, each at its own address', () => {
    renderShell(sessionWith(managerAndStaff))

    // The staff home is where the check-in button lives, so losing it would cost
    // this person the one action their other role cannot do for them.
    expect(linkTo('Today')).toBe('/admin')
    expect(linkTo('Home')).toBe('/staff')
  })

  it('addresses their other role’s surfaces inside the shell they land in', () => {
    renderShell(sessionWith(managerAndStaff))

    expect(linkTo('My attendance')).toBe('/admin/my-attendance')
  })
})
