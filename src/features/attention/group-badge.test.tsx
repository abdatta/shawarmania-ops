import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import type { AttentionSourceId } from '@/gates/registry'

import { NavGroupAttentionBadge } from './group-badge'

/**
 * **The sum a collapsed group carries, with more than one child badged.**
 *
 * The registry cannot exercise this today: of the five entries that declare an
 * attention source, exactly one — Delivery — sits inside a group, so the sum
 * every group shows is a single child's own count and `10 = 10` proves nothing.
 * That is a fact about which surfaces currently badge, and it will change the
 * first time a second one in Finances or Setup does.
 *
 * So the component is held to account directly, against sources chosen here
 * rather than read off the registry. What must be true is that the badge is the
 * **total**, that a source still answering contributes nothing rather than a
 * zero, and that a group whose children are all quiet renders nothing at all.
 */

function stage(
  adapters: DataAdapters,
  counts: { attendance: number; zomato: number; swiggy: number },
) {
  vi.spyOn(adapters.attendance, 'countWaitingByOutlet').mockResolvedValue([
    {
      outletId: OUTLET_KALYANI_ID,
      outletName: 'Shawarmania Kalyani',
      waiting: counts.attendance,
      oldest: '2026-08-30',
      newest: '2026-09-01',
    },
  ])
  vi.spyOn(adapters.aggregatorSync, 'countNeedsOwner').mockResolvedValue([
    { outletId: OUTLET_KALYANI_ID, needing: counts.zomato },
  ])
  vi.spyOn(adapters.swiggySync, 'countNeedsOwner').mockResolvedValue([
    { outletId: OUTLET_KANCHRAPARA_ID, needing: counts.swiggy },
  ])
}

function renderBadge(adapters: DataAdapters, sources: AttentionSourceId[]) {
  return render(
    <AdaptersContext.Provider value={adapters}>
      <NavGroupAttentionBadge group="Setup" sources={sources} />
    </AdaptersContext.Provider>,
  )
}

describe('a collapsed group’s badge', () => {
  it('adds up every badged child, not just the first', async () => {
    const adapters = createMockAdapters()
    stage(adapters, { attendance: 3, zomato: 4, swiggy: 2 })

    // Three distinct sources: 3 + 4 + 2. `delivery-needs-you` is deliberately
    // not among them — it is itself the sum of the two channels, and counting
    // it beside them would count the same queue twice.
    renderBadge(adapters, ['attendance-waiting', 'zomato-needs-you', 'swiggy-needs-you'])

    const badge = await screen.findByTestId('nav-group-badge-setup')
    expect(badge).toHaveTextContent('9')
  })

  it('reads as the children’s own sentences, not as a bare number', async () => {
    const adapters = createMockAdapters()
    stage(adapters, { attendance: 3, zomato: 4, swiggy: 0 })

    renderBadge(adapters, ['attendance-waiting', 'zomato-needs-you'])

    await screen.findByTestId('nav-group-badge-setup')
    // The shell does not know what is being counted and could not write this
    // honestly, so each child's own words are joined behind the group's name.
    expect(screen.getByText(/^Setup: /)).toHaveTextContent('arrivals waiting for approval')
    expect(screen.getByText(/^Setup: /)).toHaveTextContent('items need you')
  })

  it('leaves a child at zero out of the sentence but not out of the sum', async () => {
    const adapters = createMockAdapters()
    stage(adapters, { attendance: 0, zomato: 4, swiggy: 0 })

    renderBadge(adapters, ['attendance-waiting', 'zomato-needs-you'])

    const badge = await screen.findByTestId('nav-group-badge-setup')
    expect(badge).toHaveTextContent('4')
    // Nothing is waiting on attendance, so naming it would send the reader to a
    // surface with nothing on it.
    expect(screen.getByText(/^Setup: /)).not.toHaveTextContent('arrivals waiting')
  })

  it('renders nothing at all when every child is quiet', async () => {
    const adapters = createMockAdapters()
    stage(adapters, { attendance: 0, zomato: 0, swiggy: 0 })

    const { container } = renderBadge(adapters, ['attendance-waiting', 'zomato-needs-you'])

    // Indistinguishable from a group that was never badged — the same rule an
    // individual entry follows.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('nav-group-badge-setup')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('counts nothing for a group with no badged child', async () => {
    const adapters = createMockAdapters()
    stage(adapters, { attendance: 3, zomato: 4, swiggy: 2 })

    // Finances is exactly this today: four entries, none of them badged.
    renderBadge(adapters, [])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('nav-group-badge-setup')).toBeNull()
  })
})
