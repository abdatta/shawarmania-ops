import type { AnalyticsSnapshot } from '@/domain/sales-analytics-types'
export type { AnalyticsDay, AnalyticsItem, AnalyticsSnapshot } from '@/domain/sales-analytics-types'

export interface AnalyticsAdapter {
  read(
    outletId: string,
    from: string,
    to: string,
    options?: { view?: 'items' | 'sales'; periods?: number },
  ): Promise<AnalyticsSnapshot>
}

/** Fail closed on a malformed aggregate rather than displaying invented zeroes. */
export function analyticsSnapshot(value: unknown): AnalyticsSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid analytics response')
  const record = value as Record<string, unknown>
  const fields = {
    categories: { strings: ['name'], numbers: ['revenue', 'units'], booleans: [] },
    days: { strings: ['date'], numbers: ['revenue', 'orders', 'units', 'discounts'], booleans: [] },
    items: {
      strings: ['key', 'name', 'category'],
      numbers: ['units', 'revenue', 'discounts', 'orders', 'previousUnits'],
      booleans: ['active', 'available', 'highlighted'],
    },
    delivery: { strings: ['date', 'channel'], numbers: ['revenue'], booleans: ['provisional'] },
    hours: { strings: [], numbers: ['period', 'hour', 'orders', 'revenue'], booleans: [] },
  }
  for (const [key, spec] of Object.entries(fields)) {
    const rows = record[key]
    if (!Array.isArray(rows)) throw new Error('Invalid analytics response')
    for (const row of rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        spec.strings.some((k) => typeof row[k] !== 'string') ||
        spec.booleans.some((k) => typeof row[k] !== 'boolean') ||
        spec.numbers.some((k) => !Number.isSafeInteger(row[k]) || row[k] < 0)
      )
        throw new Error('Invalid analytics response')
    }
  }
  return value as AnalyticsSnapshot
}
