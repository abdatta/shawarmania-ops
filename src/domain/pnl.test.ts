import { describe, expect, it } from 'vitest'

import {
  cashBasisProfitPaise,
  consumptionBasisProfitPaise,
  inventoryConsumedPaise,
  nonRawMaterialExpensesPaise,
  profitEstimate,
  PROFIT_BASIS_LABELS,
  type ConsumedMovement,
  type ExpenseAmount,
} from './pnl'

/**
 * The trap this module exists for: raw materials appear in the schema twice, and
 * counting both is the classic error `docs/DATA_MODEL.md` documents. The first
 * test below is the one `owner-console-live` (#13) has to keep passing.
 */
describe('profit estimation', () => {
  const expenses: ExpenseAmount[] = [
    { category: 'raw_materials', amountPaise: 150_000 },
    { category: 'electricity', amountPaise: 120_000 },
    { category: 'other', amountPaise: 20_000 },
  ]

  // 6 kg of chicken used at ₹240/kg, and one packet wasted at ₹45.
  const movements: ConsumedMovement[] = [
    { movementType: 'added', quantityDelta: 20, purchaseCostPaise: 24_000 },
    { movementType: 'used', quantityDelta: -6, purchaseCostPaise: 24_000 },
    { movementType: 'wasted', quantityDelta: -1, purchaseCostPaise: 4_500 },
  ]

  it('counts food once on the consumption basis, never twice', () => {
    const salesPaise = 500_000
    const consumption = consumptionBasisProfitPaise({ salesPaise, expenses, movements })

    // Non-raw-material expenses (₹1,400) plus stock consumed (₹1,485) —
    // and NOT the ₹1,500 raw-material expense, which bought that stock.
    expect(nonRawMaterialExpensesPaise(expenses)).toBe(140_000)
    expect(inventoryConsumedPaise(movements)).toBe(148_500)
    expect(consumption).toBe(500_000 - 140_000 - 148_500)

    // The double-count, written out so the failure mode is legible: subtracting
    // every expense *and* the stock consumed charges the food twice.
    const doubleCounted = salesPaise - 290_000 - 148_500
    expect(consumption).not.toBe(doubleCounted)
    expect(consumption - doubleCounted).toBe(150_000)
  })

  it('subtracts everything spent on the cash basis', () => {
    expect(cashBasisProfitPaise({ salesPaise: 500_000, expenses, movements })).toBe(
      500_000 - 290_000,
    )
  })

  it('gives the two bases different answers for the same period', () => {
    const inputs = { salesPaise: 500_000, expenses, movements }
    expect(cashBasisProfitPaise(inputs)).not.toBe(consumptionBasisProfitPaise(inputs))
  })

  it('does not treat an addition as consumption', () => {
    expect(
      inventoryConsumedPaise([
        { movementType: 'added', quantityDelta: 30, purchaseCostPaise: 4_500 },
      ]),
    ).toBe(0)
  })

  it('does not treat a correction as consumption', () => {
    // A recount that found half a litre less is a clipboard error, not food
    // that left the kitchen. Charging a period for it would be wrong twice
    // over: the stock was already consumed, or it never existed.
    expect(
      inventoryConsumedPaise([
        { movementType: 'correction', quantityDelta: -0.5, purchaseCostPaise: 18_000 },
        { movementType: 'correction', quantityDelta: 0.5, purchaseCostPaise: 18_000 },
      ]),
    ).toBe(0)
  })

  it('values a fractional quantity without letting binary error survive', () => {
    // 1.8 litres at ₹180 is ₹324 exactly; the float multiplication is not.
    expect(
      inventoryConsumedPaise([
        { movementType: 'used', quantityDelta: -1.8, purchaseCostPaise: 18_000 },
      ]),
    ).toBe(32_400)
    expect(Number.isInteger(inventoryConsumedPaise(movements))).toBe(true)
  })

  it('throws on a non-integer paise amount rather than rounding it', () => {
    expect(() =>
      cashBasisProfitPaise({ salesPaise: 100.5, expenses: [], movements: [] }),
    ).toThrowError(/integer paise/)
    expect(() =>
      cashBasisProfitPaise({
        salesPaise: 100,
        expenses: [{ category: 'other', amountPaise: 10.5 }],
        movements: [],
      }),
    ).toThrowError(/integer paise/)
    expect(() =>
      inventoryConsumedPaise([
        { movementType: 'used', quantityDelta: -1, purchaseCostPaise: 4_500.5 },
      ]),
    ).toThrowError(/integer paise/)
  })

  it('reports the working behind each figure, with its basis named', () => {
    const inputs = { salesPaise: 500_000, expenses, movements }

    const cash = profitEstimate('cash', inputs)
    expect(cash.basis).toBe('cash')
    expect(cash.consumedPaise).toBe(0)
    expect(cash.salesPaise - cash.expensesPaise - cash.consumedPaise).toBe(cash.profitPaise)

    const consumption = profitEstimate('consumption', inputs)
    expect(consumption.consumedPaise).toBeGreaterThan(0)
    expect(
      consumption.salesPaise - consumption.expensesPaise - consumption.consumedPaise,
    ).toBe(consumption.profitPaise)

    expect(PROFIT_BASIS_LABELS.cash).not.toBe(PROFIT_BASIS_LABELS.consumption)
  })
})
