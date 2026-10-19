import { DataActionError } from '@/data-access/adapters'
import { rupeesToPaise } from '@/domain'

/** Rupees as typed, to paise; null for anything that is not an amount above zero. */
export function parseAmount(text: string): number | null {
  const value = Number(text.replace(/[,₹\s]/g, ''))
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return null
  return rupeesToPaise(value)
}

/** The adapter's own sentence where it gave one, else the fallback. */
export function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof DataActionError ? cause.message : fallback
}
