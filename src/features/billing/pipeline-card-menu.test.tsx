import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BillingOrder } from '@/data-access/adapters'
import { isInsideWindow, layOutAnchoredMenu } from '@/test/anchored-layout'

import { PipelineCard } from './pipeline-card'

/**
 * Where a pipeline card's More actions menu opens (a-menu-opens-where-it-can-be-read).
 *
 * It prefers above its trigger, and it used to open there whatever was above:
 * on a counter scrolled down to its expenses, the top card's menu opened wholly
 * off the top of the screen, Edit and Cancel order out of reach.
 */

const ONE_PERSON = 'p0000000-0000-4000-a000-000000000001'
const THIS_TILL = 'd0000000-0000-4000-a000-000000000001'
const PANEL = { width: 176, height: 100 }

const order: BillingOrder = {
  id: 'a0000000-0000-4000-a000-000000000001',
  outletId: 'o0000000-0000-4000-a000-000000000001',
  deviceId: THIS_TILL,
  orderNumber: 7,
  businessDate: '2026-10-08',
  orderedAt: new Date().toISOString(),
  preparedAt: null,
  status: 'open',
  creatorId: ONE_PERSON,
  creatorName: 'Asha',
  deviceLabel: null,
  customerName: null,
  customerPhone: null,
  discounts: [],
  roundingPaise: 0,
  lines: [
    {
      menuItemId: 'm0000000-0000-4000-a000-000000000001',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13900,
      quantity: 1,
    },
  ],
  totalPaise: 13900,
  cancelReason: null,
  cancelledAt: null,
  cancelledByName: null,
  paidAt: null,
  billId: null,
}

function noop() {}

/** The wrapper the card measures: the kebab button's own parent. */
function isKebab(element: Element) {
  return element.querySelector(':scope > button[aria-label^="More actions"]') !== null
}

async function openMenu() {
  render(
    <MemoryRouter>
      <PipelineCard
        order={order}
        currentBillerId={ONE_PERSON}
        currentDeviceId={THIS_TILL}
        onEdit={noop}
        onMarkPrepared={noop}
        onUnprepare={noop}
        onMarkPaid={noop}
        onCancel={noop}
        onUnpay={noop}
        onCancelAfterPaid={noop}
      />
    </MemoryRouter>,
  )
  await userEvent.setup().click(screen.getByRole('button', { name: /^More actions for / }))
  return screen.getByRole('menu')
}

afterEach(() => vi.restoreAllMocks())

describe("a pipeline card's menu opens where it can be read", () => {
  it('opens above its trigger when there is room above', async () => {
    layOutAnchoredMenu({
      isTrigger: isKebab,
      trigger: { top: 400, left: 900, width: 36, height: 36 },
      panel: PANEL,
    })
    const menu = await openMenu()

    expect(menu.getBoundingClientRect().bottom).toBe(400 - 4)
    expect(isInsideWindow(menu)).toBe(true)
  })

  it('opens below its trigger, on screen, when the trigger is at the top of the window', async () => {
    layOutAnchoredMenu({
      isTrigger: isKebab,
      trigger: { top: 0, left: 900, width: 36, height: 36 },
      panel: PANEL,
    })
    const menu = await openMenu()

    expect(menu.getBoundingClientRect().top).toBe(36 + 4)
    expect(isInsideWindow(menu)).toBe(true)
  })

  it('stays beside its trigger while its card is mid-slide', async () => {
    // A sliding card is transformed, and a transformed ancestor moves a fixed
    // panel away from the coordinates it was given.
    layOutAnchoredMenu({
      isTrigger: isKebab,
      trigger: { top: 400, left: 900, width: 36, height: 36 },
      panel: PANEL,
      offset: { top: 60, left: -20 },
    })
    const menu = await openMenu()

    const rect = menu.getBoundingClientRect()
    expect(rect.bottom).toBe(400 - 4)
    expect(rect.right).toBe(936)
  })
})
