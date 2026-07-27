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

  it('gives every role exactly one demo home surface at this point on the roadmap', () => {
    for (const role of ['super_admin', 'franchise_admin', 'biller', 'employee'] as const) {
      const visible = visibleSurfaces(role, 'demo')
      expect(visible, role).toHaveLength(1)
      expect(visible[0]?.path, role).toBe('')
      expect(visible[0]?.state, role).toBe('demo')
    }
  })

  it('shows nothing in real mode until a surface goes live', () => {
    for (const role of ['super_admin', 'franchise_admin', 'biller', 'employee'] as const) {
      expect(visibleSurfaces(role, 'real'), role).toHaveLength(0)
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
