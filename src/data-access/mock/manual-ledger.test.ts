import { describe, expect, it } from 'vitest'

import {
  assignedOutlets,
  ManualLedgerActionError,
  type ManualLedgerDayInput,
  type NewManualLedgerExpense,
} from '../adapters'
import { personaFixtures } from './fixtures/personas'
import { createMockManualLedgerAdapter } from './manual-ledger'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from './store'

/**
 * What this mock has to honour, because the database honours it: the day is one
 * row per outlet per date corrected in place, an expense cannot exist without a
 * category, a cash movement cannot exist without a reason, the day record
 * answers only owners and managers, and the expense record answers everyone at
 * the outlet on the terms the policies set.
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
    const persona = personaFixtures[role]
    const assignedOutletIds = assignedOutlets(persona.assignments)

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

    return {
      store,
      adapter: createMockManualLedgerAdapter(store, role, persona.profile.id, assignedOutletIds),
      userId: persona.profile.id,
      dayInput,
      expenseInput,
    }
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
      const before = await adapter.listExpenses(DEMO_OUTLET_ID, store.today)
      const created = await adapter.createExpense(expenseInput())

      // One more than were there, rather than exactly one. Today carries seeded
      // expenses now — spending recorded through the day, hours before anybody
      // opens the day row, which is the case this capability exists for — while
      // the day row itself is still deliberately left unrecorded.
      const list = await adapter.listExpenses(DEMO_OUTLET_ID, store.today)
      expect(list).toHaveLength(before.length + 1)

      const mine = list.find((expense) => expense.id === created.id)
      expect(mine?.note).toBe('From Nadia Poultry')
      expect(mine?.isCash).toBe(true)
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
      expect(list.find((expense) => expense.id === created.id)?.note).toBeNull()
    })

    it('withdraws one, and keeps it', async () => {
      const { store, adapter, expenseInput, userId } = over()
      const created = await adapter.createExpense(expenseInput())

      const voided = await adapter.voidExpense(created.id)

      expect(voided.voidedAt).not.toBeNull()
      expect(voided.voidedBy?.id).toBe(userId)
      // No reason, and that is a complete trace [owner, 2026-08-09].
      expect(voided.voidedReason).toBeNull()

      const list = await adapter.listExpenses(DEMO_OUTLET_ID, store.today)
      expect(list.map((expense) => expense.id)).toContain(created.id)
    })

    it('stores a blank withdrawal reason as no reason at all', async () => {
      const { adapter, expenseInput } = over()
      const created = await adapter.createExpense(expenseInput())
      const voided = await adapter.voidExpense(created.id, '   ')
      expect(voided.voidedReason).toBeNull()
    })

    it('refuses to change a withdrawn expense, or withdraw it twice', async () => {
      const { adapter, expenseInput } = over()
      const created = await adapter.createExpense(expenseInput())
      await adapter.voidExpense(created.id, 'Typed twice')

      await expect(adapter.updateExpense(created.id, { amountPaise: 1 })).rejects.toThrow(
        /withdrawn/,
      )
      await expect(adapter.voidExpense(created.id)).rejects.toThrow(/withdrawn/)
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

  describe('the boundary between the two tables', () => {
    // The registry already means no staff shell mounts the ledger. The mock
    // refuses anyway, because the policies refuse it — and a mock that answered
    // would let the surface be built wrongly.
    //
    // What changed with `the-ledger-opens-to-the-outlet` is that the two tables
    // no longer answer alike for the same caller, so they are asserted apart.
    for (const role of ['biller', 'employee'] as const) {
      it(`refuses a ${role} every verb on the day record, at their own outlet`, async () => {
        const { store, adapter, dayInput } = over(role)

        // The read side protects any past day, any month aggregate and every
        // commission-net figure. The write side protects the drawer.
        await expect(adapter.getDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(/manager/)
        await expect(adapter.getPreviousDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(/manager/)
        await expect(adapter.getMonth(DEMO_OUTLET_ID, store.today.slice(0, 7))).rejects.toThrow(
          /manager/,
        )
        const refusedDay = dayInput()
        await expect(adapter.upsertDay(refusedDay)).rejects.toThrow(/manager/)
        await expect(adapter.deleteDay(DEMO_OUTLET_ID, store.today)).rejects.toThrow(/manager/)

        // Refused, and nothing written on the way out — asserted against the
        // date the refused write actually carried, not one that happens to
        // match it today.
        expect(
          store.manualLedgerDays.some((day) => day.business_date === refusedDay.businessDate),
        ).toBe(false)
      })

      it(`lets a ${role} read and record their own outlet's expenses`, async () => {
        const { store, adapter, expenseInput, userId } = over(role)

        const listed = await adapter.listExpenses(DEMO_OUTLET_ID, store.businessDate(1))
        // Every row at the outlet, whoever recorded it — which is the point of
        // the surface, not an oversight.
        expect(listed.length).toBeGreaterThan(0)
        expect(listed.some((expense) => expense.recordedBy.id !== userId)).toBe(true)

        const created = await adapter.createExpense(expenseInput())
        expect(created.recordedBy.id).toBe(userId)
        // Standing in the shop, so never marked from away.
        expect(created.recordedAway).toBe(false)
      })

      it(`refuses a ${role} an expense against any day but today`, async () => {
        const { store, adapter, expenseInput } = over(role)
        await expect(
          adapter.createExpense(expenseInput({ businessDate: store.businessDate(1) })),
        ).rejects.toThrow(/closed/)
      })

      it(`refuses a ${role} somebody else's expense, and an old one of their own`, async () => {
        const { store, adapter, expenseInput } = over(role)

        const someoneElses = (await adapter.listExpenses(DEMO_OUTLET_ID, store.businessDate(1)))[0]
        if (!someoneElses) throw new Error('The demo fixture no longer seeds an earlier expense.')

        // Two different refusals, and the older-day one is checked first by the
        // mock, so this row proves the date rule rather than the ownership one.
        await expect(adapter.updateExpense(someoneElses.id, { amountPaise: 1 })).rejects.toThrow(
          /closed/,
        )

        const own = await adapter.createExpense(expenseInput())
        await expect(adapter.updateExpense(own.id, { amountPaise: 100 })).resolves.toMatchObject({
          amountPaise: 100,
        })
      })
    }

    // The biller alone, deliberately. The demo Employee persona works BOTH
    // outlets — the case multi-outlet hiring exists for — so asserting a
    // cross-outlet refusal through them would assert nothing.
    it('refuses a biller anything at an outlet they are not assigned to', async () => {
      const { store, adapter, expenseInput } = over('biller')
      await expect(adapter.listExpenses(DEMO_SECOND_OUTLET_ID, store.today)).rejects.toThrow(
        /not yours/,
      )
      await expect(
        adapter.createExpense(expenseInput({ outletId: DEMO_SECOND_OUTLET_ID })),
      ).rejects.toThrow(/not yours/)
    })

    it('lets a manager read and write the full ledger at their own outlet', async () => {
      const { store, adapter, dayInput } = over('franchise_admin')

      await expect(adapter.upsertDay(dayInput())).resolves.toMatchObject({
        cashRevenuePaise: 1_200_000,
      })
      // The full day, not a staff subset: the drawer figures are exactly what a
      // manager is here for.
      const read = await adapter.getDay(DEMO_OUTLET_ID, store.today)
      expect(read?.countedCashPaise).toBe(1_700_000)
      expect(
        (await adapter.getMonth(DEMO_OUTLET_ID, store.today.slice(0, 7))).days.length,
      ).toBeGreaterThan(0)
    })

    it('refuses a manager the ledger at an outlet they do not manage', async () => {
      const { store, adapter, dayInput } = over('franchise_admin')
      await expect(adapter.getDay(DEMO_SECOND_OUTLET_ID, store.today)).rejects.toThrow(/manager/)
      await expect(
        adapter.upsertDay(dayInput({ outletId: DEMO_SECOND_OUTLET_ID })),
      ).rejects.toThrow(/manager/)
    })

    it('marks an expense recorded at an outlet the recorder is not assigned to', async () => {
      const owner = over('super_admin')
      const manager = over('franchise_admin')

      // At Kanchrapara the owner holds nothing, which is the case the marker
      // exists for: expected cash moves without anybody at that outlet spending
      // it. At Kalyani the same owner holds a Franchise Admin assignment — the
      // row their operational writes come from — so an expense there is an
      // ordinary manager expense and carries no marker. That distinction is the
      // rule, not an artefact of who the demo persona happens to be.
      expect(
        (await owner.adapter.createExpense(owner.expenseInput({ outletId: DEMO_SECOND_OUTLET_ID })))
          .recordedAway,
      ).toBe(true)
      expect((await owner.adapter.createExpense(owner.expenseInput())).recordedAway).toBe(false)
      expect((await manager.adapter.createExpense(manager.expenseInput())).recordedAway).toBe(false)
    })
  })
})
