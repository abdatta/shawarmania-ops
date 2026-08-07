import { describe, expect, it } from 'vitest'

import {
  ManualLedgerActionError,
  type ManualLedgerDayInput,
  type NewManualLedgerExpense,
} from '../adapters'
import { createMockManualLedgerAdapter } from './manual-ledger'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from './store'

/**
 * What this mock has to honour, because the database honours it: the day is one
 * row per outlet per date corrected in place, an expense cannot exist without a
 * category, a cash movement cannot exist without a reason, and nobody but an
 * owner gets an answer at all.
 *
 * The arithmetic is not tested here — it lives in
 * `src/features/manual-ledger/ledger.test.ts` and is the same module in both
 * modes. What is tested here is the storage contract the arithmetic reads from.
 */
describe('mock manual ledger adapter', () => {
  /**
   * A store, an adapter over it, and input builders **bound to that store**.
   *
   * The builders live here rather than beside the tests because the store
   * resolves today from the wall clock and its seeds are `daysAgo` offsets from
   * it. A date written down would be today on the day somebody typed it and a
   * seeded day the morning after, which is how this file went red four days
   * after it was written. Bound to the store, a date cannot be got wrong by
   * omission, and `store.today` is the day these tests want in every case: the
   * seeds leave it deliberately unrecorded, so it is the empty day an owner
   * arrives to fill in.
   */
  function over(role: Parameters<typeof createMockManualLedgerAdapter>[1] = 'super_admin') {
    const store = createDemoStore()

    const dayInput = (overrides: Partial<ManualLedgerDayInput> = {}): ManualLedgerDayInput => ({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
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
    })

    const expenseInput = (
      overrides: Partial<NewManualLedgerExpense> = {},
    ): NewManualLedgerExpense => ({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      category: 'Chicken',
      isCash: true,
      amountPaise: 240_000,
      note: 'From Nadia Poultry',
      ...overrides,
    })

    return { store, adapter: createMockManualLedgerAdapter(store, role), dayInput, expenseInput }
  }

  describe('the day', () => {
    it('records a day and reads it back', async () => {
      const { store, adapter, dayInput } = over()
      await adapter.upsertDay(dayInput())

      const read = await adapter.getDay(DEMO_OUTLET_ID, store.today)
      expect(read?.cashRevenuePaise).toBe(1_200_000)
      expect(read?.zomatoCommissionBp).toBe(2250)
    })

    it('corrects a day in place rather than adding a second one', async () => {
      const { store, adapter, dayInput } = over()
      const before = store.manualLedgerDays.length

      await adapter.upsertDay(dayInput())
      await adapter.upsertDay(dayInput({ countedCashPaise: 1_675_000, note: 'Recounted' }))

      expect(store.manualLedgerDays.length).toBe(before + 1)
      const read = await adapter.getDay(DEMO_OUTLET_ID, store.today)
      expect(read?.countedCashPaise).toBe(1_675_000)
      expect(read?.note).toBe('Recounted')
    })

    it('keeps who recorded it when the other owner corrects it', async () => {
      const { store, adapter, dayInput } = over()
      await adapter.upsertDay(dayInput())
      const author = store.manualLedgerDays.find(
        (row) => row.business_date === store.today,
      )?.recorded_by

      await adapter.upsertDay(dayInput({ countedCashPaise: 1_000_000 }))

      expect(
        store.manualLedgerDays.find((row) => row.business_date === store.today)?.recorded_by,
      ).toBe(author)
    })

    it('keeps the two outlets’ days apart', async () => {
      const { store, adapter, dayInput } = over()
      await adapter.upsertDay(dayInput({ cashRevenuePaise: 1_200_000 }))
      await adapter.upsertDay(
        dayInput({ outletId: DEMO_SECOND_OUTLET_ID, cashRevenuePaise: 700_000 }),
      )

      expect((await adapter.getDay(DEMO_OUTLET_ID, store.today))?.cashRevenuePaise).toBe(1_200_000)
      expect((await adapter.getDay(DEMO_SECOND_OUTLET_ID, store.today))?.cashRevenuePaise).toBe(
        700_000,
      )
    })

    it('returns null for a day nobody has recorded', async () => {
      const { adapter } = over()
      // A date nobody will ever write in, which no passing clock changes.
      expect(await adapter.getDay(DEMO_OUTLET_ID, '2020-01-01')).toBeNull()
    })

    it('refuses a drawer holding less than nothing', async () => {
      const { adapter, dayInput } = over()
      await expect(adapter.upsertDay(dayInput({ countedCashPaise: -1 }))).rejects.toThrow(
        ManualLedgerActionError,
      )
      await expect(adapter.upsertDay(dayInput({ openingCashPaise: -1 }))).rejects.toThrow(
        ManualLedgerActionError,
      )
    })

    it('refuses a cash movement with no reason, and accepts one with a reason', async () => {
      const { adapter, dayInput } = over()

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
      const { adapter, dayInput } = over()
      const saved = await adapter.upsertDay(
        dayInput({ cashRevenuePaise: -25_000, countedCashPaise: 475_000 }),
      )
      expect(saved.cashRevenuePaise).toBe(-25_000)
    })

    it('refuses a commission rate outside nought to a hundred per cent', async () => {
      const { adapter, dayInput } = over()
      await expect(adapter.upsertDay(dayInput({ zomatoCommissionBp: 10_001 }))).rejects.toThrow(
        /between 0% and 100%/,
      )
      await expect(adapter.upsertDay(dayInput({ swiggyCommissionBp: -1 }))).rejects.toThrow(
        /between 0% and 100%/,
      )
    })

    it('removes a day typed against the wrong date', async () => {
      const { store, adapter, dayInput } = over()
      await adapter.upsertDay(dayInput())
      await adapter.deleteDay(DEMO_OUTLET_ID, store.today)
      expect(await adapter.getDay(DEMO_OUTLET_ID, store.today)).toBeNull()
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
      const { store, adapter } = over()
      // Kanchrapara is deliberately unseeded: the month view reads one outlet at
      // a time, so a second fabricated month would buy nothing observable.
      expect(await adapter.getPreviousDay(DEMO_SECOND_OUTLET_ID, store.today)).toBeNull()
    })

    it('ignores the outlet next door when it looks backwards', async () => {
      const { store, adapter, dayInput } = over()
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
    it('records one and lists it for its day', async () => {
      const { store, adapter, expenseInput } = over()
      await adapter.createExpense(expenseInput())

      // Exactly one, because today is the day the seeds leave empty. A list of
      // three here means this test found a seeded day instead of today's.
      const list = await adapter.listExpenses(DEMO_OUTLET_ID, store.today)
      expect(list).toHaveLength(1)
      expect(list[0]?.note).toBe('From Nadia Poultry')
      expect(list[0]?.isCash).toBe(true)
    })

    it('requires a category and accepts no note', async () => {
      const { adapter, expenseInput } = over()

      await expect(adapter.createExpense(expenseInput({ category: '   ' }))).rejects.toThrow(
        ManualLedgerActionError,
      )
      await expect(adapter.createExpense(expenseInput({ note: null }))).resolves.toMatchObject({
        note: null,
      })
    })

    it('refuses an amount of nothing or less', async () => {
      const { adapter, expenseInput } = over()
      await expect(adapter.createExpense(expenseInput({ amountPaise: 0 }))).rejects.toThrow(
        /above zero/,
      )
      await expect(adapter.createExpense(expenseInput({ amountPaise: -100 }))).rejects.toThrow(
        /above zero/,
      )
    })

    it('edits one and keeps the note optional', async () => {
      const { store, adapter, expenseInput } = over()
      const created = await adapter.createExpense(expenseInput())

      const edited = await adapter.updateExpense(created.id, {
        amountPaise: 260_000,
        note: '11 kg from Nadia Poultry',
        isCash: false,
      })
      expect(edited.amountPaise).toBe(260_000)
      expect(edited.note).toBe('11 kg from Nadia Poultry')
      expect(edited.isCash).toBe(false)

      await expect(adapter.updateExpense(created.id, { note: '  ' })).resolves.toMatchObject({
        note: null,
      })
      const list = await adapter.listExpenses(DEMO_OUTLET_ID, store.today)
      expect(list[0]?.note).toBeNull()
    })

    it('removes one', async () => {
      const { store, adapter, expenseInput } = over()
      const created = await adapter.createExpense(expenseInput())
      await adapter.deleteExpense(created.id)
      expect(await adapter.listExpenses(DEMO_OUTLET_ID, store.today)).toEqual([])
    })
  })

  describe('the month', () => {
    it('reads one outlet’s month, and nothing of the other’s', async () => {
      const { store, adapter, dayInput, expenseInput } = over()
      const month = store.today.slice(0, 7)

      await adapter.upsertDay(dayInput({ outletId: DEMO_SECOND_OUTLET_ID }))
      await adapter.createExpense(
        expenseInput({
          outletId: DEMO_SECOND_OUTLET_ID,
          category: 'Rent',
          isCash: false,
          amountPaise: 5_000_000,
          note: 'Kanchrapara rent',
        }),
      )

      const mine = await adapter.getMonth(DEMO_OUTLET_ID, month)
      expect(mine.days.every((day) => day.outletId === DEMO_OUTLET_ID)).toBe(true)
      expect(mine.expenses.every((expense) => expense.outletId === DEMO_OUTLET_ID)).toBe(true)
      expect(mine.expenses.map((expense) => expense.note)).not.toContain('Kanchrapara rent')
    })

    it('is empty for a month nobody wrote in', async () => {
      const { adapter } = over()
      // A month nobody will ever write in, which no passing clock changes.
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
        const { store, adapter, dayInput, expenseInput } = over(role)

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
        const refusedDay = dayInput()
        await expect(adapter.upsertDay(refusedDay)).rejects.toThrow(/Only an owner/)
        await expect(
          adapter.createExpense(
            expenseInput({ category: 'Other', isCash: false, amountPaise: 100, note: 'x' }),
          ),
        ).rejects.toThrow(/Only an owner/)
        await expect(adapter.deleteDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(
          /Only an owner/,
        )
        await expect(adapter.deleteExpense('anything')).rejects.toThrow(/Only an owner/)

        // Refused, and nothing written on the way out — asserted against the
        // date the refused write actually carried, not one that happens to
        // match it today.
        expect(
          store.manualLedgerDays.some((day) => day.business_date === refusedDay.businessDate),
        ).toBe(false)
      })
    }
  })
})
