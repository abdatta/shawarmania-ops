import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillingOrder, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OpenOrdersSurface } from './open-orders-surface'

/**
 * The counter's pipeline as one list.
 *
 * It used to be two bands sharing the panel's height, and the tests here pinned
 * that height-sharing. #55 removed it: a card's position is decided by when its
 * order was taken and by nothing else, so what needs pinning instead is that
 * recording a fact moves nothing, and that the work outside the viewport is
 * announced by a chip that reaches it.
 *
 * The pixel truth itself is browser-checked; jsdom reports every layout box as
 * zero, so the clipping cases below give the scroller and its cards explicit
 * geometry rather than pretending to measure one.
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

/**
 * The adapter's answer, which the rail draws in the order it is given. The
 * mutable holder is what lets a prepare land and the next read return the
 * changed order without the test re-rendering anything itself.
 */
function railWith(initial: BillingOrder[]) {
  const held = { orders: initial }
  const base: DataAdapters = createMockAdapters('biller')
  const adapters: DataAdapters = {
    ...base,
    billing: {
      ...base.billing,
      listOpenOrders: async () => held.orders,
      markOrderPrepared: async (orderId: string, prepared: boolean) => {
        const found = held.orders.find((candidate) => candidate.id === orderId)!
        const next: BillingOrder = {
          ...found,
          preparedAt: prepared ? new Date().toISOString() : null,
        }
        held.orders = held.orders.map((candidate) => (candidate.id === orderId ? next : candidate))
        return next
      },
    },
  }
  return {
    held,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={billerSession}>
          <AdaptersContext.Provider value={adapters}>
            <OpenOrdersSurface embedded />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/** Position within the one list, which is the whole of what must not move. */
function positions(): string[] {
  return [...screen.getByTestId('pipeline-list').children].map(
    (item) => (item as HTMLElement).querySelector('article')!.dataset.flipId!,
  )
}

/**
 * jsdom has no layout, so the chip would always read "nothing is clipped". Give
 * the scroller a viewport and each card a height, which is exactly the geometry
 * the hook measures in a browser.
 */
function giveGeometry({ cardHeight = 100, viewport = 250, scrollTop = 0 } = {}) {
  const scroller = screen.getByTestId('pipeline-list') as HTMLElement
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: viewport })
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    value: cardHeight * scroller.children.length,
  })
  scroller.scrollTop = scrollTop
  ;[...scroller.children].forEach((child, index) => {
    Object.defineProperty(child, 'offsetTop', { configurable: true, value: index * cardHeight })
    Object.defineProperty(child, 'offsetHeight', { configurable: true, value: cardHeight })
  })
  return scroller
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

describe('the pipeline is one list', () => {
  it('keeps a card exactly where it is across a prepare and an unprepare', async () => {
    const person = user()
    railWith([order({}), order({}), order({})])

    await screen.findByTestId('pipeline-list')
    const before = positions()
    expect(before).toHaveLength(3)

    const middle = screen.getByTestId('pipeline-list').children[1] as HTMLElement
    const card = middle.querySelector('article')!
    const id = card.dataset.flipId!

    await person.click(within(card).getByRole('button', { name: 'Prepared' }))
    await waitFor(() =>
      expect(screen.getByTestId(`prepared-toggle-${id}`)).toHaveAttribute('aria-pressed', 'true'),
    )
    // The whole point of the change: the list is in the same order, and the
    // card the operator was looking at is still under their thumb.
    expect(positions()).toEqual(before)

    await person.click(screen.getByTestId(`prepared-toggle-${id}`))
    await waitFor(() =>
      expect(screen.getByTestId(`prepared-toggle-${id}`)).toHaveAttribute('aria-pressed', 'false'),
    )
    expect(positions()).toEqual(before)
  })

  it('draws no divider, no band and no section heading', async () => {
    railWith([order({}), order({ preparedAt: new Date().toISOString() })])

    await screen.findByTestId('pipeline-list')
    expect(screen.queryByTestId('pipeline-preparing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pipeline-unpaid-prepared')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.queryByText('Prepared · awaiting money')).not.toBeInTheDocument()
    // Both orders stand in the same list, whatever they have recorded.
    expect(screen.getByTestId('pipeline-list').children).toHaveLength(2)
  })
})

describe('the rail announces what is off screen', () => {
  it('shows neither chip while the whole list fits', async () => {
    railWith([order({}), order({})])

    await screen.findByTestId('pipeline-list')
    giveGeometry({ viewport: 500 }).dispatchEvent(new Event('scroll'))

    await waitFor(() => expect(screen.queryByTestId('rail-scroll-top')).not.toBeInTheDocument())
    expect(screen.queryByTestId('rail-scroll-bottom')).not.toBeInTheDocument()
  })

  it('counts what is clipped in each direction and scrolls the whole way to it', async () => {
    const person = user()
    railWith(Array.from({ length: 6 }, () => order({})))

    await screen.findByTestId('pipeline-list')
    // Six 100px cards in a 250px viewport, scrolled 200 down: two whole cards
    // are above the fold and one is entirely below it. The card straddling the
    // bottom edge is visible, because the chip announces what cannot be seen at
    // all rather than what is merely cut.
    const scroller = giveGeometry({ scrollTop: 200 })
    scroller.dispatchEvent(new Event('scroll'))

    await waitFor(() =>
      expect(screen.getByTestId('rail-scroll-top')).toHaveAccessibleName(
        'Scroll to the newest order — 2 hidden above',
      ),
    )
    expect(screen.getByTestId('rail-scroll-top')).toHaveTextContent('2 more')
    const bottom = screen.getByTestId('rail-scroll-bottom')
    expect(bottom).toHaveTextContent('1 more')
    expect(bottom).toHaveAccessibleName('Scroll to the oldest order — 1 hidden below')

    // The whole way, as a chat app jumps — not by a page and not to the next
    // card.
    await person.click(bottom)
    expect(scroller.scrollTop).toBe(600)
    await person.click(screen.getByTestId('rail-scroll-top'))
    expect(scroller.scrollTop).toBe(0)
  })

  it('marks the bottom chip while prepared work is waiting for money out of sight', async () => {
    railWith([
      ...Array.from({ length: 4 }, () => order({})),
      order({ preparedAt: new Date().toISOString() }),
    ])

    await screen.findByTestId('pipeline-list')
    const scroller = giveGeometry({ scrollTop: 0 })
    scroller.dispatchEvent(new Event('scroll'))

    await waitFor(() => expect(screen.getByTestId('rail-scroll-money-marker')).toBeInTheDocument())
    expect(screen.getByTestId('rail-scroll-bottom')).toHaveAccessibleName(
      'Scroll to the oldest order — 2 hidden below, including prepared work waiting for money',
    )

    // Scrolled until the prepared order crosses back over the fold, the marker
    // has nothing left to announce.
    giveGeometry({ scrollTop: 300 }).dispatchEvent(new Event('scroll'))
    await waitFor(() =>
      expect(screen.queryByTestId('rail-scroll-money-marker')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('rail-scroll-top')).toHaveTextContent('3 more')
  })
})
