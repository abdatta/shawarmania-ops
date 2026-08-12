import { describe, expect, it } from 'vitest'

import { paymentEditLabel } from './shift-bill-list'

describe('payment edit countdown', () => {
  it.each([
    [4 * 60_000 + 1_000, 'Edit (5 min)'],
    [60_000, 'Edit (1 min)'],
    [59_000, 'Edit (59 sec)'],
    [1, 'Edit (1 sec)'],
    [0, null],
  ])('formats %i milliseconds as %s', (remainingMs, label) => {
    expect(paymentEditLabel(remainingMs)).toBe(label)
  })
})
