import type { AnalyticsAdapter, AnalyticsItem, AnalyticsSnapshot } from '../analytics'
import type { DemoStore } from './store'
import { periodDays, shiftDate } from '@/domain/sales-analytics'
import { cutInstant, windowsFor } from '@/domain/revenue-figures'
import { outletFixtures } from './fixtures/outlets'
import { deliveryAnalyticsStore } from './delivery'

const hourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  hourCycle: 'h23',
})

/**
 * One Revenue's Sales read (revenue-reads-the-same-everywhere, design D7), as
 * `sales_analytics_v2` answers it: windows aligned `equal` or by `month`, the
 * period taken from window membership, and each window's comparison totals with
 * its last date cut at the time it is now where the current window ends today.
 * Days, hours and delivery stay whole.
 */
function readSalesAligned(
  store: DemoStore,
  outletId: string,
  from: string,
  to: string,
  periods: number,
  align: 'equal' | 'month',
  cut: boolean,
): AnalyticsSnapshot {
  const today = store.today
  const cutover = (
    outletFixtures.find((o) => o.id === outletId)?.business_day_cutover ?? '04:00:00'
  ).slice(0, 5)
  const windows = windowsFor(from, to, periods, align, today).map((w) => ({
    ...w,
    cutAt: cut && w.cut ? cutInstant(w.last, today, Date.now(), cutover) : null,
  }))
  const start = windows.at(-1)!.first
  const windowOf = (date: string) => windows.findIndex((w) => date >= w.first && date <= w.last)
  const result: AnalyticsSnapshot = {
    days: [],
    items: [],
    categories: [],
    hours: [],
    delivery: [],
    totals: windows.map((_, period) => ({ period, counter: 0, delivery: 0, orders: 0 })),
    cutAt: windows[1]?.cutAt ?? null,
  }
  for (let date = start; date <= to; date = shiftDate(date, 1))
    result.days.push({ date, revenue: 0, orders: 0, units: 0, discounts: 0 })
  const days = new Map(result.days.map((day) => [day.date, day]))
  const units = new Map<string, number>()
  for (const line of store.billItems)
    if (line.kind === 'item')
      units.set(line.bill_id, (units.get(line.bill_id) ?? 0) + line.quantity)
  for (const bill of store.bills) {
    if (bill.outlet_id !== outletId || bill.status !== 'settled') continue
    const day = days.get(bill.business_date)
    if (!day) continue
    day.revenue += bill.total_paise
    day.orders++
    day.discounts += bill.discount_paise
    day.units += units.get(bill.id) ?? 0
    const period = windowOf(bill.business_date)
    if (period < 0) continue
    const hour = Number(hourFormat.format(new Date(bill.ordered_at)))
    let h = result.hours.find((x) => x.hour === hour && x.period === period)
    if (!h) {
      h = { period, hour, orders: 0, revenue: 0 }
      result.hours.push(h)
    }
    h.orders++
    h.revenue += bill.total_paise
    const window = windows[period]!
    if (window.cutAt && bill.business_date === window.last && bill.ordered_at >= window.cutAt)
      continue
    result.totals![period]!.counter += bill.total_paise
    result.totals![period]!.orders++
  }
  const delivery = store.aggregatorChannelDays.filter(
    (d) => d.outlet_id === outletId && d.business_date >= start && d.business_date <= to,
  )
  const todayHasDelivery = delivery.some((d) => d.business_date === today)
  for (const d of delivery) {
    result.delivery.push({
      date: d.business_date,
      channel: d.channel,
      revenue: d.revenue_paise,
      provisional: d.settlement_state !== 'settled',
    })
    const period = windowOf(d.business_date)
    if (period < 0) continue
    const window = windows[period]!
    // A cut date's delivery counts only once today's has arrived (design D3).
    if (window.cutAt && d.business_date === window.last && !todayHasDelivery) continue
    result.totals![period]!.delivery += d.revenue_paise
  }
  result.hours.sort((a, b) => a.hour - b.hour)
  return result
}

export function createMockAnalyticsAdapter(
  demoStore: DemoStore,
  allowed: string[] | null,
): AnalyticsAdapter {
  const counter = createScopedAnalyticsAdapter(demoStore, allowed)
  // Delivery reads handed-over delivery orders as bills of no money
  // (delivery-orders-are-made-not-billed, D6), built fresh for each read.
  const delivery = () => createScopedAnalyticsAdapter(deliveryAnalyticsStore(demoStore), allowed)
  return {
    read: (outletId, from, to, options) =>
      (options?.scope === 'delivery' ? delivery() : counter).read(outletId, from, to, options),
    series: (outletId, from, to, periods, subject, options) =>
      (options?.scope === 'delivery' ? delivery() : counter).series(
        outletId,
        from,
        to,
        periods,
        subject,
        options,
      ),
  }
}

function createScopedAnalyticsAdapter(
  store: DemoStore,
  allowed: string[] | null,
): AnalyticsAdapter {
  const authorise = (outletId: string) => {
    if (allowed && !allowed.includes(outletId))
      throw new Error('Analytics is available to outlet managers')
  }
  const window = (from: string, to: string, periods: number) => {
    const span = periodDays(from, to)
    if (span < 1 || span > 92 || !Number.isInteger(periods) || periods < 1 || periods > 4)
      throw new Error('Invalid analytics range')
    return { span, start: shiftDate(from, -(periods - 1) * span) }
  }
  return {
    async series(outletId, from, to, periods, subject, options) {
      authorise(outletId)
      // One Revenue's comparison totals, cut where the range ends today.
      const cutover = (
        outletFixtures.find((o) => o.id === outletId)?.business_day_cutover ?? '04:00:00'
      ).slice(0, 5)
      const compared = options
        ? windowsFor(from, to, periods, 'equal', store.today).map((w) => ({
            ...w,
            cutAt:
              options.cut && w.cut ? cutInstant(w.last, store.today, Date.now(), cutover) : null,
          }))
        : null
      const totals = compared?.map(() => ({ units: 0, revenue: 0 }))
      const billCounted = new Map<string, number>()
      const { start } = window(from, to, periods)
      const dayIndex = new Map<string, number>()
      for (let date = start; date <= to; date = shiftDate(date, 1))
        dayIndex.set(date, dayIndex.size)
      const units = Array<number>(dayIndex.size).fill(0)
      const revenue = Array<number>(dayIndex.size).fill(0)
      const hourUnits = Array<number>(periods * 24).fill(0)
      const hourRevenue = Array<number>(periods * 24).fill(0)
      const span = periodDays(from, to)
      const hourFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hourCycle: 'h23',
      })
      const billDay = new Map<string, number>()
      const billHour = new Map<string, number>()
      for (const bill of store.bills) {
        const day = dayIndex.get(bill.business_date)
        if (bill.outlet_id !== outletId || bill.status !== 'settled' || day === undefined) continue
        billDay.set(bill.id, day)
        if (compared) {
          const index = compared.findIndex(
            (w) => bill.business_date >= w.first && bill.business_date <= w.last,
          )
          const w = compared[index]
          if (w && !(w.cutAt && bill.business_date === w.last && bill.ordered_at >= w.cutAt))
            billCounted.set(bill.id, index)
        }
        // Window 0 is the current one, as the server numbers them.
        const period = Math.floor((periodDays(bill.business_date, to) - 1) / span)
        billHour.set(bill.id, period * 24 + Number(hourFormat.format(new Date(bill.ordered_at))))
      }
      for (const line of store.billItems) {
        const day = billDay.get(line.bill_id)
        if (day === undefined || line.kind !== 'item') continue
        if (
          subject.kind === 'item' &&
          (line.menu_item_id ?? `snapshot:${line.item_name}`) !== subject.key
        )
          continue
        if (subject.kind === 'category' && (line.category_name ?? 'Uncategorised') !== subject.name)
          continue
        units[day]! += line.quantity
        revenue[day]! += line.line_total_paise - line.discount_paise
        const counted = billCounted.get(line.bill_id)
        if (totals && counted !== undefined) {
          totals[counted]!.units += line.quantity
          totals[counted]!.revenue += line.line_total_paise - line.discount_paise
        }
        const slot = billHour.get(line.bill_id)!
        hourUnits[slot]! += line.quantity
        hourRevenue[slot]! += line.line_total_paise - line.discount_paise
      }
      return {
        from: start,
        units,
        revenue,
        hourUnits,
        hourRevenue,
        ...(totals ? { totals, cutAt: compared?.[1]?.cutAt ?? null } : {}),
      }
    },
    async read(outletId, from, to, options) {
      authorise(outletId)
      if (options?.align && options.view === 'sales') {
        const periods = options.periods ?? 2
        window(from, to, periods)
        return readSalesAligned(
          store,
          outletId,
          from,
          to,
          periods,
          options.align,
          options.cut ?? false,
        )
      }
      const result: AnalyticsSnapshot = {
        days: [],
        items: [],
        categories: [],
        hours: [],
        delivery: [],
      }
      const items = new Map<string, AnalyticsItem>()
      for (const item of store.menuItems.filter((m) => m.outlet_id === outletId && m.is_active)) {
        const category = store.menuCategories.find((c) => c.id === item.category_id)
        if (!category?.is_active) continue
        items.set(item.id, {
          key: item.id,
          name: item.name,
          category: category.name,
          units: 0,
          revenue: 0,
          discounts: 0,
          orders: 0,
          previousUnits: 0,
          previousRevenue: 0,
          periodUnits: [],
          periodRevenue: [],
          active: true,
          available: item.is_available,
          highlighted: store.menuHighlights.get(outletId)?.itemIds.includes(item.id) ?? false,
        })
      }
      const periods = options?.periods ?? 2
      const { span, start } = window(from, to, periods)
      // One Revenue's Items read: earlier windows' dish figures count only up
      // to the time it is now on their matched date (design D3).
      const cutover = (
        outletFixtures.find((o) => o.id === outletId)?.business_day_cutover ?? '04:00:00'
      ).slice(0, 5)
      const cutWindows = options?.cut
        ? windowsFor(from, to, periods, 'equal', store.today).map((w) =>
            w.cut
              ? { last: w.last, at: cutInstant(w.last, store.today, Date.now(), cutover) }
              : null,
          )
        : null
      for (const item of items.values()) {
        item.periodUnits = Array<number>(periods).fill(0)
        item.periodRevenue = Array<number>(periods).fill(0)
      }
      const priorStart = shiftDate(from, -span)
      for (let date = start; date <= to; date = shiftDate(date, 1))
        result.days.push({ date, revenue: 0, orders: 0, units: 0, discounts: 0 })
      const days = new Map(result.days.map((day) => [day.date, day]))
      const categoryRow = (name: string) => {
        let row = result.categories.find((c) => c.name === name)
        if (!row) {
          row = {
            name,
            revenue: 0,
            units: 0,
            previousRevenue: 0,
            previousUnits: 0,
            periodUnits: Array<number>(periods).fill(0),
            periodRevenue: Array<number>(periods).fill(0),
          }
          result.categories.push(row)
        }
        return row
      }
      const linesByBill = new Map<string, typeof store.billItems>()
      for (const line of store.billItems) {
        if (options?.view === 'sales') break
        if (line.kind !== 'item') continue
        const lines = linesByBill.get(line.bill_id) ?? []
        lines.push(line)
        linesByBill.set(line.bill_id, lines)
      }
      const hourFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hourCycle: 'h23',
      })
      for (const bill of store.bills.filter(
        (b) =>
          b.outlet_id === outletId &&
          b.status === 'settled' &&
          b.business_date >= start &&
          b.business_date <= to,
      )) {
        const day = days.get(bill.business_date)!
        day.revenue += bill.total_paise
        day.orders++
        day.discounts += bill.discount_paise
        const lines = linesByBill.get(bill.id) ?? []
        const seen = new Set<string>()
        for (const line of lines) {
          const key = line.menu_item_id ?? `snapshot:${line.item_name}`
          const row = items.get(key) ?? {
            key,
            name: line.item_name,
            category: line.category_name ?? 'Uncategorised',
            units: 0,
            revenue: 0,
            discounts: 0,
            orders: 0,
            previousUnits: 0,
            previousRevenue: 0,
            periodUnits: Array<number>(periods).fill(0),
            periodRevenue: Array<number>(periods).fill(0),
            active: false,
            available: false,
            highlighted: false,
          }
          day.units += line.quantity
          // Window 0 is the current one, as the server numbers them.
          const windowIndex = Math.floor((periodDays(bill.business_date, to) - 1) / span)
          const lineRevenue = line.line_total_paise - line.discount_paise
          const cutOff = cutWindows?.[windowIndex]
          const beyondCut =
            !!cutOff && bill.business_date === cutOff.last && bill.ordered_at >= cutOff.at
          const lineCategory = categoryRow(line.category_name ?? 'Uncategorised')
          if (!beyondCut) {
            row.periodUnits[windowIndex]! += line.quantity
            row.periodRevenue[windowIndex]! += lineRevenue
            lineCategory.periodUnits[windowIndex]! += line.quantity
            lineCategory.periodRevenue[windowIndex]! += lineRevenue
          }
          if (bill.business_date >= from) {
            row.units += line.quantity
            row.revenue += line.line_total_paise - line.discount_paise
            row.discounts += line.discount_paise
            const category = line.category_name ?? 'Uncategorised'
            const mix = categoryRow(category)
            mix.revenue += line.line_total_paise - line.discount_paise
            mix.units += line.quantity
            if (!seen.has(key)) row.orders++
          } else if (bill.business_date >= priorStart && !beyondCut) {
            row.previousUnits += line.quantity
            row.previousRevenue += line.line_total_paise - line.discount_paise
            const mix = categoryRow(line.category_name ?? 'Uncategorised')
            mix.previousRevenue += line.line_total_paise - line.discount_paise
            mix.previousUnits += line.quantity
          }
          // Sold categories follow the snapshot, including missing legacy snapshots.
          row.category = line.category_name ?? 'Uncategorised'
          items.set(key, row)
          seen.add(key)
        }
        const hour = Number(hourFormat.format(new Date(bill.ordered_at)))
        const period = Math.floor((periodDays(bill.business_date, to) - 1) / span)
        let h = result.hours.find((x) => x.hour === hour && x.period === period)
        if (!h) {
          h = { period, hour, orders: 0, revenue: 0 }
          result.hours.push(h)
        }
        h.orders++
        h.revenue += bill.total_paise
      }
      result.delivery = store.aggregatorChannelDays
        .filter(
          (d) => d.outlet_id === outletId && d.business_date >= start && d.business_date <= to,
        )
        .map((d) => ({
          date: d.business_date,
          channel: d.channel,
          revenue: d.revenue_paise,
          provisional: d.settlement_state !== 'settled',
        }))
      result.items = [...items.values()].sort((a, b) => b.units - a.units)
      result.categories.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
      result.hours.sort((a, b) => a.hour - b.hour)
      if (options?.view === 'sales') {
        result.items = []
        result.categories = []
      }
      if (options?.view === 'items') {
        result.hours = []
        result.delivery = []
        result.days = Array.from({ length: periods }, (_, period) => {
          const first = shiftDate(from, -period * span),
            last = shiftDate(to, -period * span)
          return result.days
            .filter((d) => d.date >= first && d.date <= last)
            .reduce(
              (sum, d) => ({
                date: first,
                revenue: sum.revenue + d.revenue,
                orders: sum.orders + d.orders,
                units: sum.units + d.units,
                discounts: sum.discounts + d.discounts,
              }),
              { date: first, revenue: 0, orders: 0, units: 0, discounts: 0 },
            )
        })
      }
      return result
    },
  }
}
