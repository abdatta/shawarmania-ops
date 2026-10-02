import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { BillingBill } from '@/data-access/adapters'

import { ShiftBillList } from './shift-bill-list'

const URL = 'https://shawarmania.in/bill?t=Ab3-_x9QzT'

const bill: BillingBill = {
  id: 'bill-1',
  outletId: 'outlet-1',
  billNumber: 27,
  orderId: null,
  orderNumber: null,
  businessDate: '2026-09-30',
  orderedAt: '2026-09-30T12:00:00.000Z',
  paidAt: '2026-09-30T12:05:00.000Z',
  paymentBusinessDate: '2026-09-30',
  payments: [{ method: 'cash', amountPaise: 13_900 }],
  paymentRevision: 0,
  paymentEditable: false,
  paymentEditableUntil: null,
  paymentMethod: 'cash',
  status: 'settled',
  billerName: 'Demo Biller',
  tillLabel: null,
  customerName: null,
  customerPhone: null,
  lines: [
    {
      menuItemId: 'item-1',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13_900,
      quantity: 1,
    },
  ],
  discounts: [],
  roundingPaise: 0,
  totalPaise: 13_900,
  voidKind: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  receiptUrl: URL,
}

async function expand(overrides: Partial<BillingBill> = {}) {
  const user = userEvent.setup()
  render(<ShiftBillList bills={[{ ...bill, ...overrides }]} />)
  await user.click(screen.getByText('Bill 27'))
  return { user, detail: screen.getByTestId('shift-bill-detail-bill-1') }
}

describe('a bill in Bills this shift', () => {
  it('shows its receipt inside the app from View receipt', async () => {
    const { user, detail } = await expand()

    await user.click(within(detail).getByRole('button', { name: 'View receipt' }))

    const dialog = screen.getByRole('dialog', { name: 'Receipt for bill 27' })
    expect(within(dialog).getByTitle('Receipt for bill 27')).toHaveAttribute(
      'src',
      `${URL}&view=counter`,
    )
  })

  /*
   * The token is minted when the row reaches Postgres, so a bill still in the
   * outbox has no receipt yet. Saying why is kinder than a button that vanishes
   * and reappears.
   */
  it('greys View receipt out with its reason for a bill not yet synced', async () => {
    const { detail } = await expand({ receiptUrl: null })

    expect(within(detail).getByRole('button', { name: 'View receipt' })).toBeDisabled()
    expect(within(detail).getByText('Receipt appears once this bill syncs')).toBeVisible()
  })

  it('offers no View receipt on a cancelled bill', async () => {
    const { detail } = await expand({ status: 'void' })

    expect(within(detail).queryByRole('button', { name: 'View receipt' })).not.toBeInTheDocument()
  })
})
