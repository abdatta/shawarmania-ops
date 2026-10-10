import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { KitchenMarks } from '@/data-access/adapters'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { KitchenMarksContext } from '@/features/billing/kitchen-marks-state'

import { CounterStatus } from './counter-status-pill'

/**
 * The counter header's status pill (#72): whether the tablet has synced, when
 * the shift opened, and — only where a kitchen screen exists and nobody is on
 * it — *Kitchen offline*.
 */
function renderPill(marks: KitchenMarks | null) {
  const adapters = createMockAdapters('biller', createDemoData())
  return render(
    <AdaptersContext.Provider value={adapters}>
      <KitchenMarksContext.Provider value={{ marks, refresh: async () => undefined }}>
        <CounterStatus openedAt="2026-10-09T17:00:00Z" />
      </KitchenMarksContext.Provider>
    </AdaptersContext.Provider>,
  )
}

const ON_SHIFT: KitchenMarks = {
  kitchens: [{ id: 'k1', label: 'Kitchen 1' }],
  orders: {},
  kitchenTablets: 1,
}

describe('the counter status pill', () => {
  it('says when the shift opened, in the outlet clock, and that it has synced', () => {
    renderPill(ON_SHIFT)
    expect(screen.getByTestId('counter-status')).toHaveTextContent('since 10:30 pm')
    expect(screen.getByTestId('sync-indicator')).toBeInTheDocument()
  })

  it('says nothing of the kitchen while a kitchen tablet is on shift', () => {
    renderPill(ON_SHIFT)
    expect(screen.queryByTestId('kitchen-offline')).toBeNull()
  })

  it('says Kitchen offline when the outlet has a kitchen tablet and none is on shift', () => {
    renderPill({ kitchens: [], orders: {}, kitchenTablets: 2 })
    expect(screen.getByTestId('kitchen-offline')).toHaveTextContent('Kitchen offline')
    expect(screen.getByTestId('kitchen-offline')).toHaveAttribute('role', 'status')
  })

  it('never says it at an outlet with no kitchen tablet', () => {
    renderPill({ kitchens: [], orders: {}, kitchenTablets: 0 })
    expect(screen.queryByTestId('kitchen-offline')).toBeNull()
  })

  it('never says it before the marks are read', () => {
    renderPill(null)
    expect(screen.queryByTestId('kitchen-offline')).toBeNull()
  })
})
