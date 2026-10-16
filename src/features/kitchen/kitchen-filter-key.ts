import type { KitchenBoard } from '@/data-access/adapters'

/**
 * A kitchen filter as one string, equal for equal filters however the board
 * read ordered or rebuilt its ids — so an effect keyed on it runs when the
 * filter changes, not every time the board is read
 * (the-app-asks-the-server-less, D3). Null before the first read.
 */
export function kitchenFilterKey(filter: KitchenBoard['filter'] | undefined): string | null {
  if (!filter) return null
  return `${filter.mode}:${[...filter.categoryIds].sort().join(',')}`
}
