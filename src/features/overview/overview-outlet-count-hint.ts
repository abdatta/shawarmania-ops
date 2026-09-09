const STORAGE_KEY = 'shawarmania.overview-outlet-count'
const DEFAULT_PLACEHOLDER_COUNT = 1
const MAX_PLACEHOLDER_COUNT = 24

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** A browser-wide display hint only; the authorised adapter result remains authoritative. */
export function readOverviewOutletCountHint(storage = browserStorage()): number {
  if (!storage) return DEFAULT_PLACEHOLDER_COUNT
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_PLACEHOLDER_COUNT
    const count = Number(raw)
    if (!Number.isSafeInteger(count) || count < 0) return DEFAULT_PLACEHOLDER_COUNT
    return Math.min(Math.max(count, DEFAULT_PLACEHOLDER_COUNT), MAX_PLACEHOLDER_COUNT)
  } catch {
    return DEFAULT_PLACEHOLDER_COUNT
  }
}

export function rememberOverviewOutletCount(count: number, storage = browserStorage()): void {
  if (!storage || !Number.isSafeInteger(count) || count < 0) return
  try {
    storage.setItem(STORAGE_KEY, String(count))
  } catch {
    // Storage may be unavailable or full; the one-card default remains safe.
  }
}
