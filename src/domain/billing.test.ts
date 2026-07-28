import { describe, expect, it } from 'vitest'

import {
  billReference,
  billTotals,
  classifySync,
  lineTotalPaise,
  provisionalReference,
  provisionalToken,
  SYNC_ESCALATION_COUNT,
  SYNC_ESCALATION_MS,
} from './billing'
import { NotPaiseError } from './money'

describe('lineTotalPaise', () => {
  it('multiplies a unit price by a whole quantity', () => {
    expect(lineTotalPaise(13900, 2)).toBe(27800)
    expect(lineTotalPaise(25000, 1)).toBe(25000)
  })

  it('throws on a fractional price rather than rounding it', () => {
    expect(() => lineTotalPaise(139.5, 1)).toThrow(NotPaiseError)
  })

  it('throws on a quantity that is not a whole item', () => {
    expect(() => lineTotalPaise(13900, 1.5)).toThrow(TypeError)
    expect(() => lineTotalPaise(13900, 0)).toThrow(TypeError)
    expect(() => lineTotalPaise(13900, -1)).toThrow(TypeError)
  })
})

describe('billTotals', () => {
  // The real menu, which is the order a counter actually rings.
  const order = [
    { unitPricePaise: 13900, quantity: 2 },
    { unitPricePaise: 19900, quantity: 1 },
    { unitPricePaise: 25000, quantity: 1 },
  ]

  it('sums the lines and satisfies total = subtotal − discount + tax', () => {
    const totals = billTotals(order)

    expect(totals.subtotalPaise).toBe(27800 + 19900 + 25000)
    expect(totals.discountPaise).toBe(0)
    expect(totals.taxPaise).toBe(0)
    expect(totals.totalPaise).toBe(totals.subtotalPaise - totals.discountPaise + totals.taxPaise)
  })

  it('keeps the invariant with a discount and tax present', () => {
    const totals = billTotals(order, { discountPaise: 5000, taxPaise: 1200 })
    expect(totals.totalPaise).toBe(72700 - 5000 + 1200)
  })

  it('is zero for an empty order rather than throwing', () => {
    expect(billTotals([]).totalPaise).toBe(0)
  })

  it('refuses a discount larger than the order', () => {
    expect(() => billTotals(order, { discountPaise: 999999 })).toThrow(RangeError)
  })

  it('throws when a float reaches the money path', () => {
    expect(() => billTotals(order, { taxPaise: 12.5 })).toThrow(NotPaiseError)
    expect(() => billTotals([{ unitPricePaise: 0.1 + 0.2, quantity: 1 }])).toThrow(NotPaiseError)
  })
})

describe('provisional references', () => {
  const clientId = '0f9c4a11-3b8e-4c2a-9d77-1e5b6a0c8f31'

  it('is stable for a given bill', () => {
    expect(provisionalToken(clientId)).toBe(provisionalToken(clientId))
  })

  it('cannot be mistaken — or parsed — as a bill number', () => {
    const token = provisionalToken(clientId)
    expect(token).toHaveLength(4)
    expect(token[0]).toMatch(/[A-Z]/)
    expect(Number.isNaN(Number(token))).toBe(true)
    expect(provisionalReference(clientId)).toMatch(/^Queued · [A-Z][0-9A-Z]{3}$/)
  })

  it('differs from the way a numbered bill is written', () => {
    expect(billReference(143)).toBe('Bill 143')
    expect(provisionalReference(clientId)).not.toMatch(/^Bill /)
  })

  it('gives different bills different tokens', () => {
    const tokens = new Set(
      [
        '0f9c4a11-3b8e-4c2a-9d77-1e5b6a0c8f31',
        '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '00000000-0000-4000-8000-000000000001',
      ].map(provisionalToken),
    )
    expect(tokens.size).toBe(4)
  })
})

describe('classifySync', () => {
  const now = Date.parse('2026-07-28T12:00:00Z')

  it('is synced when nothing waits', () => {
    expect(classifySync({ pending: 0, oldestQueuedAt: null, now })).toBe('synced')
  })

  it('is pending while the queue is short and young', () => {
    expect(classifySync({ pending: 1, oldestQueuedAt: now - 1000, now })).toBe('pending')
    expect(
      classifySync({ pending: SYNC_ESCALATION_COUNT - 1, oldestQueuedAt: now - 1000, now }),
    ).toBe('pending')
  })

  it('escalates at the count threshold', () => {
    expect(classifySync({ pending: SYNC_ESCALATION_COUNT, oldestQueuedAt: now, now })).toBe(
      'stalled',
    )
  })

  it('escalates when the oldest bill has waited too long, however few there are', () => {
    expect(classifySync({ pending: 1, oldestQueuedAt: now - SYNC_ESCALATION_MS, now })).toBe(
      'stalled',
    )
    expect(classifySync({ pending: 1, oldestQueuedAt: now - SYNC_ESCALATION_MS + 1, now })).toBe(
      'pending',
    )
  })
})
