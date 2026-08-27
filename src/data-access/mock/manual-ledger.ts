import {
  isStaffRole,
  ManualLedgerActionError,
  type AppRole,
  type ChannelSettlement,
  type LedgerActor,
  type ManualLedgerAdapter,
  type ManualLedgerDay,
  type ManualLedgerDayFigures,
  type ManualLedgerDayInput,
  type ManualLedgerExpense,
  type ManualLedgerExpensePatch,
  type NewManualLedgerExpense,
  type ZomatoSettlement,
} from '../adapters'
import type { Tables } from '../database.types'
import { toZomatoSettlement } from '../zomato-settlement'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'
import { captureMockCategory } from './expense-categories'

/**
 * A date the sync wrote figures for but nobody counted — the "day nobody counted".
 * Cash is nil because none was counted, and `counted: false` keeps it out of the
 * month's recorded-day tally. No ledger row exists behind it.
 */
function uncountedFiguresDay(
  outletId: string,
  businessDate: string,
  zomato: ZomatoSettlement | null,
  swiggy: ChannelSettlement | null,
): ManualLedgerDayFigures {
  return {
    outletId,
    businessDate,
    openingCashPaise: 0,
    cashRevenuePaise: 0,
    upiRevenuePaise: 0,
    zomatoRevenuePaise: zomato?.revenuePaise ?? 0,
    cashAddedPaise: 0,
    cashAddedReason: null,
    cashRemovedPaise: 0,
    cashRemovedReason: null,
    countedCashPaise: 0,
    zomatoCommissionPaise: zomato?.commissionPaise ?? null,
    note: null,
    zomatoSettlement: zomato,
    swiggySettlement: swiggy,
    counted: false,
  }
}

/**
 * The mock manual-ledger adapter (#36) — **temporary, deleted with the
 * capability**.
 *
 * It exists because the registry contract requires every surface to read through
 * an adapter with a mock behind it, and the four-role walkthrough is a standing
 * gate on every change (design D5). Shipping real-only would have meant arguing
 * around that gate rather than passing it.
 *
 * **The refusals here are the database's, restated.** Not for safety — a demo has
 * nothing to protect — but so the surface is built against the answers it will
 * actually get. A mock that accepted a blank expense description would teach the
 * screen that the field is optional, and the first real write would be refused by
 * a constraint nobody had designed for.
 *
 * What it deliberately does not do is compute anything: every figure comes from
 * `src/features/manual-ledger/ledger.ts`, in both modes.
 */

/**
 * Names for the accounts that wrote in the ledger, exactly as
 * `manual_ledger_people()` supplies them in real mode.
 *
 * Every demo persona is in one map because the demo has nobody to hide from.
 * What matters is the *shape*: the surface reads a name from a lookup rather
 * than from the row, so it is built against the same seam it will use for real —
 * where `profiles` cannot answer for an Employee, or for an owner seen from an
 * outlet.
 */
const LEDGER_PEOPLE: ReadonlyMap<string, string | null> = new Map(
  Object.values(personaFixtures).map((persona) => [persona.profile.id, persona.profile.full_name]),
)

function actor(id: string): LedgerActor {
  return { id, name: LEDGER_PEOPLE.get(id) ?? null }
}

function optionalActor(id: string | null): LedgerActor | null {
  return id ? actor(id) : null
}

function toDay(
  row: Tables<'manual_ledger_days'>,
  figure: Tables<'aggregator_channel_days'> | null,
  swiggyFigure: Tables<'aggregator_channel_days'> | null,
): ManualLedgerDay {
  const settlement = toZomatoSettlement(figure)
  // Both channels obey the same authority rule as the real adapter: a measured
  // reading stands over a legacy typed figure, and absent falls back to the row.
  const swiggySettlement = toZomatoSettlement(swiggyFigure)
  return {
    outletId: row.outlet_id,
    businessDate: row.business_date,
    openingCashPaise: row.opening_cash_paise,
    cashRevenuePaise: row.cash_revenue_paise,
    upiRevenuePaise: row.upi_revenue_paise,
    zomatoRevenuePaise: settlement?.revenuePaise ?? 0,
    cashAddedPaise: row.cash_added_paise,
    cashAddedReason: row.cash_added_reason,
    cashRemovedPaise: row.cash_removed_paise,
    cashRemovedReason: row.cash_removed_reason,
    countedCashPaise: row.counted_cash_paise,
    zomatoCommissionPaise: settlement?.commissionPaise ?? null,
    note: row.note,
    recordedBy: actor(row.recorded_by),
    updatedBy: optionalActor(row.updated_by),
    zomatoSettlement: settlement,
    swiggySettlement: swiggySettlement,
  }
}

function toExpense(row: Tables<'manual_ledger_expenses'>): ManualLedgerExpense {
  return {
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    isCash: row.is_cash,
    amountPaise: row.amount_paise,
    note: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordedBy: optionalActor(row.recorded_by),
    source:
      row.source_system === null || row.source_ref === null
        ? null
        : { system: row.source_system, ref: row.source_ref },
    updatedBy: optionalActor(row.updated_by),
    recordedAway: row.recorded_away,
    voidedAt: row.voided_at,
    voidedBy: optionalActor(row.voided_by),
    voidedReason: row.voided_reason,
  }
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** Every check the migration writes as a constraint, in the order it writes them. */
function refuseImpossibleDay(day: ManualLedgerDayInput): void {
  for (const [figure, label] of [
    [day.openingCashPaise, 'opening cash'],
    [day.countedCashPaise, 'the counted amount'],
    [day.cashAddedPaise, 'cash brought in'],
    [day.cashRemovedPaise, 'cash taken out'],
  ] as const) {
    if (!Number.isInteger(figure) || figure < 0) {
      throw new ManualLedgerActionError(
        'impossible_figure',
        `A drawer cannot hold less than nothing — check ${label}.`,
      )
    }
  }

  if (day.cashAddedPaise > 0 && !trimmed(day.cashAddedReason)) {
    throw new ManualLedgerActionError(
      'reason_required',
      'Say why cash was brought in. A movement with no reason is unexplainable later.',
    )
  }
  if (day.cashRemovedPaise > 0 && !trimmed(day.cashRemovedReason)) {
    throw new ManualLedgerActionError(
      'reason_required',
      'Say why cash was taken out. A movement with no reason is unexplainable later.',
    )
  }

  /*
   * Commission is an amount, bounded by the revenue it comes off rather than by a
   * percentage ceiling, and it may be **undetermined** on a channel that earned
   * something. The bound is stated as min/max of nought and the revenue so a
   * refunded day, whose revenue is negative, is bounded the same way in the other
   * direction. Mirrors the database constraint of the same name.
   *
   * Nothing is checked any more, and that is deliberate. Zomato was frozen first;
   * Swiggy's figures now arrive through its channel-day row too, so the input no
   * longer carries either channel's commission — there is nothing left to
   * validate without refusing saves for figures this form never sends.
   */
  void day
}

function refuseImpossibleExpense(expense: { amountPaise: number; category: string }): void {
  if (!Number.isInteger(expense.amountPaise) || expense.amountPaise <= 0) {
    throw new ManualLedgerActionError(
      'bad_amount',
      'An expense needs an amount above zero, as a number of rupees.',
    )
  }
  if (!expense.category.trim()) {
    throw new ManualLedgerActionError(
      'category_required',
      'Choose or type what the money was spent on.',
    )
  }
}

export function createMockManualLedgerAdapter(
  store: DemoStore,
  role: AppRole,
  userId: string,
  assignedOutletIds: readonly string[],
): ManualLedgerAdapter {
  let nextId = 1

  const isOwner = role === 'super_admin'
  const isManager = role === 'franchise_admin'
  const isStaff = isStaffRole(role)

  function assignedAt(outletId: string): boolean {
    return assignedOutletIds.includes(outletId)
  }

  /**
   * The day record: owners everywhere, managers where they are assigned, and
   * **nobody else anywhere** — including at their own outlet.
   *
   * The registry already means no staff shell mounts the ledger, so this is not
   * reached in a walkthrough. It is here because the policies refuse it, and a
   * mock that would have answered is a mock the surface could be built wrongly
   * against. The refusal protects the drawer on the write side and past days and
   * month aggregates on the read side (design D5).
   */
  function refuseDay(outletId: string): void {
    if (isOwner) return
    if (isManager && assignedAt(outletId)) return
    throw new ManualLedgerActionError(
      'not_permitted',
      'The day’s figures belong to the manager and the owner.',
    )
  }

  /** The measured figure for an outlet-date, or none — its own table now. */
  /** The shared lookup under any channel's name. */
  function channelFigureFor(
    outletId: string,
    channel: 'zomato' | 'swiggy',
    businessDate: string,
  ): Tables<'aggregator_channel_days'> | null {
    return (
      store.aggregatorChannelDays.find(
        (row) =>
          row.outlet_id === outletId &&
          row.channel === channel &&
          row.business_date === businessDate,
      ) ?? null
    )
  }

  /** The measured Zomato figure for an outlet-date, or none — its own table now. */
  function figureFor(
    outletId: string,
    businessDate: string,
  ): Tables<'aggregator_channel_days'> | null {
    return channelFigureFor(outletId, 'zomato', businessDate)
  }

  /** The same lookup for any channel; Swiggy's rows live beside Zomato's. */
  function swiggyFigureFor(
    outletId: string,
    businessDate: string,
  ): Tables<'aggregator_channel_days'> | null {
    return channelFigureFor(outletId, 'swiggy', businessDate)
  }

  /** The expense record: everyone at the outlet, whoever recorded the row. */
  function refuseExpenses(outletId: string): void {
    if (isOwner) return
    if ((isManager || isStaff) && assignedAt(outletId)) return
    throw new ManualLedgerActionError(
      'not_permitted',
      'That outlet’s expenses are not yours to read.',
    )
  }

  /**
   * The two staff limits the guard enforces, restated so the form is built
   * against the answers it will get: record against today only, and correct or
   * withdraw only your own row while its day is still running.
   *
   * A manager or owner passes both untouched, which is what makes the freeze a
   * routing rule rather than a dead end — the row stays fixable, by somebody
   * else.
   */
  function refuseStaffWrite(row: { businessDate: string; recordedBy?: string | undefined }): void {
    if (!isStaff) return
    if (row.businessDate !== store.businessDate(0)) {
      throw new ManualLedgerActionError(
        'refused',
        'That day has closed. A manager or the owner can still change it.',
      )
    }
    if (row.recordedBy !== undefined && row.recordedBy !== userId) {
      throw new ManualLedgerActionError('not_permitted', 'That one is somebody else’s to correct.')
    }
  }

  function findExpense(id: string): Tables<'manual_ledger_expenses'> {
    const existing = store.manualLedgerExpenses.find((expense) => expense.id === id)
    if (!existing) {
      throw new ManualLedgerActionError('not_found', 'That expense is no longer there.')
    }
    return existing
  }

  /** A withdrawn row is final: no edit, no second void, no un-void. */
  function refuseVoided(expense: Tables<'manual_ledger_expenses'>): void {
    if (expense.voided_at !== null) {
      throw new ManualLedgerActionError(
        'refused',
        'That one was withdrawn. Record a new expense instead of changing it.',
      )
    }
  }

  return {
    async getCounterRevenue() {
      return null
    },

    async getDay(outletId, businessDate) {
      refuseDay(outletId)
      const row = store.manualLedgerDays.find(
        (day) => day.outlet_id === outletId && day.business_date === businessDate,
      )
      return row
        ? toDay(row, figureFor(outletId, businessDate), swiggyFigureFor(outletId, businessDate))
        : null
    },

    async getDayFigures(outletId, businessDate) {
      refuseDay(outletId)
      const zomato = figureFor(outletId, businessDate)
      const swiggy = swiggyFigureFor(outletId, businessDate)
      return zomato || swiggy
        ? {
            zomato: zomato ? toZomatoSettlement(zomato) : null,
            swiggy: swiggy ? toZomatoSettlement(swiggy) : null,
          }
        : null
    },

    async getPreviousDay(outletId, businessDate) {
      refuseDay(outletId)
      // The most recent row before this date, not literally yesterday: a gap in
      // the notebook is normal and the chain runs between the rows that exist.
      const row = store.manualLedgerDays
        .filter((day) => day.outlet_id === outletId && day.business_date < businessDate)
        .sort((a, b) => b.business_date.localeCompare(a.business_date))[0]
      return row
        ? toDay(
            row,
            figureFor(outletId, row.business_date),
            swiggyFigureFor(outletId, row.business_date),
          )
        : null
    },

    async upsertDay(day: ManualLedgerDayInput) {
      refuseDay(day.outletId)
      refuseImpossibleDay(day)

      const existing = store.manualLedgerDays.find(
        (row) => row.outlet_id === day.outletId && row.business_date === day.businessDate,
      )

      // No Zomato figures are written from here — and no Swiggy figures either,
      // any more: both live on their own table, which no signed-in session may
      // write, so the day row this form saves carries only the drawer. Swiggy's
      // typed history is preserved by leaving those columns untouched on a
      // correction, exactly as the real upsert's omitted columns are.
      const written: Tables<'manual_ledger_days'> = {
        id: existing?.id ?? `dd000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: day.outletId,
        business_date: day.businessDate,
        opening_cash_paise: day.openingCashPaise,
        cash_revenue_paise: day.cashRevenuePaise,
        upi_revenue_paise: day.upiRevenuePaise,
        cash_added_paise: day.cashAddedPaise,
        cash_added_reason: trimmed(day.cashAddedReason),
        cash_removed_paise: day.cashRemovedPaise,
        cash_removed_reason: trimmed(day.cashRemovedReason),
        counted_cash_paise: day.countedCashPaise,
        note: trimmed(day.note),
        // Frozen on a correction, as the guard freezes it: a second owner — or
        // now a manager — may fix a figure without becoming the day's author.
        recorded_by: existing?.recorded_by ?? userId,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Stamped on every correction and null until one, so an untouched row
        // names one account rather than implying a second party (design D6).
        updated_by: existing ? userId : null,
      }

      if (existing) {
        store.manualLedgerDays[store.manualLedgerDays.indexOf(existing)] = written
      } else {
        store.manualLedgerDays.push(written)
      }
      return toDay(
        written,
        figureFor(day.outletId, day.businessDate),
        swiggyFigureFor(day.outletId, day.businessDate),
      )
    },

    async deleteDay(outletId, businessDate) {
      refuseDay(outletId)
      const index = store.manualLedgerDays.findIndex(
        (day) => day.outlet_id === outletId && day.business_date === businessDate,
      )
      if (index >= 0) store.manualLedgerDays.splice(index, 1)
    },

    async listExpenses(outletId, businessDate) {
      refuseExpenses(outletId)
      return store.manualLedgerExpenses
        .filter(
          (expense) => expense.outlet_id === outletId && expense.business_date === businessDate,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toExpense)
    },

    async listRecentExpenses(outletId, businessDates) {
      refuseExpenses(outletId)
      // No date rule in the filter beyond the window the caller asked for: the
      // window is where the surface opens, and the policies carry no date
      // predicate on reads (design D2).
      return store.manualLedgerExpenses
        .filter(
          (expense) =>
            expense.outlet_id === outletId && businessDates.includes(expense.business_date),
        )
        .sort(
          (a, b) =>
            b.business_date.localeCompare(a.business_date) ||
            b.created_at.localeCompare(a.created_at),
        )
        .map(toExpense)
    },

    async createExpense(expense: NewManualLedgerExpense) {
      refuseExpenses(expense.outletId)
      refuseStaffWrite({ businessDate: expense.businessDate })
      refuseImpossibleExpense(expense)

      const created: Tables<'manual_ledger_expenses'> = {
        id: `de000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: expense.outletId,
        business_date: expense.businessDate,
        category: captureMockCategory(store, expense.category),
        is_cash: expense.isCash,
        amount_paise: expense.amountPaise,
        description: trimmed(expense.note),
        // Present so #12 can carry these rows across without inventing an
        // instant for them. Null means `created_at` is the best answer there is.
        occurred_at: null,
        recorded_by: userId,
        // A row a person entered has no external source, which is exactly what
        // the possible-duplicate signal compares against.
        source_system: null,
        source_ref: null,
        // A hand-entered expense is one outlet's own, never a shared supply cost.
        shared_cost: false,
        // What the guard stamps: did the recorder hold an assignment here? The
        // owner holds none anywhere, which is the case the marker exists for.
        recorded_away: !assignedAt(expense.outletId),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: null,
        voided_at: null,
        voided_by: null,
        voided_reason: null,
      }
      store.manualLedgerExpenses.push(created)
      return toExpense(created)
    },

    async updateExpense(id, patch: ManualLedgerExpensePatch) {
      const existing = findExpense(id)
      refuseExpenses(existing.outlet_id)
      refuseVoided(existing)
      refuseStaffWrite({
        businessDate: existing.business_date,
        recordedBy: existing.recorded_by ?? undefined,
      })

      const amountPaise = patch.amountPaise ?? existing.amount_paise
      const category = patch.category ?? existing.category
      refuseImpossibleExpense({ amountPaise, category })

      const updated: Tables<'manual_ledger_expenses'> = {
        ...existing,
        category: captureMockCategory(store, category),
        is_cash: patch.isCash ?? existing.is_cash,
        amount_paise: amountPaise,
        description: patch.note === undefined ? existing.description : trimmed(patch.note),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }

      store.manualLedgerExpenses[store.manualLedgerExpenses.indexOf(existing)] = updated
      return toExpense(updated)
    },

    async voidExpense(id, reason) {
      const existing = findExpense(id)
      refuseExpenses(existing.outlet_id)
      refuseVoided(existing)
      refuseStaffWrite({
        businessDate: existing.business_date,
        recordedBy: existing.recorded_by ?? undefined,
      })

      const voided: Tables<'manual_ledger_expenses'> = {
        ...existing,
        voided_at: new Date().toISOString(),
        voided_by: userId,
        // Optional [owner, 2026-08-09]. Blank is stored as absent, so nobody is
        // ever shown a reason field with nothing in it.
        voided_reason: trimmed(reason),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }

      store.manualLedgerExpenses[store.manualLedgerExpenses.indexOf(existing)] = voided
      return toExpense(voided)
    },

    async getMonth(outletId, month) {
      refuseDay(outletId)
      const inMonth = (businessDate: string) => businessDate.startsWith(`${month}-`)

      const counted = store.manualLedgerDays
        .filter((day) => day.outlet_id === outletId && inMonth(day.business_date))
        .map((row) =>
          toDay(
            row,
            figureFor(outletId, row.business_date),
            swiggyFigureFor(outletId, row.business_date),
          ),
        )
      const countedDates = new Set(counted.map((day) => day.businessDate))

      // Dates the sync wrote either channel's figures for but nobody counted —
      // surfaced from the figures table alone, no ledger row invented. One
      // virtual day carries both readings when they land on the same date.
      const figureDates = new Set(
        store.aggregatorChannelDays
          .filter(
            (row) =>
              row.outlet_id === outletId &&
              (row.channel === 'zomato' || row.channel === 'swiggy') &&
              inMonth(row.business_date) &&
              !countedDates.has(row.business_date),
          )
          .map((row) => row.business_date),
      )
      const uncounted = [...figureDates].map((businessDate) => {
        const zomato = figureFor(outletId, businessDate)
        const swiggy = swiggyFigureFor(outletId, businessDate)
        return uncountedFiguresDay(
          outletId,
          businessDate,
          zomato ? toZomatoSettlement(zomato) : null,
          swiggy ? toZomatoSettlement(swiggy) : null,
        )
      })

      return {
        days: [...counted, ...uncounted].sort((a, b) =>
          a.businessDate.localeCompare(b.businessDate),
        ),
        expenses: store.manualLedgerExpenses
          .filter((expense) => expense.outlet_id === outletId && inMonth(expense.business_date))
          .sort((a, b) => a.business_date.localeCompare(b.business_date))
          .map(toExpense),
      }
    },
  }
}
