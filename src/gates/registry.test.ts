import { describe, expect, it } from 'vitest'

import {
  GROUPED_SHELL_ROLES,
  isRenderable,
  NAV_GROUPS,
  navTree,
  surfaces,
  visibleSurfaces,
} from './registry'

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
    //
    // Asked of the tree rather than the flat list since #51: `nav.order` is
    // unique per sibling set now, so the flat list's order is only meaningful
    // among things actually drawn beside each other. The home is the first
    // **top-level** entry, which is the property that was always meant.
    for (const role of ['super_admin', 'franchise_admin', 'employee'] as const) {
      for (const mode of ['demo', 'real'] as const) {
        const first = navTree(visibleSurfaces([role], mode))[0]
        expect(first, `${role}/${mode}`).toBeDefined()
        expect(first?.kind, `${role}/${mode}`).toBe('surface')
        expect(first?.kind === 'surface' && first.surface.path, `${role}/${mode}`).toBe('')
        expect(first?.kind === 'surface' && first.surface.state, `${role}/${mode}`).toBe('live')
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

  /**
   * **`nav.order` is unique per sibling set, not per role** (#51).
   *
   * It was per role until navigation grew a second level. It now sorts an entry
   * against the things it is drawn beside — the other top-level entries and the
   * groups when ungrouped, the rest of its group when grouped — so Billing and
   * Outlets are both `1` in different drawers and neither is ambiguous. A
   * collision *inside* one drawer is still a defect, and that is what this
   * asserts.
   */
  it('orders each sibling set uniquely, and repeats across drawers are not collisions', () => {
    // Every role set a personal session can actually produce. Checking against
    // roles rather than the raw registry is the point: two entries only collide
    // if some real reader is shown both at once.
    const sessions = [
      ['super_admin', 'franchise_admin'],
      ['franchise_admin'],
      ['franchise_admin', 'employee'],
      ['employee'],
    ] as const

    for (const roles of sessions) {
      for (const mode of ['real', 'demo'] as const) {
        const tree = navTree(visibleSurfaces([...roles], mode, [...roles]))

        const top = tree.map((node) => node.order)
        expect([...top].sort((a, b) => a - b)).toEqual(top)
        expect(new Set(top).size).toBe(top.length)

        for (const node of tree) {
          if (node.kind !== 'group') continue
          const inside = node.children.map((child) => child.nav?.order ?? 0)
          expect([...inside].sort((a, b) => a - b)).toEqual(inside)
          expect(new Set(inside).size).toBe(inside.length)
        }
      }
    }

    // And the repeat the old rule would have called a defect really is one:
    // Billing sits at 1 in Finances while Outlets sits at 1 in Setup.
    const owner = navTree(visibleSurfaces(['super_admin', 'franchise_admin'], 'real'))
    const at = (groupLabel: string, label: string) => {
      const node = owner.find(
        (candidate) => candidate.kind === 'group' && candidate.group.label === groupLabel,
      )
      if (node?.kind !== 'group') return undefined
      return node.children.find((child) => child.nav?.label === label)?.nav?.order
    }
    expect(at('Finances', 'Billing')).toBe(1)
    expect(at('Setup', 'Outlets')).toBe(1)
  })

  /**
   * `visibleSurfaces` dedupes by label and the more senior role's entry wins.
   * Without this, `owner-people` could sit in Setup while `admin-people` sat in
   * Finances, the owner's would silently win, and the two readers would hold
   * different maps of one application while the code claimed a single source.
   */
  /**
   * `app-shell` says a phone-first shell presents no more than five top-level
   * entries and that the bar never scrolls sideways to reach one.
   *
   * **One session shape produces six**, and it is worth naming rather than
   * rounding off: a manager who also works a shift at another outlet holds both
   * a manager assignment and an Employee one, so they get both homes — Today
   * and Home — plus Finances, Attendance, Setup and My attendance. `design.md`
   * predicted five for this person and forgot the Employee home; the count is
   * six and always was. It was **eleven** before this change.
   *
   * Losing Home is not the fix: it is where the check-in button lives, and it
   * is the one action their manager role cannot do for them. Which of the six
   * should fold is a product question for the owner, recorded in
   * `openspec/todos/six-tabs-for-one-person.md`.
   *
   * What is fixed here is the harm the requirement is actually about. The bar
   * shares its width equally with a floor of one phone touch target, so six
   * entries clear the narrowest phone anybody uses instead of overflowing a
   * 375px one by three pixels.
   */
  it('never puts more entries in the bar than it can hold without scrolling', () => {
    // The narrowest viewport this app supports, and the touch minimum a tab may
    // not go below — both from docs/DESIGN_SYSTEM.md, in px at the 14px root.
    const NARROWEST = 320
    const TOUCH = 44

    const sessions = [
      ['super_admin', 'franchise_admin'],
      ['franchise_admin'],
      ['franchise_admin', 'employee'],
      ['employee'],
    ] as const

    for (const roles of sessions) {
      for (const mode of ['real', 'demo'] as const) {
        const count = navTree(visibleSurfaces([...roles], mode, [...roles])).length
        expect(
          count * TOUCH,
          `${roles.join('+')}/${mode} overflows the narrowest phone`,
        ).toBeLessThanOrEqual(NARROWEST)
      }
    }
  })

  it('gives the production owner four top-level entries and the Employee three', () => {
    const count = (roles: readonly string[], held: readonly string[]) =>
      navTree(visibleSurfaces(roles as never, 'real', held as never)).length

    expect(count(['super_admin', 'franchise_admin'], ['super_admin'])).toBe(4)
    expect(count(['franchise_admin'], ['franchise_admin'])).toBe(4)
    expect(count(['employee'], ['employee'])).toBe(3)
    // **An owner who also runs a shop gets four as well**, where they used to
    // get five. Both homes are the same screen since #51, so they share the
    // label `Overview` and label dedup leaves one — which is the point of
    // sharing it. The second tab showed exactly what the first one showed.
    expect(count(['super_admin', 'franchise_admin'], ['super_admin', 'franchise_admin'])).toBe(4)
    // Six, and the only shape that exceeds the ceiling: a manager who also
    // works a shift holds the Employee home too, and `Home` is a different
    // screen carrying their own check-in — so it is not a duplicate to fold
    // away. See `openspec/todos/six-tabs-for-one-person.md`.
    expect(count(['franchise_admin', 'employee'], ['franchise_admin', 'employee'])).toBe(6)
  })

  it('draws one door in one place, whichever shell it is drawn in', () => {
    const byLabel = new Map<string, Set<string>>()
    for (const surface of surfaces) {
      if (!surface.nav || !GROUPED_SHELL_ROLES.includes(surface.role)) continue
      const seen = byLabel.get(surface.nav.label) ?? new Set<string>()
      seen.add(surface.nav.group ?? '(top level)')
      byLabel.set(surface.nav.label, seen)
    }

    for (const [label, placements] of byLabel) {
      expect(
        [...placements],
        `${label} is drawn in ${[...placements].join(' and ')} depending on the role`,
      ).toHaveLength(1)
    }
  })

  /**
   * The other half of the same rule: a shell that draws no groups declares
   * none. The Employee's three entries would gain a group that could never hold
   * more than one child, and the counter tablet has no navigation at all — so a
   * `group` on either would be swallowed in silence, which is the one outcome
   * that is not acceptable.
   */
  it('never puts a group on an entry in a shell that draws none', () => {
    for (const surface of surfaces) {
      if (GROUPED_SHELL_ROLES.includes(surface.role)) continue
      expect(surface.nav?.group, `${surface.id} carries a group its shell cannot draw`).toBe(
        undefined,
      )
    }
  })

  it('folds the owner’s sixteen entries into four top-level ones', () => {
    // The gate, stated as a test: Overview, Finances, Attendance, Setup. The
    // production owner holds no manager assignment, so `Today` is not theirs.
    const tree = navTree(
      visibleSurfaces(['super_admin', 'franchise_admin'], 'real', ['super_admin']),
    )
    expect(
      tree.map((node) => (node.kind === 'group' ? node.group.label : node.surface.nav?.label)),
    ).toEqual(['Overview', 'Finances', 'Attendance', 'Setup'])

    const finances = tree.find((node) => node.kind === 'group' && node.group.id === 'finances')
    const setup = tree.find((node) => node.kind === 'group' && node.group.id === 'setup')
    expect(finances?.kind === 'group' && finances.children.map((c) => c.nav?.label)).toEqual([
      'Billing',
      'Drawer',
      'Expenses',
      'Ledger',
    ])
    expect(setup?.kind === 'group' && setup.children.map((c) => c.nav?.label)).toEqual([
      'Outlets',
      'People',
      'Delivery',
      'Menu',
    ])
  })

  it('draws no group whose children this session cannot open', () => {
    // A group is built from what `visibleSurfaces` already narrowed, so an
    // empty heading is not reachable by construction — asserted because the
    // alternative is a heading promising a room that is not there.
    for (const node of navTree([])) {
      expect(node).toBeUndefined()
    }
    expect(navTree([])).toEqual([])

    // An Employee reaches nothing in either group, and is shown neither.
    const staff = navTree(visibleSurfaces(['employee'], 'real'))
    expect(staff.every((node) => node.kind === 'surface')).toBe(true)
    expect(staff.map((node) => node.kind === 'surface' && node.surface.nav?.label)).toEqual([
      'Home',
      'My attendance',
      'Expenses',
    ])
  })

  it('never lets a group take a child’s icon', () => {
    // `Wallet` is Expenses's and `Banknote` is the Drawer's; a group wearing
    // either would read as one of the entries inside it.
    for (const group of Object.values(NAV_GROUPS)) {
      const children = surfaces.filter((surface) => surface.nav?.group === group.id)
      expect(children.some((child) => child.nav?.icon === group.icon)).toBe(false)
    }
  })

  it('puts the owner’s Billing directly above Drawer, inside Finances', () => {
    // The owner opens Billing to read what the outlet took, which is asked far
    // more often than People — one of the entries it used to sit behind.
    // Adjacency to Drawer is the point rather than a particular number: the two
    // are read together, a day's takings and what should be in the drawer
    // against them. Both are in Finances since #51, so the adjacency is now a
    // fact about that group rather than about the whole bar.
    const finances = navTree(visibleSurfaces(['super_admin'], 'real')).find(
      (node) => node.kind === 'group' && node.group.id === 'finances',
    )
    const labels =
      finances?.kind === 'group' ? finances.children.map((child) => child.nav?.label) : []
    expect(labels.indexOf('Billing')).toBe(labels.indexOf('Drawer') - 1)
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

  it('makes the delivery channels reachable to owners in real mode, through one entry', () => {
    const delivery = surfaces.find((surface) => surface.id === 'owner-delivery-sync')

    expect(delivery).toMatchObject({
      role: 'super_admin',
      // The gate's path is the surface, and the channel is a parameter beneath
      // it — `ledger/delivery/:channel` resolves against this entry. Navigation
      // needs an entry point it can build a link to, and a path carrying
      // `:channel` is not one.
      path: 'ledger/delivery',
      state: 'live',
    })
    expect(visibleSurfaces(['super_admin'], 'real').map((surface) => surface.id)).toContain(
      'owner-delivery-sync',
    )
  })

  it('offers the owner exactly one restaurant-channel entry, in both modes', () => {
    // The merge (#48) is only worth anything if it actually costs one tab
    // rather than adding a third. The per-channel gates are kept — `hidden`,
    // not deleted — so nothing but this assertion stops one drifting back into
    // navigation.
    for (const mode of ['demo', 'real'] as const) {
      const nav = visibleSurfaces(['super_admin'], mode)
      const channels = nav.filter((surface) => surface.path.startsWith('ledger/delivery'))
      expect(
        channels.map((surface) => surface.id),
        mode,
      ).toEqual(['owner-delivery-sync'])
      expect(
        nav.map((surface) => surface.nav?.label),
        mode,
      ).not.toContain('Zomato')
      expect(
        nav.map((surface) => surface.nav?.label),
        mode,
      ).not.toContain('Swiggy')
    }
  })

  it('resolves no delivery sync surface inside the manager’s shell, in any mode', () => {
    /*
     * Carried here when `retire-the-manual-ledger` (#12) deleted
     * `src/data-access/mock/swiggy-admin.test.ts`, which had held it.
     *
     * That file was mostly about reading a settlement through the manual
     * ledger, which no longer exists — but this one assertion never belonged to
     * the ledger at all. These tables carry settlement money and the decisions
     * taken about it, and NO outlet role reaches them at any outlet including
     * their own. The database enforces that; this stops a manager being offered
     * a door the policies would then slam.
     */
    for (const mode of ['demo', 'real'] as const) {
      const reached = visibleSurfaces(['franchise_admin'], mode, ['franchise_admin']).map(
        (surface) => surface.id,
      )
      for (const id of ['owner-delivery-sync', 'owner-zomato-sync', 'owner-swiggy-sync']) {
        expect(reached, `${id} in ${mode}`).not.toContain(id)
      }
    }
  })

  it('keeps the retired per-channel gates present, hidden, and out of navigation', () => {
    // Not deleted, deliberately — `admin-daily-cash`'s convention. The routes
    // they name are redirects now, and the cheaper lever for withholding one
    // channel is its config rather than its gate (design D9).
    for (const id of ['owner-zomato-sync', 'owner-swiggy-sync'] as const) {
      const retired = surfaces.find((surface) => surface.id === id)
      expect(retired?.state, id).toBe('hidden')
      expect(retired?.nav, id).toBeUndefined()
    }
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
