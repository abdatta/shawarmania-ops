import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { BillingOrder, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OpenOrdersSurface } from './open-orders-surface'

/**
 * The counter's pipeline board: two bands sharing the panel's height instead
 * of stacking into one long scroll. These tests pin the structural contract —
 * proportional growth, per-band scroll containment, and a floor under every
 * populated band — which is what keeps "at least the first card" true at any
 * viewport height. The pixel truth itself is browser-checked.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

let seq = 0
function order(over: Partial<BillingOrder>): BillingOrder {
  seq += 1
  return {
    id: `b0000000-0000-4000-a000-${String(seq).padStart(12, '0')}`,
    outletId: personaFixtures.biller.assignments[0]!.outletId!,
    deviceId: personaFixtures.biller.profile.id,
    orderNumber: seq,
    businessDate: '2026-08-23',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: personaFixtures.biller.profile.id,
    creatorName: personaFixtures.biller.profile.full_name,
    deviceLabel: null,
    customerName: null,
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: [
      {
        menuItemId: '31000000-0000-4000-a000-000000000001',
        itemName: 'Classic Chicken Shawarma',
        unitPricePaise: 11000,
        quantity: 1,
      },
    ],
    totalPaise: 11000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: null,
    billId: null,
    ...over,
  }
}

function preparing(n: number): BillingOrder[] {
  return Array.from({ length: n }, () => order({ status: 'open', preparedAt: null }))
}

function unpaidPrepared(n: number): BillingOrder[] {
  return Array.from({ length: n }, (_, i) =>
    order({
      status: 'open',
      preparedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
    }),
  )
}

function renderBoard(billingOrders: BillingOrder[]) {
  const base: DataAdapters = createMockAdapters('biller')
  const adapters: DataAdapters = {
    ...base,
    billing: {
      ...base.billing,
      listOpenOrders: async () => billingOrders,
    },
  }
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={billerSession}>
        <AdaptersContext.Provider value={adapters}>
          <OpenOrdersSurface embedded />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('Pipeline board height sharing', () => {
  it('grows each populated band in proportion to its work and scrolls within the band', async () => {
    renderBoard([...preparing(5), ...unpaidPrepared(2)])

    const preparingBand = await screen.findByTestId('pipeline-preparing')
    const preparedBand = screen.getByTestId('pipeline-unpaid-prepared')

    // Growth follows the work: five preparing orders claim five shares of the
    // free panel, two prepared orders claim two.
    expect(preparingBand).toHaveStyle({ 'flex-grow': '5' })
    expect(preparedBand).toHaveStyle({ 'flex-grow': '2' })
    // Shares are carved from the same panel: both start from zero basis and
    // may yield to the other's floor.
    expect(preparingBand).toHaveStyle({ 'flex-basis': '0px' })

    for (const band of [preparingBand, preparedBand]) {
      const list = within(band).getByTestId(`${band.dataset.testid}-list`)
      // Overflow is the band's own business: the list scrolls, the board does not.
      expect(list).toHaveClass('overflow-y-auto')
      expect(list).toHaveClass('min-h-0')
    }
  })

  it('lets an empty band yield its share and holds a floor under every populated band', async () => {
    renderBoard(preparing(3))

    const preparingBand = await screen.findByTestId('pipeline-preparing')
    const preparedBand = screen.getByTestId('pipeline-unpaid-prepared')

    expect(preparingBand).toHaveStyle({ 'flex-grow': '3' })
    // Nothing awaits money, so nothing claims space for it.
    expect(preparedBand).toHaveStyle({ 'flex-grow': '0' })
    expect(within(preparedBand).queryByRole('list')).not.toBeInTheDocument()

    // The floor stands in for the measurement the test DOM cannot take: a
    // populated band never starts smaller than one ticket.
    expect(preparingBand).toHaveClass('min-h-[120px]')
  })
})
