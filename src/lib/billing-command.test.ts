import { describe, expect, it } from 'vitest'

import {
  BILLING_COMMAND_RPC,
  billingCommandRpcArguments,
  billingPayloadHash,
  canonicalBillingJson,
  createBillingCommand,
  type BillingCommandType,
  type PayNowPayload,
} from '../../shared/billing-command'

const payload: PayNowPayload = {
  billId: '40000000-0000-4000-a000-000000000001',
  businessDate: '2026-08-09',
  paymentBusinessDate: '2026-08-09',
  customerId: null,
  customerName: null,
  customerPhone: null,
  subtotalPaise: 13900,
  discountPaise: 0,
  taxPaise: 0,
  totalPaise: 13900,
  pricingMode: 'no_tax',
  payments: [{ method: 'cash', amountPaise: 13900 }],
  lines: [
    {
      id: '30000000-0000-4000-a000-000000000001',
      menuItemId: '31000000-0000-4000-a000-000000000001',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13900,
      quantity: 1,
      lineTotalPaise: 13900,
    },
  ],
}

describe('billing command canonical identity', () => {
  it('sorts object keys recursively while preserving line order', () => {
    expect(canonicalBillingJson({ z: 1, nested: { b: null, a: true }, lines: ['b', 'a'] })).toBe(
      '{"lines":["b","a"],"nested":{"a":true,"b":null},"z":1}',
    )
  })

  it('matches the PostgreSQL SHA-256 vector', async () => {
    expect(await billingPayloadHash({ a: 1, b: null })).toBe(
      '46e0ff59f6164548317489fbea1133a48f7a83c325c3535e44559c9619afb76b',
    )
  })

  it('builds an immutable-shape envelope and transmits every declared RPC key', async () => {
    const command = await createBillingCommand({
      commandId: '10000000-0000-4000-a000-000000000001',
      tabletId: '20000000-0000-4000-a000-000000000001',
      shiftId: '90000000-0000-4000-a000-000000000001',
      type: 'pay_now',
      createdAt: '2026-08-09T12:00:00.000Z',
      payload,
    })

    expect(Object.keys(billingCommandRpcArguments(command)).sort()).toEqual([
      'p_command_id',
      'p_created_at',
      'p_payload',
      'p_payload_hash',
      'p_schema_version',
      'p_shift_id',
    ])
    expect(billingCommandRpcArguments({ ...command, shiftId: null }).p_shift_id).toBeNull()
  })

  it('maps every command type to exactly one RPC', () => {
    const types: BillingCommandType[] = [
      'create_order',
      'revise_order',
      'cancel_order',
      'pay_order',
      'pay_now',
      'void_bill',
      'manager_cancel_order',
      'confirm_end_of_day',
    ]
    expect(types.map((type) => BILLING_COMMAND_RPC[type])).toHaveLength(8)
    expect(new Set(types.map((type) => BILLING_COMMAND_RPC[type])).size).toBe(8)
  })
})
