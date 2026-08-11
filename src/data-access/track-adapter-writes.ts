import { beginWrite } from '@/pwa/occupancy'

import type { DataAdapters } from './adapters'

/**
 * Count writes in flight, once, at the seam every write already passes through.
 *
 * The app reloads itself to take a new build, and it must not do that while a
 * write is in the air. Asking each surface to report would be the same mistake
 * as asking each form to report its typing: twenty-odd call sites, one of which
 * eventually forgets, failing silently (design D7).
 *
 * Reads are excluded by name. The list is conservative in the safe direction:
 * a method wrongly counted as a write delays a reload by however long it takes,
 * while a write wrongly counted as a read is the failure that costs something.
 * So anything not recognisably a read is treated as one that matters.
 */
const READ_PREFIXES = [
  'get',
  'list',
  'search',
  'lookup',
  'find',
  'count',
  'subscribe',
  'readiness',
] as const

function isRead(name: string): boolean {
  return READ_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}

function trackDomain<T extends object>(domain: T): T {
  const tracked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(domain)) {
    if (typeof value !== 'function' || isRead(key)) {
      tracked[key] = value
      continue
    }

    tracked[key] = (...args: unknown[]) => {
      const result = (value as (...a: unknown[]) => unknown).apply(domain, args)
      if (!isThenable(result)) return result

      const settle = beginWrite()
      // The caller keeps the original promise, so rejection handling and
      // identity are exactly as they were. This derived one is handled on both
      // paths, so observing settlement cannot manufacture an unhandled
      // rejection of its own.
      Promise.resolve(result).then(settle, settle)
      return result
    }
  }

  return tracked as T
}

/**
 * Wrap a set of adapters so their writes are counted.
 *
 * Applied by each root beside the factory it already calls, so the demo tree
 * and the real tree are covered by the same code without either learning about
 * the other.
 */
export function trackAdapterWrites(adapters: DataAdapters): DataAdapters {
  const tracked: Record<string, unknown> = {}

  for (const [key, domain] of Object.entries(adapters)) {
    tracked[key] =
      typeof domain === 'object' && domain !== null ? trackDomain(domain as object) : domain
  }

  return tracked as unknown as DataAdapters
}
