import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters, WaitingCount } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { ATTENTION_SOURCES } from '@/features/attention/sources'
import { surfaces } from '@/gates/registry'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { CounterShell } from './counter-shell'
import { PhoneShell } from './phone-shell'

/**
 * The shell's half of the badge mechanism.
 *
 * What is under test is that the shells render a count they know nothing about:
 * they read `nav.attention` off the registry entry and hand the id to the
 * attention layer. Adding a badge to a further surface is therefore a registry
 * line and a source, and neither of these two files moves — which is the whole
 * claim behind calling this a mechanism rather than an attendance feature with
 * a general name (design D2).
 */

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

/**
 * Somebody who manages Kalyani and bills at it too, which is the only way the
 * counter tablet's header ever shows a badged surface. Since multi-outlet-people
 * a person's navigation is the union of the roles they hold, so this is a real
 * shape rather than a contrivance.
 */
const billingManagerSession: Session = {
  ...managerSession,
  assignments: [
    ...managerSession.assignments,
    {
      id: 'a0000000-0000-4000-a000-0000000000ff',
      role: 'biller',
      outletId: OUTLET_KALYANI_ID,
      startedOn: '2026-01-01',
      endedOn: null,
    },
  ],
}

function stage(adapters: DataAdapters, counts: WaitingCount[]) {
  vi.spyOn(adapters.attendance, 'countWaitingByOutlet').mockResolvedValue(counts)
}

const KALYANI_WAITING: WaitingCount = {
  outletId: OUTLET_KALYANI_ID,
  outletName: 'Shawarmania Kalyani',
  waiting: 3,
  oldest: '2026-07-20',
  newest: '2026-07-28',
}

function renderShell(
  Shell: typeof PhoneShell | typeof CounterShell,
  adapters: DataAdapters,
  session: Session,
) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={session}>
        <AdaptersContext.Provider value={adapters}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="*" element={<p>a surface</p>} />
            </Route>
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('a badge on the navigation', () => {
  it('shows the count on the declared entry in the phone shell', async () => {
    const adapters = createMockAdapters()
    stage(adapters, [KALYANI_WAITING])
    renderShell(PhoneShell, adapters, managerSession)

    // Twice over: the rail for wide screens and the bottom bar for narrow ones
    // are both in the document, with one hidden by CSS.
    const badges = await screen.findAllByTestId('nav-badge-attendance-waiting')
    expect(badges.length).toBeGreaterThan(0)
    for (const badge of badges) expect(badge).toHaveTextContent('3')
    // Read as a sentence belonging to its tab, not as a bare number.
    expect(
      screen.getAllByText('Attendance: 3 arrivals waiting for approval').length,
    ).toBeGreaterThan(0)
  })

  it('shows the same count in the counter shell', async () => {
    const adapters = createMockAdapters()
    stage(adapters, [KALYANI_WAITING])
    renderShell(CounterShell, adapters, billingManagerSession)

    const badge = await screen.findByTestId('nav-badge-attendance-waiting')
    expect(badge).toHaveTextContent('3')
  })

  it('leaves a badged entry indistinguishable from an unbadged one at zero', async () => {
    const adapters = createMockAdapters()
    stage(adapters, [])
    renderShell(PhoneShell, adapters, managerSession)

    // The tab is there; nothing is hanging off it. An absent badge always means
    // the same thing, so no zero and no empty circle (design D5).
    expect((await screen.findAllByRole('link', { name: /Attendance/ })).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('nav-badge-attendance-waiting')).not.toBeInTheDocument()
  })

  it('reads the counts once however many places show them', async () => {
    const adapters = createMockAdapters()
    stage(adapters, [KALYANI_WAITING])
    const read = adapters.attendance.countWaitingByOutlet as ReturnType<typeof vi.fn>
    renderShell(PhoneShell, adapters, managerSession)

    await screen.findAllByTestId('nav-badge-attendance-waiting')
    // Two navigations asking the same question is still one request.
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('the mechanism, rather than this one badge', () => {
  it('has exactly one source for every attention the registry declares', () => {
    const declared = surfaces.map((surface) => surface.nav?.attention).filter((id) => id != null)
    expect(declared.length).toBeGreaterThan(0)
    for (const id of declared) expect(ATTENTION_SOURCES[id]).toBeTypeOf('function')

    /*
     * And nothing in the map is dead. The registry side is free — the map is
     * keyed by the id union, so an entry naming a source nobody wrote would not
     * compile — but the other direction needs asserting, or a source outlives
     * the entry that used it and nothing says so.
     *
     * **One kind of source is legitimately not on a navigation entry**, and it
     * is named here rather than the rule being loosened: a badged surface that
     * shows one scope at a time decomposes its badge onto the control that
     * switches scopes, and each scope's count is a source of its own
     * (attention-badges, #48). `delivery-needs-you` is the entry's sum; these
     * two are the shares the channel switch shows. Removing the switch without
     * removing them fails here, which is the point.
     */
    const decomposed = ['swiggy-needs-you', 'zomato-needs-you']
    expect(Object.keys(ATTENTION_SOURCES).sort()).toEqual(
      [...new Set([...declared, ...decomposed])].sort(),
    )
  })

  it('keeps both shells ignorant of what is being counted', () => {
    for (const file of ['src/shell/phone-shell.tsx', 'src/shell/counter-shell.tsx']) {
      const source = readFileSync(file, 'utf8')
      // A shell that imported attendance would badge exactly one surface for
      // ever, and would invert the dependency the registry exists to keep
      // straight. The badge arrives by id, never by feature.
      expect(source).not.toContain('features/attendance')
    }
  })
})
