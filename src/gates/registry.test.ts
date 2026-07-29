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

  it('gives every role its home surface, first, in both modes', () => {
    // auth-and-roles promoted the four homes from `demo` to `live`: a real
    // session has to land somewhere, and the homes read the outlets adapter,
    // which has a working Supabase implementation. The property that matters
    // is unchanged — every role's shell opens on its own home — so the
    // assertion follows it into real mode rather than being relaxed.
    for (const role of ['super_admin', 'franchise_admin', 'biller', 'employee'] as const) {
      for (const mode of ['demo', 'real'] as const) {
        const visible = visibleSurfaces([role], mode)
        expect(visible.length, `${role}/${mode}`).toBeGreaterThan(0)
        expect(visible[0]?.path, `${role}/${mode}`).toBe('')
        expect(visible[0]?.state, `${role}/${mode}`).toBe('live')
      }
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

  it('declares index paths only for home surfaces', () => {
    const indexSurfaces = surfaces.filter((surface) => surface.path === '')
    expect(indexSurfaces.map((surface) => surface.id).sort()).toEqual([
      'admin-dashboard',
      'counter-home',
      'owner-dashboard',
      'staff-home',
    ])
  })
})
