import { describe, expect, it } from 'vitest'

import { isRenderable, surfaces, visibleSurfaces } from './registry'

describe('gate registry', () => {
  it('covers all three states across both modes', () => {
    // hidden: absent everywhere
    expect(isRenderable('hidden', 'demo')).toBe(false)
    expect(isRenderable('hidden', 'real')).toBe(false)
    // demo: demo mode only
    expect(isRenderable('demo', 'demo')).toBe(true)
    expect(isRenderable('demo', 'real')).toBe(false)
    // live: both modes
    expect(isRenderable('live', 'demo')).toBe(true)
    expect(isRenderable('live', 'real')).toBe(true)
  })

  it('gives every role with navigation its home surface, first, in both modes', () => {
    // auth-and-roles promoted the four homes from `demo` to `live`: a real
    // session has to land somewhere, and the homes read the outlets adapter,
    // which has a working Supabase implementation. The property that matters
    // is unchanged — every role's shell opens on its own home — so the
    // assertion follows it into real mode rather than being relaxed.
    //
    // **The Biller is excluded, and its absence is the assertion below.** A
    // counter tablet has no navigation at all, so it has no first tab to check.
    for (const role of ['super_admin', 'franchise_admin', 'employee'] as const) {
      for (const mode of ['demo', 'real'] as const) {
        const visible = visibleSurfaces([role], mode)
        expect(visible.length, `${role}/${mode}`).toBeGreaterThan(0)
        expect(visible[0]?.path, `${role}/${mode}`).toBe('')
        expect(visible[0]?.state, `${role}/${mode}`).toBe('live')
      }
    }
  })

  it('gives the counter tablet no navigation at all, in either mode', () => {
    // Not an oversight and not a gap to be filled later. The tablet is shared
    // hardware that nobody is signed in to: personal navigation on it would hand
    // whoever is standing at the counter somebody else's screens, and a way out
    // of the till is a way to strand the device. Its surfaces are panels within
    // one shell rather than addresses, so there is nothing for a tab to point at.
    for (const mode of ['demo', 'real'] as const) {
      expect(visibleSurfaces(['biller'], mode), mode).toHaveLength(0)
    }
  })

  it('shows a role exactly its live surfaces in real mode, and nothing hidden anywhere', () => {
    for (const role of ['super_admin', 'franchise_admin', 'biller', 'employee'] as const) {
      const live = surfaces
        .filter((surface) => surface.role === role && surface.nav && surface.state === 'live')
        .map((surface) => surface.id)
        .sort()

      expect(
        visibleSurfaces([role], 'real')
          .map((surface) => surface.id)
          .sort(),
        role,
      ).toEqual(live)

      // Nothing `hidden` leaks into either mode — the state that means absent.
      for (const mode of ['demo', 'real'] as const) {
        expect(
          visibleSurfaces([role], mode).some((surface) => surface.state === 'hidden'),
          `${role}/${mode}`,
        ).toBe(false)
      }
    }
  })

  it('makes account management reachable to admins only', () => {
    // The one surface auth-and-roles adds: People for the owner, Access for a
    // Franchise Admin, nothing for the two roles that never issue codes.
    for (const role of ['super_admin', 'franchise_admin'] as const) {
      expect(
        visibleSurfaces([role], 'real').some((surface) => surface.path === 'people'),
        role,
      ).toBe(true)
    }
    for (const role of ['biller', 'employee'] as const) {
      expect(
        surfaces.some((surface) => surface.role === role && surface.path === 'people'),
        role,
      ).toBe(false)
    }
  })

  it('orders navigation by declared order', () => {
    for (const role of ['super_admin', 'franchise_admin', 'biller', 'employee'] as const) {
      const orders = surfaces
        .filter((surface) => surface.role === role && surface.nav)
        .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
        .map((surface) => surface.nav?.order ?? 0)
      const sorted = [...orders].sort((a, b) => a - b)
      expect(orders).toEqual(sorted)
      // Orders are unique within a role — ties would make nav order arbitrary.
      expect(new Set(orders).size).toBe(orders.length)
    }
  })

  it('puts the owner’s Billing directly above Drawer', () => {
    // The owner opens Billing to read what the outlet took, which is asked far
    // more often than People, Compare or Alerts — the three it used to sit
    // behind at order 12. Adjacency to Drawer is the point rather than a
    // particular number: the two are read together, a day's takings and what
    // should be in the drawer against them.
    const nav = visibleSurfaces(['super_admin'], 'real').map((surface) => surface.nav?.label)
    expect(nav.indexOf('Billing')).toBe(nav.indexOf('Drawer') - 1)
  })

  it('gives a reachable role its surfaces but not its home', () => {
    // The owner reaches the manager surfaces without holding a manager
    // assignment (owner-reaches-every-outlet, design D1). `admin-dashboard` is
    // the manager's home, and a home belongs to a role you hold — otherwise the
    // owner collects a second dashboard tab pointing at the same shell.
    const reached = visibleSurfaces(['super_admin', 'franchise_admin'], 'real', ['super_admin'])

    expect(reached.map((surface) => surface.id)).toContain('admin-attendance')
    expect(reached.map((surface) => surface.id)).not.toContain('admin-dashboard')
    expect(reached.filter((surface) => surface.path === '').map((surface) => surface.id)).toEqual([
      'owner-dashboard',
    ])
  })

  it('keeps both homes when both roles are held', () => {
    const held = visibleSurfaces(['franchise_admin', 'employee'], 'real')

    expect(held.filter((surface) => surface.path === '').map((surface) => surface.id)).toEqual([
      'admin-dashboard',
      'staff-home',
    ])
  })

  it('declares index paths only for home surfaces', () => {
    const indexSurfaces = surfaces.filter((surface) => surface.path === '')
    expect(indexSurfaces.map((surface) => surface.id).sort()).toEqual([
      'admin-dashboard',
      'counter-home',
      'owner-dashboard',
      'staff-home',
    ])
  })

  it('keeps live expense-category curation behind the ledger instead of in navigation', () => {
    const categorySurface = surfaces.find((surface) => surface.id === 'owner-expense-categories')
    expect(categorySurface).toMatchObject({
      role: 'super_admin',
      path: 'ledger/categories',
      state: 'live',
    })
    expect(categorySurface?.nav).toBeUndefined()
    expect(
      visibleSurfaces(['super_admin'], 'real').some(
        (surface) => surface.id === 'owner-expense-categories',
      ),
    ).toBe(false)
  })

  it('promotes live billing only through its manager and tablet surfaces', () => {
    for (const id of [
      'owner-billing-history',
      'admin-billing-history',
      'counter-billing',
      'counter-open-orders',
      'counter-my-shift',
    ]) {
      expect(surfaces.find((surface) => surface.id === id)?.state, id).toBe('live')
    }
  })

  it('makes the independently verified Swiggy controls reachable to owners in real mode', () => {
    const swiggy = surfaces.find((surface) => surface.id === 'owner-swiggy-sync')

    expect(swiggy).toMatchObject({
      role: 'super_admin',
      path: 'ledger/swiggy',
      state: 'live',
    })
    expect(visibleSurfaces(['super_admin'], 'real').map((surface) => surface.id)).toContain(
      'owner-swiggy-sync',
    )
  })
})

/**
 * The door #11 took away and had to give back.
 *
 * Both the owner and the manager recorded expenses through the manual Ledger
 * surface. That surface left the primary navigation when the derived statement
 * took its place, and the derived statement deliberately carries no editable
 * figure — so for the two roles that read the Ledger nightly, recording an
 * expense became unreachable in the real app. Nothing caught it: every gate
 * tested what the new surfaces do, and none asked what stopped being reachable.
 */
describe('recording an expense stays reachable for every role that spends', () => {
  const EXPENSE_PATH = 'ledger/expenses'

  it.each(['super_admin', 'franchise_admin', 'biller', 'employee'] as const)(
    '%s reaches the expense surface, live',
    (role) => {
      const entry = surfaces.find(
        (surface) => surface.role === role && surface.path === EXPENSE_PATH,
      )
      expect(entry, `${role} has no route to ${EXPENSE_PATH}`).toBeDefined()
      expect(entry?.state).toBe('live')
    },
  )

  it.each(['super_admin', 'franchise_admin', 'employee'] as const)(
    '%s is offered it in navigation in real mode, exactly once',
    (role) => {
      const expenses = visibleSurfaces([role], 'real').filter(
        (surface) => surface.nav?.label === 'Expenses',
      )
      expect(expenses).toHaveLength(1)
      expect(expenses[0]?.path).toBe(EXPENSE_PATH)
    },
  )

  it('reaches the Biller as a panel on the tablet rather than as a tab', () => {
    // The invariant this block protects is that everybody who spends can record
    // it, and for the Biller that is still true — it is simply not navigation.
    // The counter shell renders the expense list directly beneath the till,
    // which is where it belongs: the drawer is at the counter and the person
    // spending is often the person billing. The route stays `live` above, so the
    // gate is still the single switch deciding whether it renders at all.
    expect(visibleSurfaces(['biller'], 'real')).toHaveLength(0)
    const entry = surfaces.find(
      (surface) => surface.role === 'biller' && surface.path === EXPENSE_PATH,
    )
    expect(entry?.state).toBe('live')
    expect(entry?.nav).toBeUndefined()
  })

  it('offers the owner exactly one Expenses tab in demo mode too', () => {
    // The owner reaches the manager's surfaces as well, and `admin-expenses` is
    // the `demo`-gated screen from the change #11 absorbed. Two tabs with one
    // word on them is a question nobody should have to answer.
    const expenses = visibleSurfaces(['super_admin', 'franchise_admin'], 'demo').filter(
      (surface) => surface.nav?.label === 'Expenses',
    )
    expect(expenses).toHaveLength(1)
  })
})

/**
 * The fallback, which is the whole revert story of #11.
 *
 * Decision 17 and the Risks section both call for **two ledger entries** during
 * the overlap, so one business date can be opened in each and compared. Task 9.2
 * said to remove the manual ledger's entry, was followed literally, and left a
 * fallback reachable only by typing a URL.
 */
describe('both ledger readings are reachable during the overlap', () => {
  it.each(['super_admin', 'franchise_admin'] as const)(
    '%s is offered the derived statement and the notebook, as separate entries',
    (role) => {
      const nav = visibleSurfaces([role], 'real')
      const derived = nav.find((surface) => surface.path === 'ledger')
      const notebook = nav.find((surface) => surface.path === 'ledger/notebook')

      expect(derived, 'the derived statement has no navigation entry').toBeDefined()
      expect(
        notebook,
        'the fallback has no navigation entry — a typed URL is not a tab',
      ).toBeDefined()

      // The derived reading is the one called `Ledger`: that is what "leaves the
      // primary navigation" means, and all it means.
      expect(derived?.nav?.label).toBe('Ledger')
      expect(notebook?.nav?.label).not.toBe('Ledger')

      // And the reader lands on the new one first.
      expect(derived?.nav?.order ?? 0).toBeLessThan(notebook?.nav?.order ?? 0)
    },
  )

  it.each(['super_admin', 'franchise_admin'] as const)(
    '%s keeps the manual ledger live at its own route, so a revert is one edit',
    (role) => {
      const notebook = surfaces.find(
        (surface) => surface.role === role && surface.path === 'ledger/notebook',
      )
      expect(notebook?.state).toBe('live')
    },
  )
})
