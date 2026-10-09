import type { AnalyticsAdapter, AnalyticsItem, AnalyticsSnapshot } from '../analytics'
import type { DemoStore } from './store'
import { periodDays, shiftDate } from '@/domain/sales-analytics'

export function createMockAnalyticsAdapter(
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
    async series(outletId, from, to, periods, subject) {
      authorise(outletId)
      const { start } = window(from, to, periods)
      const dayIndex = new Map<string, number>()
      for (let date = start; date <= to; date = shiftDate(date, 1))
        dayIndex.set(date, dayIndex.size)
      const units = Array<number>(dayIndex.size).fill(0)
      const revenue = Array<number>(dayIndex.size).fill(0)
      const billDay = new Map<string, number>()
      for (const bill of store.bills) {
        const day = dayIndex.get(bill.business_date)
        if (bill.outlet_id === outletId && bill.status === 'settled' && day !== undefined)
          billDay.set(bill.id, day)
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
      }
      return { from: start, units, revenue }
    },
    async read(outletId, from, to, options) {
      authorise(outletId)
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
          active: true,
          available: item.is_available,
          highlighted: store.menuHighlights.get(outletId)?.itemIds.includes(item.id) ?? false,
        })
      }
      const periods = options?.periods ?? 2
      const { span, start } = window(from, to, periods)
      const priorStart = shiftDate(from, -span)
      for (let date = start; date <= to; date = shiftDate(date, 1))
        result.days.push({ date, revenue: 0, orders: 0, units: 0, discounts: 0 })
      const days = new Map(result.days.map((day) => [day.date, day]))
      const categoryRow = (name: string) => {
        let row = result.categories.find((c) => c.name === name)
        if (!row) {
          row = { name, revenue: 0, units: 0, previousRevenue: 0, previousUnits: 0 }
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
            active: false,
            available: false,
            highlighted: false,
          }
          day.units += line.quantity
          if (bill.business_date >= from) {
            row.units += line.quantity
            row.revenue += line.line_total_paise - line.discount_paise
            row.discounts += line.discount_paise
            const category = line.category_name ?? 'Uncategorised'
            const mix = categoryRow(category)
            mix.revenue += line.line_total_paise - line.discount_paise
            mix.units += line.quantity
            if (!seen.has(key)) row.orders++
          } else if (bill.business_date >= priorStart) {
            row.previousUnits += line.quantity
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
