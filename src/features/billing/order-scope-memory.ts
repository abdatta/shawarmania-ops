import { useContext, useState } from 'react'

import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

/**
 * Which orders a figure page counts (delivery-orders-are-made-not-billed, D7):
 * the counter's, as every page read before, or delivery orders alone. Never both
 * at once [owner, 2026-11-01].
 */
export type OrderScope = 'counter' | 'delivery'

/** The three pages with the choice, each remembering its own. */
export type OrderScopePage = 'stats' | 'items' | 'sales'

function keyFor(session: Session, page: OrderScopePage): string {
  return `shawarmania.order-scope.${session.mode}.${session.userId}.${page}`
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The scope this person last chose on this page, Counter by default. */
function readRememberedScope(session: Session | undefined, page: OrderScopePage): OrderScope {
  if (!session) return 'counter'
  try {
    return store()?.getItem(keyFor(session, page)) === 'delivery' ? 'delivery' : 'counter'
  } catch {
    return 'counter'
  }
}

function rememberScope(
  session: Session | undefined,
  page: OrderScopePage,
  scope: OrderScope,
): void {
  if (!session) return
  try {
    store()?.setItem(keyFor(session, page), scope)
  } catch {
    // A refused write means the next visit opens on Counter, as it always did.
  }
}

/** A page's scope, remembered per person, per mode and per page, as its date shortcut is. */
export function useRememberedScope(
  page: OrderScopePage,
): [OrderScope, (scope: OrderScope) => void] {
  const session = useContext(SessionContext)
  const [scope, setScope] = useState<OrderScope>(() => readRememberedScope(session, page))
  return [
    scope,
    (next) => {
      setScope(next)
      rememberScope(session, page, next)
    },
  ]
}
