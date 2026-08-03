import { describe, expect, it } from 'vitest'

import { ManualLedgerActionError, type ManualLedgerDayInput } from '../adapters'
import { createMockManualLedgerAdapter } from './manual-ledger'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID, type DemoStore } from './store'

/**
 * What this mock has to honour, because the database honours it: the day is one
 * row per outlet per date corrected in place, an expense cannot exist without a
 * description, a cash movement cannot exist without a reason, and nobody but an
 * owner gets an answer at all.
 *
 * The arithmetic is not tested here — it lives in
 * `src/features/manual-ledger/ledger.test.ts` and is the same module in both
 * modes. What is tested here is the storage contract the arithmetic reads from.
 */
describe('mock manual ledger adapter', () => {
  function over(role: Parameters<typeof createMockManualLedgerAdapter>[1] = 'super_admin'): {
    store: DemoStore
    adapter: ReturnType<typeof createMockManualLedgerAdapter>
  } {
    const store = createDemoStore()
    return { store, adapter: createMockManualLedgerAdapter(store, role) }
  }

  function dayInput(overrides: Partial<ManualLedgerDayInput> = {}): ManualLedgerDayInput {
    return {
      outletId: DEMO_OUTLET_ID,
      businessDate: '2026-08-04',
      openingCashPaise: 500_000,
      cashRevenuePaise: 1_200_000,
      upiRevenuePaise: 400_000,
      zomatoRevenuePaise: 300_000,
      swiggyRevenuePaise: 250_000,
      cashAddedPaise: 0,
      cashAddedReason: null,
      cashRemovedPaise: 0,
      cashRemovedReason: null,
      countedCashPaise: 1_700_000,
      zomatoCommissionBp: 2250,
      swiggyCommissionBp: 2100,
      note: null,
      ...overrides,
    }
  }

  describe('the day', () => {
    it('records a day and reads it back', async () => {
      const { adapter } = over()
      await adapter.upsertDay(dayInput())

      const read = await adapter.getDay(DEMO_OUTLET_ID, '2026-08-04')
      expect(read?.cashRevenuePaise).toBe(1_200_000)
      expect(read?.zomatoCommissionBp).toBe(2250)
    })

    it('corrects a day in place rather than adding a second one', async () => {
      const { store, adapter } = over()
      const before = store.manualLedgerDays.length

      await adapter.upsertDay(dayInput())
      await adapter.upsertDay(dayInput({ countedCashPaise: 1_675_000, note: 'Recounted' }))

      expect(store.manualLedgerDays.length).toBe(before + 1)
      const read = await adapter.getDay(DEMO_OUTLET_ID, '2026-08-04')
      expect(read?.countedCashPaise).toBe(1_675_000)
      expect(read?.note).toBe('Recounted')
    })

    it('keeps who recorded it when the other owner corrects it', async () => {
      const { store, adapter } = over()
      await adapter.upsertDay(dayInput())
      const author = store.manualLedgerDays.find(
        (row) => row.business_date === '2026-08-04',
      )?.recorded_by

      await adapter.upsertDay(dayInput({ countedCashPaise: 1_000_000 }))

      expect(
        store.manualLedgerDays.find((row) => row.business_date === '2026-08-04')?.recorded_by,
      ).toBe(author)
    })

    it('keeps the two outlets’ days apart', async () => {
      const { adapter } = over()
      await adapter.upsertDay(dayInput({ cashRevenuePaise: 1_200_000 }))
      await adapter.upsertDay(
        dayInput({ outletId: DEMO_SECOND_OUTLET_ID, cashRevenuePaise: 700_000 }),
      )

      expect((await adapter.getDay(DEMO_OUTLET_ID, '2026-08-04'))?.cashRevenuePaise).toBe(1_200_000)
      expect((await adapter.getDay(DEMO_SECOND_OUTLET_ID, '2026-08-04'))?.cashRevenuePaise).toBe(
        700_000,
      )
    })

    it('returns null for a day nobody has recorded', async () => {
      const { adapter } = over()
      expect(await adapter.getDay(DEMO_OUTLET_ID, '2020-01-01')).toBeNull()
    })

    it('refuses a drawer holding less than nothing', async () => {
      const { adapter } = over()
      await expect(adapter.upsertDay(dayInput({ countedCashPaise: -1 }))).rejects.toThrow(
        ManualLedgerActionError,
      )
      await expect(adapter.upsertDay(dayInput({ openingCashPaise: -1 }))).rejects.toThrow(
        ManualLedgerActionError,
      )
    })

    it('refuses a cash movement with no reason, and accepts one with a reason', async () => {
      const { adapter } = over()

      await expect(
        adapter.upsertDay(dayInput({ cashRemovedPaise: 400_000, cashRemovedReason: '   ' })),
      ).rejects.toThrow(/why cash was taken out/)

      await expect(
        adapter.upsertDay(dayInput({ cashAddedPaise: 100_000, cashAddedReason: null })),
      ).rejects.toThrow(/why cash was brought in/)

      const saved = await adapter.upsertDay(
        dayInput({
          cashRemovedPaise: 400_000,
          cashRemovedReason: 'Banked on the way home',
          countedCashPaise: 1_300_000,
        }),
      )
      expect(saved.cashRemovedReason).toBe('Banked on the way home')
    })

    it('accepts negative revenue, because that is how a refund is recorded', async () => {
      const { adapter } = over()
      const saved = await adapter.upsertDay(
        dayInput({ cashRevenuePaise: -25_000, countedCashPaise: 475_000 }),
      )
      expect(saved.cashRevenuePaise).toBe(-25_000)
    })

    it('refuses a commission rate outside nought to a hundred per cent', async () => {
      const { adapter } = over()
      await expect(adapter.upsertDay(dayInput({ zomatoCommissionBp: 10_001 }))).rejects.toThrow(
        /between 0% and 100%/,
      )
      await expect(adapter.upsertDay(dayInput({ swiggyCommissionBp: -1 }))).rejects.toThrow(
        /between 0% and 100%/,
      )
    })

    it('removes a day typed against the wrong date', async () => {
      const { adapter } = over()
      await adapter.upsertDay(dayInput())
      await adapter.deleteDay(DEMO_OUTLET_ID, '2026-08-04')
      expect(await adapter.getDay(DEMO_OUTLET_ID, '2026-08-04')).toBeNull()
    })
  })

  describe('the defaults a new day is offered', () => {
    it('offers the most recent earlier day, not literally yesterday', async () => {
      const { store, adapter } = over()

      // A gap in the notebook is normal, so the chain runs between the rows that
      // exist rather than between calendar days.
      const previous = await adapter.getPreviousDay(DEMO_OUTLET_ID, store.today)

      expect(previous?.businessDate).toBe(store.businessDate(1))
      // Which is what the form offers as this day's opening cash and rates.
      expect(previous?.countedCashPaise).toBe(795_000)
      expect(previous?.zomatoCommissionBp).toBe(1800)
    })

    it('has nothing to offer on an outlet’s first tracked day', async () => {
      const { adapter } = over()
      // Kanchrapara is deliberately unseeded: the month view reads one outlet at
      // a time, so a second fabricated month would buy nothing observable.
      expect(await adapter.getPreviousDay(DEMO_SECOND_OUTLET_ID, '2026-08-04')).toBeNull()
    })

    it('ignores the outlet next door when it looks backwards', async () => {
      const { store, adapter } = over()
      await adapter.upsertDay(
        dayInput({
          outletId: DEMO_SECOND_OUTLET_ID,
          businessDate: store.businessDate(1),
          countedCashPaise: 111_111,
        }),
      )

      const previous = await adapter.getPreviousDay(DEMO_OUTLET_ID, store.today)
      expect(previous?.countedCashPaise).not.toBe(111_111)
    })
  })

  describe('expenses', () => {
    const newExpense = {
      outletId: DEMO_OUTLET_ID,
      businessDate: '2026-08-04',
      category: 'raw_materials' as const,
      isCash: true,
      amountPaise: 240_000,
      description: 'Chicken from Nadia Poultry',
    }

    it('records one and lists it for its day', async () => {
      const { adapter } = over()
      await adapter.createExpense(newExpense)

      const list = await adapter.listExpenses(DEMO_OUTLET_ID, '2026-08-04')
      expect(list).toHaveLength(1)
      expect(list[0]?.description).toBe('Chicken from Nadia Poultry')
      expect(list[0]?.isCash).toBe(true)
    })

    it('refuses one with nothing said about what it was for', async () => {
      const { adapter } = over()

      await expect(adapter.createExpense({ ...newExpense, description: '   ' })).rejects.toThrow(
        /what the money was spent on/,
      )
      await expect(adapter.createExpense({ ...newExpense, description: '' })).rejects.toThrow(
        ManualLedgerActionError,
      )
    })

    it('refuses an amount of nothing or less', async () => {
      const { adapter } = over()
      await expect(adapter.createExpense({ ...newExpense, amountPaise: 0 })).rejects.toThrow(
        /above zero/,
      )
      await expect(adapter.createExpense({ ...newExpense, amountPaise: -100 })).rejects.toThrow(
        /above zero/,
      )
    })

    it('edits one, and refuses an edit that would make it unidentifiable', async () => {
      const { adapter } = over()
      const created = await adapter.createExpense(newExpense)

      const edited = await adapter.updateExpense(created.id, {
        amountPaise: 260_000,
        description: 'Chicken, 11 kg, from Nadia Poultry',
        isCash: false,
      })
      expect(edited.amountPaise).toBe(260_000)
      expect(edited.description).toBe('Chicken, 11 kg, from Nadia Poultry')
      expect(edited.isCash).toBe(false)

      await expect(adapter.updateExpense(created.id, { description: '  ' })).rejects.toThrow(
        /what the money was spent on/,
      )
      // And the refused edit changed nothing.
      const list = await adapter.listExpenses(DEMO_OUTLET_ID, '2026-08-04')
      expect(list[0]?.description).toBe('Chicken, 11 kg, from Nadia Poultry')
    })

    it('removes one', async () => {
      const { adapter } = over()
      const created = await adapter.createExpense(newExpense)
      await adapter.deleteExpense(created.id)
      expect(await adapter.listExpenses(DEMO_OUTLET_ID, '2026-08-04')).toEqual([])
    })
  })

  describe('the month', () => {
    it('reads one outlet’s month, and nothing of the other’s', async () => {
      const { store, adapter } = over()
      const month = store.today.slice(0, 7)

      await adapter.upsertDay(
        dayInput({ outletId: DEMO_SECOND_OUTLET_ID, businessDate: store.today }),
      )
      await adapter.createExpense({
        outletId: DEMO_SECOND_OUTLET_ID,
        businessDate: store.today,
        category: 'rent',
        isCash: false,
        amountPaise: 5_000_000,
        description: 'Kanchrapara rent',
      })

      const mine = await adapter.getMonth(DEMO_OUTLET_ID, month)
      expect(mine.days.every((day) => day.outletId === DEMO_OUTLET_ID)).toBe(true)
      expect(mine.expenses.every((expense) => expense.outletId === DEMO_OUTLET_ID)).toBe(true)
      expect(mine.expenses.map((expense) => expense.description)).not.toContain('Kanchrapara rent')
    })

    it('is empty for a month nobody wrote in', async () => {
      const { adapter } = over()
      const month = await adapter.getMonth(DEMO_OUTLET_ID, '2020-01')
      expect(month.days).toEqual([])
      expect(month.expenses).toEqual([])
    })

    it('returns days in date order, so the chain can be walked', async () => {
      const { store, adapter } = over()
      const month = await adapter.getMonth(DEMO_OUTLET_ID, store.today.slice(0, 7))
      const dates = month.days.map((day) => day.businessDate)
      expect([...dates].sort((a, b) => a.localeCompare(b))).toEqual(dates)
    })
  })

  describe('the owner-only boundary', () => {
    // The registry already means no other role's shell mounts this surface. The
    // mock refuses anyway, because the policies refuse every verb on both tables
    // — and a mock that answered would let the surface be built wrongly.
    for (const role of ['franchise_admin', 'biller', 'employee'] as const) {
      it(`refuses every read and write to a ${role}`, async () => {
        const { store, adapter } = over(role)

        await expect(adapter.getDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(/Only an owner/)
        await expect(adapter.getPreviousDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(
          /Only an owner/,
        )
        await expect(adapter.listExpenses(DEMO_OUTLET_ID, store.today)).rejects.toThrow(
          /Only an owner/,
        )
        await expect(adapter.getMonth(DEMO_OUTLET_ID, store.today.slice(0, 7))).rejects.toThrow(
          /Only an owner/,
        )
        await expect(adapter.upsertDay(dayInput())).rejects.toThrow(/Only an owner/)
        await expect(
          adapter.createExpense({
            outletId: DEMO_OUTLET_ID,
            businessDate: store.today,
            category: 'other',
            isCash: false,
            amountPaise: 100,
            description: 'x',
          }),
        ).rejects.toThrow(/Only an owner/)
        await expect(adapter.deleteDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(
          /Only an owner/,
        )
        await expect(adapter.deleteExpense('anything')).rejects.toThrow(/Only an owner/)

        // Refused, and nothing written on the way out.
        expect(store.manualLedgerDays.some((day) => day.business_date === '2026-08-04')).toBe(false)
      })
    }
  })
})
