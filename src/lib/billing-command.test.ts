import { describe, expect, it } from 'vitest'

import {
  BILLING_COMMAND_RPC,
  BILLING_COMMAND_SCHEMA_VERSIONS,
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
  roundingPaise: 0,
  totalPaise: 13900,
  pricingMode: 'no_tax',
  discounts: [],
  serviceType: null,
  tableNumber: null,
  payments: [{ method: 'cash', amountPaise: 13900 }],
  lines: [
    {
      id: '30000000-0000-4000-a000-000000000001',
      menuItemId: '31000000-0000-4000-a000-000000000001',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13900,
      quantity: 1,
      lineTotalPaise: 13900,
      discountPaise: 0,
      discountPercentBp: null,
      categoryName: null,
      kind: 'item',
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

    const serialized = JSON.parse(
      JSON.stringify(billingCommandRpcArguments({ ...command, shiftId: null })),
    ) as Record<string, unknown>
    expect(Object.keys(serialized).sort()).toEqual([
      'p_command_id',
      'p_created_at',
      'p_payload',
      'p_payload_hash',
      'p_schema_version',
      'p_shift_id',
    ])
    expect(serialized).toMatchObject({
      p_shift_id: null,
      p_payload: {
        customerId: null,
        customerName: null,
        customerPhone: null,
      },
    })
  })

  /**
   * Both payload shapes, hashed by both runtimes.
   *
   * The client computes a payload's identity in TypeScript and the database
   * recomputes it in SQL, and the two are only one rule because a shared vector
   * says so. Version 2 added the discount records and the rounding, which
   * changes that identity — and version 1 still has to hash to what it always
   * hashed to, because a till that went offline before the release is holding
   * envelopes whose hashes were computed then.
   *
   * The SQL half of these vectors lives in
   * `supabase/tests/49_the_boundary_accepts_both_shapes.sql`.
   */
  it('hashes the version-1 shape to what it always hashed to', async () => {
    const legacy = {
      orderId: '40000000-0000-4000-a000-000000000001',
      businessDate: '2026-08-09',
      customerId: null,
      customerName: null,
      customerPhone: null,
      subtotalPaise: 13900,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 13900,
      pricingMode: 'no_tax',
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

    expect(await billingPayloadHash(legacy)).toBe(
      '55d4e33863f19d9cf07d798e5fdc9307c3faeac644963ef106f23527e64ad93a',
    )
  })

  it('gives the version-2 shape a different identity, because it is one', async () => {
    const withDiscounts = {
      ...payload,
      discountPaise: 2085,
      roundingPaise: 85,
      totalPaise: 11900,
      discounts: [{ basis: 'amount', valueBp: null, valuePaise: 1000, amountPaise: 1000 }],
    }

    const bare = await billingPayloadHash(payload as unknown as Record<string, never>)
    const discounted = await billingPayloadHash(withDiscounts as unknown as Record<string, never>)
    expect(discounted).not.toBe(bare)
  })

  /**
   * Version 3 (#60): how the order was served. The SQL half of these two is in
   * `supabase/tests/63_orders_carry_how_they_were_served.sql`.
   */
  const shawarmaLine = {
    id: '30000000-0000-4000-a000-000000000031',
    menuItemId: '31000000-0000-4000-a000-000000000001',
    itemName: 'Classic Chicken Shawarma',
    unitPricePaise: 13900,
    quantity: 1,
    lineTotalPaise: 13900,
    discountPaise: 0,
    discountPercentBp: null,
    categoryName: 'Shawarma',
    kind: 'item',
  } as const
  const takeaway = {
    orderId: '40000000-0000-4000-a000-000000000003',
    businessDate: '2026-09-28',
    customerId: null,
    customerName: 'Asha',
    customerPhone: '+919876543210',
    subtotalPaise: 14900,
    discountPaise: 1000,
    taxPaise: 0,
    roundingPaise: 0,
    totalPaise: 13900,
    pricingMode: 'no_tax',
    discounts: [],
    serviceType: 'takeaway',
    tableNumber: null,
    lines: [
      shawarmaLine,
      {
        id: '30000000-0000-4000-a000-000000000032',
        menuItemId: null,
        itemName: 'Packaging',
        unitPricePaise: 500,
        quantity: 2,
        lineTotalPaise: 1000,
        discountPaise: 1000,
        discountPercentBp: 10000,
        categoryName: null,
        kind: 'packaging',
      },
    ],
  } as const

  it('hashes a version-3 gold takeaway with its waived bags as PostgreSQL does', async () => {
    expect(await billingPayloadHash(takeaway as unknown as Record<string, never>)).toBe(
      'f248fc64bb6b24d3e92bd37fdfdd59bae3b04c97456c2ea6cde61a5489e1535c',
    )
  })

  it('hashes a version-3 dine-in order at a table as PostgreSQL does', async () => {
    const dineIn = {
      ...takeaway,
      orderId: '40000000-0000-4000-a000-000000000004',
      serviceType: 'dine_in',
      tableNumber: 4,
      subtotalPaise: 13900,
      discountPaise: 0,
      lines: [shawarmaLine],
    }
    expect(await billingPayloadHash(dineIn as unknown as Record<string, never>)).toBe(
      '213a531bb9610dfb0f1df506528c207835fe4f53a93398d16933c04b94864bae',
    )
  })

  /**
   * Version 4 (#62): each bill-level discount says where it came from. The SQL
   * half of this vector is in `supabase/tests/66_a_regular_earns_points_and_gold.sql`.
   */
  it('hashes a version-4 order using points beside a biller discount as PostgreSQL does', async () => {
    const withPoints = {
      ...takeaway,
      orderId: '40000000-0000-4000-a000-000000000005',
      subtotalPaise: 13900,
      discountPaise: 3390,
      roundingPaise: 90,
      totalPaise: 10600,
      lines: [shawarmaLine],
      discounts: [
        { source: 'biller', basis: 'percent', valueBp: 1000, valuePaise: null, amountPaise: 1390 },
        { source: 'points', basis: 'amount', valueBp: null, valuePaise: 2000, amountPaise: 2000 },
      ],
    }
    expect(await billingPayloadHash(withPoints as unknown as Record<string, never>)).toBe(
      '961c761f98acbe4988f3b69873fe84f82c0d335a253d9e4de184fb9b90589b58',
    )
  })

  it('stamps every new envelope version 4', async () => {
    const command = await createBillingCommand({
      commandId: '10000000-0000-4000-a000-000000000003',
      tabletId: null,
      shiftId: null,
      type: 'cancel_order',
      createdAt: '2026-09-28T12:00:00.000Z',
      payload: { orderId: takeaway.orderId, reason: 'Test' },
    })
    expect(command.schemaVersion).toBe(4)
    expect(BILLING_COMMAND_SCHEMA_VERSIONS).toEqual([4, 3, 2, 1])
  })

  it('sorts the new keys into the canonical order like every other key', () => {
    expect(
      canonicalBillingJson({
        totalPaise: 11900,
        roundingPaise: 85,
        discounts: [{ basis: 'amount', amountPaise: 1000 }],
      }),
    ).toBe(
      '{"discounts":[{"amountPaise":1000,"basis":"amount"}],"roundingPaise":85,"totalPaise":11900}',
    )
  })

  it('maps every command type to exactly one RPC', () => {
    const types: BillingCommandType[] = [
      'create_order',
      'revise_order',
      'cancel_order',
      'pay_order',
      'pay_now',
      'correct_bill_payment',
      'void_bill',
      'manager_cancel_order',
      'confirm_end_of_day',
      'set_order_preparation',
      'void_order_payment',
      'cancel_paid_order',
    ]
    expect(types.map((type) => BILLING_COMMAND_RPC[type])).toHaveLength(12)
    expect(new Set(types.map((type) => BILLING_COMMAND_RPC[type])).size).toBe(12)
  })

  it('carries the preparation and unwind payloads through the canonical hash unchanged', async () => {
    const preparation = { orderId: 'd0000000-0000-4000-a000-000000000001', prepared: true }
    const unwind = {
      orderId: 'd0000000-0000-4000-a000-000000000001',
      billId: 'd1000000-0000-4000-a000-000000000001',
      reason: 'Wrong tender',
    }
    // Canonical form: sorted keys, no insignificant whitespace — the same
    // bytes PostgreSQL hashes for the same payloads.
    expect(canonicalBillingJson(preparation)).toBe(
      '{"orderId":"d0000000-0000-4000-a000-000000000001","prepared":true}',
    )
    expect(await billingPayloadHash(unwind)).toBe(
      await billingPayloadHash({
        reason: 'Wrong tender',
        billId: 'd1000000-0000-4000-a000-000000000001',
        orderId: 'd0000000-0000-4000-a000-000000000001',
      }),
    )
  })
})
